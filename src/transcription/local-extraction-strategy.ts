import { Platform } from 'obsidian';
import { isSupportedUrl } from '../shared';
import type { TranscriptionResult } from '../audio';
import type { UrlTranscript, UrlTranscriptOptions, UrlTranscriptionStrategy } from './url-transcription';

/**
 * The desktop extraction pipeline as a callback — wired by main.ts to
 * `VideoModule.processUrl` (yt-dlp download → ffmpeg extract → transcribe),
 * matching the DI style of the other cross-module callbacks so this module
 * never imports the video feature module.
 */
export type LocalExtractionDelegate = (
	url: string,
	opts: UrlTranscriptOptions
) => Promise<TranscriptionResult & { videoVaultPath?: string }>;

/**
 * Tier 2 of URL transcription (#184): the existing desktop yt-dlp/ffmpeg
 * pipeline. Handles every supported platform (YouTube, TikTok, Instagram)
 * and time-range clipping, but only where child processes exist — never on
 * mobile. Failures propagate unchanged so DependencyMissingError keeps
 * driving the yt-dlp/ffmpeg onboarding notice (#382).
 */
export class LocalExtractionStrategy implements UrlTranscriptionStrategy {
	readonly id = 'local-extraction';

	constructor(private readonly delegate: LocalExtractionDelegate) {}

	canHandle(url: string): boolean {
		return Platform.isDesktop && isSupportedUrl(url);
	}

	async transcribe(url: string, opts: UrlTranscriptOptions): Promise<UrlTranscript> {
		const result = await this.delegate(url, opts);
		return {
			text: result.processed || result.raw,
			raw: result.raw,
			source: 'local-extraction',
			title: result.sourceName || undefined,
			language: result.language,
			videoVaultPath: result.videoVaultPath,
			reformatted: result.reformatted,
			schemaId: result.schemaId,
		};
	}
}
