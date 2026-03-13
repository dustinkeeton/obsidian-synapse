import { Notice, Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { notifyError, writeNote } from '../shared';
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

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings
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

	async saveTranscription(
		result: TranscriptionResult,
		targetPath?: string
	): Promise<void> {
		const settings = this.getSettings().audio.output;
		const content = this.formatTranscription(result);

		const path =
			targetPath || this.buildOutputPath(result.sourceName, settings);

		await writeNote(this.plugin.app, path, content);
		new Notice(`Auto Notes: Transcription saved to ${path}`);
	}

	openTranscriptionModal(): void {
		new AudioTranscriptionModal(
			this.plugin.app,
			this.getSettings,
			async (file) => {
				try {
					new Notice('Auto Notes: Transcribing...');
					const data = await this.plugin.app.vault.readBinary(file);
					const result = await this.transcribe(data, file.name);
					await this.saveTranscription(result);
				} catch (error) {
					notifyError('Transcription failed', error);
				}
			}
		).open();
	}

	private async transcribeFromNote(noteFile: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(noteFile);
		const embeds = this.findAudioEmbeds(content, noteFile.path);

		if (embeds.length === 0) {
			new Notice('Auto Notes: No audio files found in this note');
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
			if (lines[j].includes(`**Transcription of ${fileName}**`)) {
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

		new Notice(`Auto Notes: Transcribing ${total} file(s)...`);

		// Process in reverse line order so insertions don't shift line numbers
		const sorted = [...embeds].sort((a, b) => b.line - a.line);

		let content = await this.plugin.app.vault.read(noteFile);

		for (let i = 0; i < sorted.length; i++) {
			const embed = sorted[i];
			// Delay between requests to avoid API rate limits
			if (i > 0) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			try {
				const data = await this.plugin.app.vault.readBinary(embed.file);
				const result = await this.transcribe(data, embed.fileName);
				const text = result.processed || result.raw;

				const lines = content.split('\n');
				const transcriptionBlock = [
					'',
					`> **Transcription of ${embed.fileName}**`,
					'>',
					...text.split('\n').map(line => `> ${line}`),
					'',
				].join('\n');

				// Insert after the embed line
				lines.splice(embed.line + 1, 0, transcriptionBlock);
				content = lines.join('\n');

				completed++;
				new Notice(`Auto Notes: Transcribed ${completed}/${total}`);
			} catch (error) {
				notifyError(`Transcription failed for ${embed.fileName}`, error);
			}
		}

		await this.plugin.app.vault.modify(noteFile, content);
		new Notice(`Auto Notes: Done — ${completed}/${total} transcriptions added`);
	}

	private formatTranscription(result: TranscriptionResult): string {
		const parts: string[] = [];

		parts.push(`---`);
		parts.push(`source: ${result.sourceName}`);
		parts.push(`date: ${new Date().toISOString().split('T')[0]}`);
		if (result.language) parts.push(`language: ${result.language}`);
		if (result.duration) {
			parts.push(`duration: ${Math.round(result.duration)}s`);
		}
		parts.push(`---`);
		parts.push('');

		const text = result.processed || result.raw;
		parts.push(text);

		return parts.join('\n');
	}

	private buildOutputPath(
		sourceName: string,
		settings: { folder: string; fileNameTemplate: string }
	): string {
		const date = new Date().toISOString().split('T')[0];
		const source = sourceName.replace(/\.[^.]+$/, '');
		const fileName = settings.fileNameTemplate
			.replace('{{date}}', date)
			.replace('{{source}}', source);
		return `${settings.folder}/${fileName}.md`;
	}
}
