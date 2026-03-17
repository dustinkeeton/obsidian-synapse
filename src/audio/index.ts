import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { NotificationManager, buildCallout, CALLOUT_TYPES } from '../shared';
import { NoteAudioModal } from './note-audio-modal';
import { AudioEmbed } from './types';
import { PostProcessor } from './post-processor';
import { Transcriber } from './transcriber';
import { AudioTranscriptionModal } from './transcription-modal';
import { TranscribeOptions, TranscriptionResult } from './types';

export { AudioTranscriptionModal } from './transcription-modal';
export type { AudioEmbed, TranscribeOptions, TranscriptionResult, TimestampEntry } from './types';

const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i;
const AUDIO_EMBED_REGEX = /!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|flac|webm|aac))\]\]/gi;

export class AudioModule {
	private transcriber: Transcriber;
	private postProcessor: PostProcessor;

	/** Optional callback invoked after transcription completes. Wired by main.ts for enrichment. */
	onTranscriptionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager
	) {
		this.transcriber = new Transcriber(getSettings);
		this.postProcessor = new PostProcessor(getSettings);
	}

	async onload(): Promise<void> {
		this.plugin.addCommand({
			id: 'auto-notes:transcribe-audio',
			name: 'Transcribe audio file',
			callback: () => this.openTranscriptionModal(),
		});

		this.plugin.addCommand({
			id: 'auto-notes:transcribe-note-audio',
			name: 'Transcribe audio from current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.transcribeFromNote(ctx.file);
				}
			},
		});
	}

	onunload(): void {}

	async transcribe(
		audioData: ArrayBuffer,
		fileName: string,
		options?: TranscribeOptions
	): Promise<TranscriptionResult> {
		const result = await this.transcriber.transcribe(audioData, fileName);

		if (options?.postProcess !== false) {
			result.processed = await this.postProcessor.process(result.raw);
		}

		if (options?.sourceName) {
			result.sourceName = options.sourceName;
		}

		return result;
	}

	openTranscriptionModal(): void {
		new AudioTranscriptionModal(
			this.plugin.app,
			this.getSettings,
			async (file) => {
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
		).open();
	}

	private async transcribeFromNote(noteFile: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(noteFile);
		const embeds = this.findAudioEmbeds(content, noteFile.path);

		if (embeds.length === 0) {
			this.notifications.info('No audio files found in this note');
			return;
		}

		new NoteAudioModal(
			this.plugin.app,
			embeds,
			async (selected) => {
				await this.transcribeAndInsert(noteFile, selected);
			}
		).open();
	}

	private findAudioEmbeds(content: string, sourcePath: string): AudioEmbed[] {
		const embeds: AudioEmbed[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const matches = [...lines[i].matchAll(AUDIO_EMBED_REGEX)];
			for (const match of matches) {
				const fileName = match[1];

				// Skip if a transcription block already follows this embed
				if (this.hasTranscriptionBelow(lines, i, fileName)) {
					continue;
				}

				const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
					fileName,
					sourcePath
				);
				if (file instanceof TFile && AUDIO_EXTENSIONS.test(file.name)) {
					embeds.push({ fileName, file, line: i });
				}
			}
		}

		return embeds;
	}

	private hasTranscriptionBelow(lines: string[], embedLine: number, fileName: string): boolean {
		// Look at the lines following the embed for a transcription block
		for (let j = embedLine + 1; j < lines.length && j <= embedLine + 3; j++) {
			// Legacy format
			if (lines[j].includes(`**Transcription of ${fileName}**`)) {
				return true;
			}
			// Callout format
			if (lines[j].includes(`[!${CALLOUT_TYPES.transcription}]`) && lines[j].includes(`Transcription of ${fileName}`)) {
				return true;
			}
			// Stop looking if we hit another embed or non-empty non-blank line that isn't a blockquote
			if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
				break;
			}
		}
		return false;
	}

	private async transcribeAndInsert(
		noteFile: TFile,
		embeds: AudioEmbed[]
	): Promise<void> {
		const total = embeds.length;
		let completed = 0;

		const op = this.notifications.startOperation(
			`Transcribing ${total} audio file(s)...`,
			`audio-batch-${noteFile.path}`
		);

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
			op.finish(`Done — ${completed}/${total} transcriptions added`);
		}
	}

}
