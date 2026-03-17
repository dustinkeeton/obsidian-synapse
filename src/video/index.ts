import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { AudioModule, TranscriptionResult } from '../audio';
import { ensureFolder, NotificationManager, sanitizeUrl, buildCallout, CALLOUT_TYPES } from '../shared';
import { AudioExtractor } from './audio-extractor';
import { findVideoUrls } from './note-scanner';
import { VideoMetadata, VideoProcessOptions, VideoUrlEmbed } from './types';
import { detectPlatform } from './url-detector';

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
export { findVideoUrls } from './note-scanner';

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
			id: 'auto-notes:check-dependencies',
			name: 'Check external tool availability',
			callback: () => this.checkDependencies(),
		});
	}

	onunload(): void {}

	/**
	 * Transcribe a video URL and return the transcript text without creating
	 * a note. Used by the summarize module to auto-transcribe video URLs
	 * before summarizing.
	 */
	async transcribeUrl(
		url: string,
		parentOp?: { update: (msg: string) => void }
	): Promise<string> {
		const result = await this.processUrl(url, { insertMode: false }, parentOp);
		return result.processed || result.raw;
	}

	async processUrl(
		url: string,
		options?: VideoProcessOptions,
		parentOp?: { update: (msg: string) => void }
	): Promise<TranscriptionResult & { videoVaultPath?: string }> {
		// Validate URL before processing
		const validatedUrl = sanitizeUrl(url);
		const detected = detectPlatform(validatedUrl);
		const platform = detected?.platform || 'unknown';

		const update = parentOp?.update ?? (() => { /* no-op */ });

		update(`Downloading ${platform} video...`);
		const extraction = await this.extractor.extractFromUrl(validatedUrl);

		// Download the actual video file into the vault
		let videoVaultPath: string | undefined;
		const settings = this.getSettings().video;
		if (settings.downloadFolder) {
			update('Saving video to vault...');
			videoVaultPath = await this.downloadVideoToVault(validatedUrl, extraction.metadata);
		}

		update('Extracting audio...');
		const fs = require('fs') as typeof import('fs');
		const audioData = fs.readFileSync(extraction.audioPath);

		update('Transcribing...');
		const result = await this.audioModule.transcribe(
			audioData.buffer as ArrayBuffer,
			extraction.metadata.title + '.mp3',
			{ sourceName: extraction.metadata.title }
		);

		// Clean up temp audio file
		try {
			fs.unlinkSync(extraction.audioPath);
		} catch {
			// Ignore cleanup errors
		}

		return { ...result, videoVaultPath };
	}

	async transcribeUrlToActiveNote(url: string): Promise<void> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			this.notifications.info('Open a note first to insert the transcription');
			return;
		}

		const op = this.notifications.startOperation(
			'Processing video URL...',
			`video-url-${Date.now()}`
		);
		try {
			const result = await this.processUrl(url, { insertMode: true }, op);
			const text = result.processed || result.raw;

			const blockLines: string[] = [''];

			if (this.getSettings().video.embedInNote && result.videoVaultPath) {
				const fileName = result.videoVaultPath.split('/').pop()!;
				blockLines.push(`![[${fileName}]]`);
				blockLines.push('');
			}

			const callout = buildCallout(
				CALLOUT_TYPES.transcription,
				`Transcription of ${url}`,
				text,
				true
			);
			blockLines.push(callout);

			const content = await this.plugin.app.vault.read(activeFile);
			await this.plugin.app.vault.modify(activeFile, content + blockLines.join('\n'));
			this.onTranscriptionComplete?.(activeFile.path);
			op.finish('Video transcription added to note');
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Video transcription failed — ${msg}`);
		}
	}

	async transcribeAndInsert(
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
				const blockLines: string[] = [''];

				// Embed the downloaded video if setting is on
				if (this.getSettings().video.embedInNote && result.videoVaultPath) {
					const fileName = result.videoVaultPath.split('/').pop()!;
					blockLines.push(`![[${fileName}]]`);
					blockLines.push('');
				}

				const callout = buildCallout(
					CALLOUT_TYPES.transcription,
					`Transcription of ${embed.url}`,
					text,
					true
				);
				blockLines.push(callout);

				lines.splice(embed.line + 1, 0, blockLines.join('\n'));
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

	/**
	 * Download the video file into the vault's download folder.
	 * Returns the vault-relative path to the saved file.
	 */
	private async downloadVideoToVault(url: string, metadata: VideoMetadata): Promise<string> {
		const settings = this.getSettings().video;
		const fs = require('fs') as typeof import('fs');

		await ensureFolder(this.plugin.app, settings.downloadFolder);

		const title = (metadata.title || 'video')
			.replace(/[^a-zA-Z0-9-_ ]/g, '')
			.trim()
			.slice(0, 60);
		const date = new Date().toISOString().split('T')[0];
		const fileName = `${date}-${title}.mp4`;

		// Download via extractor (uses correct PATH and ytDlpPath setting)
		const tempPath = await this.extractor.downloadVideo(url);

		// Read the downloaded file and write it into the vault
		const videoData = fs.readFileSync(tempPath);
		const vaultPath = `${settings.downloadFolder}/${fileName}`;
		await this.plugin.app.vault.adapter.writeBinary(vaultPath, videoData.buffer as ArrayBuffer);

		// Clean up temp video file
		try { fs.unlinkSync(tempPath); } catch { /* ignore */ }

		return vaultPath;
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

}
