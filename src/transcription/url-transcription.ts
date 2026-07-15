import { Platform } from 'obsidian';
import { buildCallout, calloutForTranscriptionResult, formatTimeRange } from '../shared';
import type { TimeRange } from '../shared';

/**
 * URL transcription router (#184) — the platform seam between "transcribe this
 * video/audio URL" and the tiers that can actually do it:
 *
 *   1. captions          — YouTube caption fetch over HTTP (all platforms)
 *   2. local-extraction  — yt-dlp/ffmpeg download + transcribe (desktop only)
 *   3. server-extraction — self-hosted extractor endpoint (planned, #181)
 *
 * Strategies are tried in order. A strategy returns `null` to mean "not my
 * video, fall through" (e.g. captionless YouTube); a throw is a REAL failure
 * (bad credentials, missing yt-dlp) and propagates unchanged so typed errors
 * like DependencyMissingError keep driving their dedicated UX (#382). When
 * every tier is exhausted the router throws {@link NoTranscriptionPathError}
 * with a platform-aware message.
 *
 * Deliberately lighter than the `MediaExtractor` interface proposed in #180:
 * the unit of exchange here is a *transcript*, not extracted audio, so a tier
 * like captions — which never produces audio — fits naturally.
 */

export interface UrlTranscriptOptions {
	/**
	 * Clip to a time range. Captions cannot clip, so a set range forces the
	 * extraction tiers (CaptionStrategy declines via canHandle).
	 */
	timeRange?: TimeRange;
	/** Progress hook, same shape as NotificationManager operation updates. */
	update?: (message: string) => void;
}

export interface UrlTranscript {
	/** Final transcript (post-processed when available, else raw). */
	text: string;
	/** Unprocessed transcript. */
	raw: string;
	/** Which tier produced the transcript. */
	source: 'captions' | 'local-extraction';
	/** Video title, when the tier could determine one. */
	title?: string;
	/** Language code, when known. */
	language?: string;
	/** Vault path of a downloaded video file (local extraction only). */
	videoVaultPath?: string;
	/** True when a content schema (#234, e.g. lyrics) reformatted the text. */
	reformatted?: boolean;
	/** Id of the content schema that reformatted the text, if any. */
	schemaId?: string;
}

export interface UrlTranscriptionStrategy {
	/** Stable identifier used in diagnostics and error summaries. */
	readonly id: string;
	/** Cheap applicability gate — platform/url/settings only, no network. */
	canHandle(url: string, opts: UrlTranscriptOptions): boolean;
	/**
	 * Produce a transcript, or `null` to fall through to the next tier (e.g.
	 * the video has no captions). Throw only on a real failure.
	 */
	transcribe(url: string, opts: UrlTranscriptOptions): Promise<UrlTranscript | null>;
}

/**
 * Thrown when no strategy could transcribe a URL. The message is written for
 * the end user and is platform-aware: on mobile it explains the desktop/sync
 * handoff (an intake note is left un-stamped, so a synced desktop vault's
 * watcher picks it up and finishes the job).
 */
export class NoTranscriptionPathError extends Error {
	constructor(
		public readonly url: string,
		public readonly attempts: string[]
	) {
		super(NoTranscriptionPathError.buildMessage(url, attempts));
		this.name = 'NoTranscriptionPathError';
	}

	private static buildMessage(url: string, attempts: string[]): string {
		const detail = attempts.length > 0 ? ` (${attempts.join('; ')})` : '';
		if (Platform.isDesktop) {
			return `No transcription path available for ${url}${detail}`;
		}
		return (
			`Can't transcribe ${url} on mobile yet — TikTok/Instagram and caption-less ` +
			'videos need the Synapse desktop app (yt-dlp + ffmpeg). In a synced vault, ' +
			'leave the note in the intake folder and the desktop app will process it.'
		);
	}
}

export class UrlTranscriptionRouter {
	constructor(private readonly strategies: UrlTranscriptionStrategy[]) {}

	/**
	 * Try each strategy in order; first transcript wins. Real strategy failures
	 * propagate unchanged; exhausting every tier throws
	 * {@link NoTranscriptionPathError}.
	 */
	async transcribe(url: string, opts: UrlTranscriptOptions = {}): Promise<UrlTranscript> {
		const attempts: string[] = [];
		for (const strategy of this.strategies) {
			if (!strategy.canHandle(url, opts)) {
				attempts.push(`${strategy.id}: not applicable`);
				continue;
			}
			const result = await strategy.transcribe(url, opts);
			if (result) {
				return result;
			}
			attempts.push(`${strategy.id}: unavailable for this video`);
		}
		throw new NoTranscriptionPathError(url, attempts);
	}
}

/**
 * Build the note block for a URL transcript — the single place that mirrors
 * the desktop VideoModule output shape (optional `![[video]]` embed, then a
 * collapsed transcription/lyrics callout), so caption- and extraction-sourced
 * transcripts render identically wherever they land.
 */
export function buildUrlTranscriptBlock(
	result: UrlTranscript,
	url: string,
	embedInNote: boolean,
	timeRange?: TimeRange
): string {
	const blockLines: string[] = [''];

	if (embedInNote && result.videoVaultPath) {
		const fileName = result.videoVaultPath.split('/').pop()!;
		blockLines.push(`![[${fileName}]]`);
		blockLines.push('');
	}

	const { type, verb } = calloutForTranscriptionResult(result);
	const title = timeRange
		? `${verb} ${url} ${formatTimeRange(timeRange)}`
		: `${verb} ${url}`;
	blockLines.push(buildCallout(type, title, result.text, true));

	return blockLines.join('\n');
}
