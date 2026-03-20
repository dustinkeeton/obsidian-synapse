import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	NotificationManager, buildCallout, CALLOUT_TYPES, sanitizeAIResponse,
	CheckpointManager, generateId, formatTimeRange,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask, TimeRange } from '../shared';
import { findAudioEmbeds } from './note-scanner';
import { AudioEmbed } from './types';
import { PostProcessor } from './post-processor';
import { Transcriber } from './transcriber';
import { TranscribeOptions, TranscriptionResult } from './types';
import type { AudioExtractor } from '../video';

export { findAudioEmbeds, AUDIO_EXTENSIONS, AUDIO_EMBED_REGEX } from './note-scanner';
export type { AudioEmbed, TranscribeOptions, TranscriptionResult, TimestampEntry } from './types';

export class AudioModule {
	private transcriber: Transcriber;
	private postProcessor: PostProcessor;

	/** Optional callback invoked after transcription completes. Wired by main.ts for enrichment. */
	onTranscriptionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager,
		private extractor?: AudioExtractor
	) {
		this.transcriber = new Transcriber(getSettings);
		this.postProcessor = new PostProcessor(getSettings);
	}

	async onload(): Promise<void> {
		// Commands are now registered in main.ts (unified transcription)
	}

	onunload(): void {}

	async transcribe(
		audioData: ArrayBuffer,
		fileName: string,
		options?: TranscribeOptions
	): Promise<TranscriptionResult> {
		const result = await this.transcriber.transcribe(audioData, fileName);
		// Defense-in-depth: sanitize raw transcription from external APIs
		result.raw = sanitizeAIResponse(result.raw);

		if (options?.postProcess !== false) {
			result.processed = await this.postProcessor.process(result.raw);
		}

		if (options?.sourceName) {
			result.sourceName = options.sourceName;
		}

		return result;
	}

	async transcribeFileToActiveNote(file: TFile, timeRange?: TimeRange): Promise<void> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			this.notifications.info('Open a note first to insert the transcription');
			return;
		}

		const op = this.notifications.startOperation(
			`Transcribing ${file.name}...`,
			`audio-${file.path}`
		);
		try {
			let data = await this.plugin.app.vault.readBinary(file);

			// Clip audio to time range if specified (requires ffmpeg via AudioExtractor)
			if (timeRange && this.extractor) {
				const os = require('os') as typeof import('os');
				const path = require('path') as typeof import('path');
				const fs = require('fs') as typeof import('fs');

				const tempPath = path.join(os.tmpdir(), `synapse-clip-src-${Date.now()}.mp3`);
				fs.writeFileSync(tempPath, Buffer.from(data));

				const clippedPath = await this.extractor.clipAudio(
					tempPath, timeRange.startSeconds, timeRange.endSeconds
				);

				data = fs.readFileSync(clippedPath).buffer as ArrayBuffer;

				// Clean up temp files
				try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
				try { fs.unlinkSync(clippedPath); } catch { /* ignore */ }
			} else if (timeRange && !this.extractor) {
				this.notifications.info('Time-range clipping requires ffmpeg (desktop only). Transcribing full file.');
			}

			const result = await this.transcribe(data, file.name);
			const text = result.processed || result.raw;

			const title = timeRange && this.extractor
				? `Transcription of ${file.name} ${formatTimeRange(timeRange)}`
				: `Transcription of ${file.name}`;
			const transcriptionBlock = buildCallout(
				CALLOUT_TYPES.transcription,
				title,
				text,
				true
			);

			const content = await this.plugin.app.vault.read(activeFile);
			await this.plugin.app.vault.modify(activeFile, content + transcriptionBlock);
			this.onTranscriptionComplete?.(activeFile.path);
			op.finish(`Transcription of ${file.name} added to note`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Transcription failed -- ${msg}`);
		}
	}

	/**
	 * Resume audio transcription from a checkpoint (C1).
	 * The remaining audio files are re-processed.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		this.notifications.info(
			`Audio checkpoint has ${checkpoint.remainingItems.length} remaining items. ` +
			`Completed items are already saved. Please re-run transcription on the source note to continue.`
		);
		await this.checkpointManager.discard(checkpoint.id);
	}

	async transcribeAndInsert(
		noteFile: TFile,
		embeds: AudioEmbed[]
	): Promise<void> {
		const total = embeds.length;
		let completed = 0;

		const op = this.notifications.startOperation(
			`Transcribing ${total} audio file(s)...`,
			`audio-batch-${noteFile.path}`
		);

		// Create checkpoint for batch transcription
		const checkpointItems: CheckpointWorkItem[] = embeds.map((e, i) => ({
			id: `audio-${i}-${e.fileName}`,
			label: e.fileName,
			payload: { fileName: e.fileName, line: e.line } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'audio',
			operationLabel: `Audio transcription: ${noteFile.basename} (${total} files)`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		// Process in reverse line order so insertions don't shift line numbers
		const sorted = [...embeds].sort((a, b) => b.line - a.line);

		let content = await this.plugin.app.vault.read(noteFile);

		for (let i = 0; i < sorted.length; i++) {
			if (op.cancelled) break;
			const embed = sorted[i];
			// Delay between requests to avoid API rate limits
			if (i > 0) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			try {
				op.progress(completed + 1, total, 'Transcribing audio');
				const data = await this.plugin.app.vault.readBinary(embed.file);
				const result = await this.transcribe(data, embed.fileName);
				const text = result.processed || result.raw;

				const lines = content.split('\n');
				const transcriptionBlock = buildCallout(
					CALLOUT_TYPES.transcription,
					`Transcription of ${embed.fileName}`,
					text,
					true
				);

				// Insert after the embed line
				lines.splice(embed.line + 1, 0, transcriptionBlock);
				content = lines.join('\n');

				completed++;

				// Save checkpoint progress
				const cpItemId = checkpointItems.find(
					(ci) => ci.payload.fileName === embed.fileName
				)?.id;
				if (cpItemId) {
					await this.checkpointManager.completeItem(checkpoint.id, cpItemId);
				}
			} catch (error) {
				this.notifications.notifyError(`Transcription failed for ${embed.fileName}`, error);
			}
		}

		// Write whatever we completed, even if cancelled partway
		if (completed > 0) {
			await this.plugin.app.vault.modify(noteFile, content);
			this.onTranscriptionComplete?.(noteFile.path);
		}
		if (op.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
		} else {
			// Mark checkpoint completed and dispatch deferred tasks (I1)
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			op.finish(`Done -- ${completed}/${total} transcriptions added`);
		}
	}

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					// Audio module doesn't have a direct view refresh callback,
					// but the deferred task system ensures it runs via main.ts dispatch
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}
