import { Notice, Plugin } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { AudioModule } from '../audio';
import { notifyError } from '../shared/api-utils';
import { ensureFolder, writeNote } from '../shared/file-utils';
import { AudioExtractor } from './audio-extractor';
import { TranscriptionResult } from '../audio/types';
import { VideoMetadata, VideoProcessOptions } from './types';
import { detectPlatform } from './url-detector';
import { VideoTranscriptionModal } from './video-modal';

export class VideoModule {
	private extractor: AudioExtractor;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private audioModule: AudioModule
	) {
		this.extractor = new AudioExtractor(getSettings);
	}

	async onload(): Promise<void> {
		await ensureFolder(
			this.plugin.app,
			this.getSettings().video.tempFolder
		);

		this.plugin.addCommand({
			id: 'auto-notes:transcribe-video-url',
			name: 'Transcribe video from URL',
			callback: () => this.openUrlModal(),
		});

		this.plugin.addCommand({
			id: 'auto-notes:transcribe-video-file',
			name: 'Transcribe local video file',
			callback: () => {
				// TODO: Implement file picker for video files
				new Notice('Auto Notes: Video file transcription coming soon');
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:check-dependencies',
			name: 'Check external tool availability',
			callback: () => this.checkDependencies(),
		});
	}

	onunload(): void {}

	async processUrl(
		url: string,
		options?: VideoProcessOptions
	): Promise<TranscriptionResult> {
		const detected = detectPlatform(url);
		const platform = detected?.platform || 'unknown';

		new Notice(`Auto Notes: Downloading ${platform} video...`);
		const extraction = await this.extractor.extractFromUrl(url);

		new Notice('Auto Notes: Extracting audio...');
		const fs = require('fs') as typeof import('fs');
		const audioData = fs.readFileSync(extraction.audioPath);

		new Notice('Auto Notes: Transcribing...');
		const result = await this.audioModule.transcribe(
			audioData.buffer as ArrayBuffer,
			extraction.metadata.title + '.mp3',
			{ sourceName: extraction.metadata.title }
		);

		// Clean up temp file
		try {
			fs.unlinkSync(extraction.audioPath);
		} catch {
			// Ignore cleanup errors
		}

		// Save with metadata
		const outputPath = options?.outputPath || this.buildOutputPath(extraction.metadata);
		const content = this.formatVideoTranscription(result, extraction.metadata);
		await writeNote(this.plugin.app, outputPath, content);

		new Notice(`Auto Notes: Transcription saved to ${outputPath}`);
		return result;
	}

	private openUrlModal(): void {
		new VideoTranscriptionModal(this.plugin.app, async (url) => {
			try {
				await this.processUrl(url);
			} catch (error) {
				notifyError('Video transcription failed', error);
			}
		}).open();
	}

	private async checkDependencies(): Promise<void> {
		const deps = await this.extractor.checkDependencies();
		const lines: string[] = [];
		lines.push(`yt-dlp: ${deps.ytDlp ? 'Found' : 'NOT FOUND'}`);
		lines.push(`ffmpeg: ${deps.ffmpeg ? 'Found' : 'NOT FOUND'}`);

		if (!deps.ytDlp || !deps.ffmpeg) {
			lines.push('');
			lines.push('Install missing tools:');
			if (!deps.ytDlp) lines.push('  brew install yt-dlp');
			if (!deps.ffmpeg) lines.push('  brew install ffmpeg');
		}

		new Notice(lines.join('\n'), deps.ytDlp && deps.ffmpeg ? 5000 : 15000);
	}

	private formatVideoTranscription(
		result: TranscriptionResult,
		metadata: VideoMetadata
	): string {
		const settings = this.getSettings().video.output;
		const parts: string[] = [];

		parts.push('---');
		parts.push(`source: ${metadata.title}`);
		parts.push(`date: ${new Date().toISOString().split('T')[0]}`);
		if (settings.includeVideoMetadata) {
			if (metadata.platform) parts.push(`platform: ${metadata.platform}`);
			if (metadata.channel) parts.push(`channel: ${metadata.channel}`);
			if (metadata.duration) parts.push(`duration: ${Math.round(metadata.duration)}s`);
			if (metadata.url) parts.push(`url: "${metadata.url}"`);
		}
		parts.push('---');
		parts.push('');

		const text = result.processed || result.raw;
		parts.push(text);

		return parts.join('\n');
	}

	private buildOutputPath(metadata: VideoMetadata): string {
		const settings = this.getSettings().video.output;
		const date = new Date().toISOString().split('T')[0];
		const title = (metadata.title || 'video')
			.replace(/[^a-zA-Z0-9-_ ]/g, '')
			.slice(0, 60);
		const fileName = settings.fileNameTemplate
			.replace('{{date}}', date)
			.replace('{{title}}', title);
		return `${settings.folder}/${fileName}.md`;
	}
}
