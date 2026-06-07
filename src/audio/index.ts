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
	/** Approximate Whisper file-size limit (~25 MB) used to warn before a combined transcription. */
	private static readonly COMBINED_SIZE_WARN_BYTES = 25 * 1024 * 1024;

	private transcriber: Transcriber;
	private postProcessor: PostProcessor;

	/**
	 * Delay (ms) between sequential per-file transcriptions in the no-ffmpeg
	 * combined fallback (#214), to avoid API rate limits. Overridable in tests.
	 */
	private interFileDelayMs = 2000;

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

	/**
	 * Combined transcription (#214): produce ONE `Combined transcription
	 * (N files)` callout from the selected audio embeds, inserted after the
	 * last (highest-line) selected embed.
	 *
	 * With ffmpeg the audio is concatenated and transcribed in a SINGLE call.
	 * Without it (e.g. mobile) each file is transcribed separately and the
	 * resulting TEXT is merged — the output is still one combined callout. A
	 * single selected embed short-circuits to a normal per-file transcription;
	 * an oversized combined file (desktop) offers a per-file fallback.
	 */
	async transcribeAndInsertCombined(
		noteFile: TFile,
		embeds: AudioEmbed[]
	): Promise<void> {
		// A single file + combine is just a normal single transcription.
		if (embeds.length < 2) {
			await this.transcribeAndInsert(noteFile, embeds);
			return;
		}

		const op = this.notifications.startOperation(
			`Combining ${embeds.length} audio files...`,
			`audio-combined-${noteFile.path}`
		);
		try {
			let text: string;

			if (this.extractor) {
				// Desktop: concatenate the audio and transcribe it in one call.
				op.update('Concatenating audio');
				const files = embeds.map(e => e.file);
				const { data, sizeBytes } = await this.concatEmbedsToBuffer(files);

				if (op.cancelled) {
					op.finish('Cancelled');
					return;
				}

				// Provider size guard: offer per-file fallback rather than a
				// silent API failure on oversized combined audio.
				if (sizeBytes > AudioModule.COMBINED_SIZE_WARN_BYTES) {
					const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
					const fallback = await this.notifications.confirm(
						`Combined audio is ${mb} MB, which may exceed the transcription provider limit (~25 MB). Transcribe each file separately instead?`,
						{ proceedLabel: 'Per-file', cancelLabel: 'Combine anyway', level: 'warning' }
					);
					if (fallback) {
						op.finish('Falling back to per-file transcription');
						await this.transcribeAndInsert(noteFile, embeds);
						return;
					}
				}

				op.update('Transcribing combined audio');
				const result = await this.transcribe(data, `combined-${noteFile.basename}.mp3`);
				text = result.processed || result.raw;
			} else {
				// Mobile / no ffmpeg: transcribe each file separately and merge
				// the TEXT into one block (the audio can't be concatenated).
				op.update('Transcribing each audio file');
				text = await this.transcribeEachToText(embeds.map(e => e.file), op);
				if (op.cancelled) {
					op.finish('Cancelled');
					return;
				}
			}

			const fileList = embeds.map(e => e.fileName).join(', ');
			const body = `Source files: ${fileList}\n\n${text}`;
			const block = buildCallout(
				CALLOUT_TYPES.transcription,
				`Combined transcription (${embeds.length} files)`,
				body,
				true
			);

			// Insert after the last (highest-line) selected embed.
			const content = await this.plugin.app.vault.read(noteFile);
			const lines = content.split('\n');
			const insertLine = Math.max(...embeds.map(e => e.line));
			lines.splice(insertLine + 1, 0, block);
			await this.plugin.app.vault.modify(noteFile, lines.join('\n'));

			this.onTranscriptionComplete?.(noteFile.path);
			op.finish(`Combined transcription of ${embeds.length} files added to note`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Combined transcription failed -- ${msg}`);
		}
	}

	/**
	 * Combined transcription helper for the summarize path (#214): return ONE
	 * transcript string for multiple audio files. With ffmpeg the audio is
	 * concatenated and transcribed once; without it (mobile) each file is
	 * transcribed separately and the TEXT is merged. A single file
	 * short-circuits to a normal transcription.
	 */
	async transcribeAudioCombined(files: TFile[]): Promise<string> {
		if (files.length === 1) {
			const data = await this.plugin.app.vault.readBinary(files[0]);
			const result = await this.transcribe(data, files[0].name);
			return result.processed || result.raw;
		}
		// Mobile / no ffmpeg: transcribe each file and merge the text.
		if (!this.extractor) {
			return this.transcribeEachToText(files);
		}
		const { data, sizeBytes } = await this.concatEmbedsToBuffer(files);
		if (sizeBytes > AudioModule.COMBINED_SIZE_WARN_BYTES) {
			const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
			this.notifications.info(
				`Combined audio is ${mb} MB, which may exceed the transcription provider limit (~25 MB).`
			);
		}
		const result = await this.transcribe(data, 'combined.mp3');
		return result.processed || result.raw;
	}

	/**
	 * Transcribe each file separately and join the transcripts into one
	 * continuous block. The no-ffmpeg fallback for combined transcription /
	 * summary (#214): the audio can't be concatenated, but the OUTPUT is still
	 * combined. Sequential with a small delay to avoid API rate limits;
	 * respects op cancellation/progress when provided.
	 */
	private async transcribeEachToText(
		files: TFile[],
		op?: { cancelled: boolean; progress: (done: number, total: number, label: string) => void }
	): Promise<string> {
		const parts: string[] = [];
		for (let i = 0; i < files.length; i++) {
			if (op?.cancelled) break;
			if (i > 0 && this.interFileDelayMs > 0) {
				await new Promise(resolve => setTimeout(resolve, this.interFileDelayMs));
			}
			op?.progress(i + 1, files.length, 'Transcribing audio');
			const data = await this.plugin.app.vault.readBinary(files[i]);
			const result = await this.transcribe(data, files[i].name);
			parts.push(result.processed || result.raw);
		}
		return parts.join('\n\n');
	}

	/**
	 * Read each audio file, write to temp files, concatenate via ffmpeg, and
	 * return the combined audio data plus its byte size. All temp files
	 * (inputs and combined output) are cleaned up on success AND failure.
	 * Requires the AudioExtractor (ffmpeg / desktop).
	 */
	private async concatEmbedsToBuffer(
		files: TFile[]
	): Promise<{ data: ArrayBuffer; sizeBytes: number }> {
		if (!this.extractor) {
			throw new Error('Combining audio requires ffmpeg (desktop only)');
		}
		const os = require('os') as typeof import('os');
		const path = require('path') as typeof import('path');
		const fs = require('fs') as typeof import('fs');

		const tempInputs: string[] = [];
		let combinedPath: string | null = null;
		try {
			for (let i = 0; i < files.length; i++) {
				const bin = await this.plugin.app.vault.readBinary(files[i]);
				const ext = files[i].extension || 'audio';
				const tempPath = path.join(os.tmpdir(), `synapse-combine-src-${Date.now()}-${i}.${ext}`);
				fs.writeFileSync(tempPath, Buffer.from(bin));
				tempInputs.push(tempPath);
			}
			combinedPath = await this.extractor.concatAudio(tempInputs);
			const buf = fs.readFileSync(combinedPath);
			const data = buf.buffer.slice(
				buf.byteOffset,
				buf.byteOffset + buf.byteLength
			) as ArrayBuffer;
			return { data, sizeBytes: buf.byteLength };
		} finally {
			for (const t of tempInputs) {
				try { fs.unlinkSync(t); } catch { /* ignore */ }
			}
			if (combinedPath) {
				try { fs.unlinkSync(combinedPath); } catch { /* ignore */ }
			}
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
