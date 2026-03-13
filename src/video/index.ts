import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { AudioModule, TranscriptionResult } from '../audio';
import { ensureFolder, NotificationManager, sanitizeUrl, writeNote } from '../shared';
import { AudioExtractor } from './audio-extractor';
import { NoteVideoModal } from './note-video-modal';
import { findVideoUrls } from './note-scanner';
import { VideoMetadata, VideoProcessOptions, VideoUrlEmbed } from './types';
import { detectPlatform, isSupportedUrl } from './url-detector';
import { VideoTranscriptionModal } from './video-modal';

export type {
	ExtractionResult,
	Platform,
	UrlDetectionResult,
	VideoMetadata,
	VideoProcessOptions,
	VideoSource,
	VideoUrlEmbed,
} from './types';
export { detectPlatform, isSupportedUrl } from './url-detector';

export class VideoModule {
	private extractor: AudioExtractor;

	/** Optional callback invoked after video transcription completes. Wired by main.ts for enrichment. */
	onTranscriptionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private audioModule: AudioModule,
		private notifications: NotificationManager
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
			id: 'auto-notes:transcribe-note-video',
			name: 'Transcribe video URLs from current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.transcribeFromNote(ctx.file);
				}
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:transcribe-video-file',
			name: 'Transcribe local video file',
			callback: () => {
				this.notifications.info('Video file transcription coming soon');
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
		options?: VideoProcessOptions,
		parentOp?: { update: (msg: string) => void }
	): Promise<TranscriptionResult> {
		// Validate URL before processing
		const validatedUrl = sanitizeUrl(url);
		const detected = detectPlatform(validatedUrl);
		const platform = detected?.platform || 'unknown';

		const update = parentOp?.update ?? ((msg: string) => { /* no-op */ });

		update(`Downloading ${platform} video...`);
		const extraction = await this.extractor.extractFromUrl(validatedUrl);

		update('Extracting audio...');
		const fs = require('fs') as typeof import('fs');
		const audioData = fs.readFileSync(extraction.audioPath);

		update('Transcribing...');
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

		// In insert mode, caller handles placement — skip file creation
		if (!options?.insertMode) {
			const outputPath = options?.outputPath || this.buildOutputPath(extraction.metadata);
			const content = this.formatVideoTranscription(result, extraction.metadata);
			await writeNote(this.plugin.app, outputPath, content);
			this.notifications.info(`Transcription saved to ${outputPath}`);
			this.onTranscriptionComplete?.(outputPath);
		}

		return result;
	}

	private async transcribeFromNote(noteFile: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(noteFile);
		const embeds = findVideoUrls(content);

		if (embeds.length === 0) {
			this.notifications.info('No video URLs found in this note');
			return;
		}

		new NoteVideoModal(
			this.plugin.app,
			embeds,
			async (selected) => {
				await this.transcribeAndInsert(noteFile, selected);
			}
		).open();
	}

	private async transcribeAndInsert(
		noteFile: TFile,
		embeds: VideoUrlEmbed[]
	): Promise<void> {
		const total = embeds.length;
		let completed = 0;

		const op = this.notifications.startOperation(
			`Transcribing ${total} video(s)...`,
			`video-batch-${noteFile.path}`
		);

		// Process in reverse line order so insertions don't shift line numbers
		const sorted = [...embeds].sort((a, b) => b.line - a.line);

		let content = await this.plugin.app.vault.read(noteFile);

		for (let i = 0; i < sorted.length; i++) {
			if (op.cancelled) break;
			const embed = sorted[i];
			if (i > 0) {
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			try {
				op.progress(completed + 1, total, 'Transcribing video');
				const result = await this.processUrl(embed.url, { insertMode: true }, op);
				const text = result.processed || result.raw;

				const lines = content.split('\n');
				const transcriptionBlock = [
					'',
					`> **Transcription of ${embed.url}**`,
					'>',
					...text.split('\n').map(line => `> ${line}`),
					'',
				].join('\n');

				lines.splice(embed.line + 1, 0, transcriptionBlock);
				content = lines.join('\n');

				completed++;
			} catch (error) {
				this.notifications.notifyError(`Video transcription failed for ${embed.url}`, error);
			}
		}

		if (completed > 0) {
			await this.plugin.app.vault.modify(noteFile, content);
			this.onTranscriptionComplete?.(noteFile.path);
		}
		if (!op.cancelled) {
			op.finish(`Done — ${completed}/${total} video transcriptions added`);
		}
	}

	private openUrlModal(): void {
		new VideoTranscriptionModal(this.plugin.app, async (url) => {
			const op = this.notifications.startOperation(
				'Processing video URL...',
				`video-url-${Date.now()}`
			);
			try {
				await this.processUrl(url, undefined, op);
				op.finish('Video transcription saved');
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				op.error(`Video transcription failed — ${msg}`);
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

		const duration = deps.ytDlp && deps.ffmpeg ? 5000 : 15000;
		this.notifications.info(lines.join('\n'), duration);
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
