import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { CommandRegistrar } from '../commands';
import { AudioModule, TranscriptionResult } from '../audio';
import {
	ensureFolder, NotificationManager, sanitizeUrl, buildCallout, CALLOUT_TYPES,
	CheckpointManager, generateId, formatTimeRange, detectPlatform,
} from '../shared';
import type { TimeRange } from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { AudioExtractor } from './audio-extractor';
import { findVideoUrls } from './note-scanner';
import { VideoMetadata, VideoProcessOptions, VideoUrlEmbed } from './types';

export type {
	ExtractionResult,
	VideoMetadata,
	VideoProcessOptions,
	VideoSource,
	VideoUrlEmbed,
} from './types';
export type { Platform, UrlDetectionResult } from '../shared';
export { AudioExtractor } from './audio-extractor';
export { detectPlatform, isSupportedUrl } from '../shared';
export { findVideoUrls } from './note-scanner';

export class VideoModule {
	private extractor: AudioExtractor;

	/** Optional callback invoked after video transcription completes. Wired by main.ts for enrichment. */
	onTranscriptionComplete: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private audioModule: AudioModule,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager,
		private registrar: CommandRegistrar
	) {
		this.extractor = new AudioExtractor(getSettings);
	}

	async onload(): Promise<void> {
		await ensureFolder(
			this.plugin.app,
			this.getSettings().video.tempFolder
		);

		this.registrar.register('check-dependencies', this.getSettings().video.enabled, {
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
		let extraction;
		try {
			extraction = await this.extractor.extractFromUrl(validatedUrl);
		} catch (e) {
			throw new Error(`Download/audio extraction failed: ${e instanceof Error ? e.message : String(e)}`);
		}

		// Download the actual video file into the vault
		let videoVaultPath: string | undefined;
		const settings = this.getSettings().video;
		if (settings.downloadFolder) {
			update('Saving video to vault...');
			videoVaultPath = await this.downloadVideoToVault(validatedUrl, extraction.metadata);
		}

		update('Extracting audio...');
		const fs = require('fs') as typeof import('fs');

		let audioPath = extraction.audioPath;

		// Clip audio to time range if specified
		if (options?.timeRange) {
			const { startSeconds, endSeconds } = options.timeRange;
			if (extraction.metadata.duration && endSeconds > extraction.metadata.duration) {
				throw new Error(
					`End time (${endSeconds}s) exceeds video duration (${extraction.metadata.duration}s)`
				);
			}
			update('Clipping audio to time range...');
			const clippedPath = await this.extractor.clipAudio(audioPath, startSeconds, endSeconds);
			// Clean up the original unclipped audio
			try { await fs.promises.unlink(audioPath); } catch { /* ignore */ }
			audioPath = clippedPath;
		}

		const audioData = await fs.promises.readFile(audioPath);

		update('Transcribing...');
		let result;
		try {
			result = await this.audioModule.transcribe(
				audioData.buffer as ArrayBuffer,
				extraction.metadata.title + '.mp3',
				{ sourceName: extraction.metadata.title }
			);
		} catch (e) {
			throw new Error(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
		}

		// Clean up temp audio file
		try {
			await fs.promises.unlink(audioPath);
		} catch {
			// Ignore cleanup errors
		}

		return { ...result, videoVaultPath };
	}

	async transcribeUrlToActiveNote(url: string, timeRange?: TimeRange): Promise<void> {
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
			const result = await this.processUrl(url, { insertMode: true, timeRange }, op);
			const text = result.processed || result.raw;

			const blockLines: string[] = [''];

			if (this.getSettings().video.embedInNote && result.videoVaultPath) {
				const fileName = result.videoVaultPath.split('/').pop()!;
				blockLines.push(`![[${fileName}]]`);
				blockLines.push('');
			}

			const title = timeRange
				? `Transcription of ${url} ${formatTimeRange(timeRange)}`
				: `Transcription of ${url}`;
			const callout = buildCallout(
				CALLOUT_TYPES.transcription,
				title,
				text,
				true
			);
			blockLines.push(callout);

			const block = blockLines.join('\n');
			await this.plugin.app.vault.process(activeFile, (data) => data + block);
			this.onTranscriptionComplete?.(activeFile.path);
			op.finish('Video transcription added to note');
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Video transcription failed -- ${msg}`);
		}
	}

	/**
	 * Resume video transcription from a checkpoint (C1).
	 * The remaining video files are re-processed.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		this.notifications.info(
			`Video checkpoint has ${checkpoint.remainingItems.length} remaining items. ` +
			`Completed items are already saved. Please re-run transcription on the source note to continue.`
		);
		await this.checkpointManager.discard(checkpoint.id);
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

		// Create checkpoint for batch video transcription
		const checkpointItems: CheckpointWorkItem[] = embeds.map((e, i) => ({
			id: `video-${i}-${e.url}`,
			label: e.url,
			payload: { url: e.url, line: e.line } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'video',
			operationLabel: `Video transcription: ${noteFile.basename} (${total} videos)`,
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

		// Queue insertions (keyed by original line) and apply them atomically
		// against fresh content after all transcription completes.
		const inserts: Array<{ line: number; block: string }> = [];

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

				inserts.push({ line: embed.line, block: blockLines.join('\n') });

				completed++;

				// Save checkpoint progress
				const cpItemId = checkpointItems.find(
					(ci) => ci.payload.url === embed.url
				)?.id;
				if (cpItemId) {
					await this.checkpointManager.completeItem(checkpoint.id, cpItemId);
				}
			} catch (error) {
				this.notifications.notifyError(`Video transcription failed for ${embed.url}`, error);
			}
		}

		if (completed > 0) {
			// Apply all inserts atomically against fresh content; reverse-line
			// ordering means later splices are unaffected by earlier ones.
			await this.plugin.app.vault.process(noteFile, (data) => {
				const lines = data.split('\n');
				for (const ins of inserts) {
					lines.splice(ins.line + 1, 0, ins.block);
				}
				return lines.join('\n');
			});
			this.onTranscriptionComplete?.(noteFile.path);
		}
		if (op.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
		} else {
			// Mark checkpoint completed and dispatch deferred tasks (I1)
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			op.finish(`Done -- ${completed}/${total} video transcriptions added`);
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
		const videoData = await fs.promises.readFile(tempPath);
		const vaultPath = `${settings.downloadFolder}/${fileName}`;
		await this.plugin.app.vault.adapter.writeBinary(vaultPath, videoData.buffer as ArrayBuffer);

		// Clean up temp video file
		try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }

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

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					// Video module doesn't have a direct view refresh callback,
					// but the deferred task system ensures it runs via main.ts dispatch
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

// Settings section renderer (#243)
export { renderVideoSettings } from './settings-section';
