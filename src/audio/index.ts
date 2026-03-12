import { Notice, Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { notifyError } from '../shared/api-utils';
import { writeNote } from '../shared/file-utils';
import { PostProcessor } from './post-processor';
import { Transcriber } from './transcriber';
import { AudioTranscriptionModal } from './transcription-modal';
import { TranscribeOptions, TranscriptionResult } from './types';

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

	private openTranscriptionModal(): void {
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
