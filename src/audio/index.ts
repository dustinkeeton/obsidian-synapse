import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import {
	NotificationManager, buildCallout, CALLOUT_TYPES, sanitizeAIResponse,
	CheckpointManager,
} from '../shared';
import type { CheckpointWorkItem } from '../shared';
import { findAudioEmbeds } from './note-scanner';
import { AudioEmbed } from './types';
import { PostProcessor } from './post-processor';
import { Transcriber } from './transcriber';
import { TranscribeOptions, TranscriptionResult } from './types';

export { findAudioEmbeds, AUDIO_EXTENSIONS, AUDIO_EMBED_REGEX } from './note-scanner';
export type { AudioEmbed, TranscribeOptions, TranscriptionResult, TimestampEntry } from './types';

export class AudioModule {
	private transcriber: Transcriber;
	private postProcessor: PostProcessor;
	private checkpointManager: CheckpointManager;

	/** Optional callback invoked after transcription completes. Wired by main.ts for enrichment. */
	onTranscriptionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager
	) {
		this.transcriber = new Transcriber(getSettings);
		this.postProcessor = new PostProcessor(getSettings);
		this.checkpointManager = new CheckpointManager(plugin.app);
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

	async transcribeFileToActiveNote(file: TFile): Promise<void> {
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
			const data = await this.plugin.app.vault.readBinary(file);
			const result = await this.transcribe(data, file.name);
			const text = result.processed || result.raw;

			const transcriptionBlock = buildCallout(
				CALLOUT_TYPES.transcription,
				`Transcription of ${file.name}`,
				text,
				true
			);

			const content = await this.plugin.app.vault.read(activeFile);
			await this.plugin.app.vault.modify(activeFile, content + transcriptionBlock);
			this.onTranscriptionComplete?.(activeFile.path);
			op.finish(`Transcription of ${file.name} added to note`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Transcription failed — ${msg}`);
		}
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
		if (!op.cancelled) {
			await this.checkpointManager.complete(checkpoint.id);
			op.finish(`Done — ${completed}/${total} transcriptions added`);
		}
	}

}
