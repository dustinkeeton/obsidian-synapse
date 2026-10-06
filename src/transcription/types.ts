import type { CachedTranscript, TimeRange, TranscriptCacheEntry } from '../shared';
import type { TranscriptionResult } from '../audio';

export interface UrlTranscriptOptions {
	/**
	 * Clip to a time range. Captions cannot clip, so a set range forces the
	 * extraction tiers (CaptionStrategy declines via canHandle).
	 */
	timeRange?: TimeRange;
	/** Progress hook, same shape as NotificationManager operation updates. */
	update?: (message: string) => void;
	/** Skip the transcript store, re-run the tiers, and dispatch their AI post-processing fresh (#488, #527). */
	forceRefresh?: boolean;
}

/** Read/write surface the router needs from `TranscriptCache` (#488). */
export interface TranscriptStore {
	get(url: string, timeRange?: TimeRange): Promise<TranscriptCacheEntry | null>;
	put(url: string, transcript: CachedTranscript, timeRange?: TimeRange): Promise<void>;
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
	/** Poster frame URL for post-op illustrate (#213); never stored in the transcript cache. */
	thumbnailUrl?: string;
	/** Language code, when known. */
	language?: string;
	/** Vault path of a downloaded video file (local extraction only). */
	videoVaultPath?: string;
	/** True when a content schema (#234, e.g. lyrics) reformatted the text. */
	reformatted?: boolean;
	/** Id of the content schema that reformatted the text, if any. */
	schemaId?: string;
	/** True when served from the transcript store instead of a tier (#488). */
	cached?: boolean;
	/** True when a fresh transcript's AI post-processing replayed a cached response (#527); never stored. */
	aiCached?: boolean;
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
 * Result of running a transcript string through the audio module's
 * post-processing pipeline (cleanup + optional schema reformat, #234).
 * Matches the return shape of `AudioModule.processTranscriptText`.
 */
export interface ProcessedTranscript {
	text: string;
	reformatted?: boolean;
	schemaId?: string;
	aiCached?: boolean;
}

export interface ProcessTranscriptOptions {
	update?: (message: string) => void;
	bypassCache?: boolean;
}

export type ProcessTranscript = (raw: string, opts?: ProcessTranscriptOptions) => Promise<ProcessedTranscript>;

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

export interface YouTubeTranscript {
	/**
	 * Cleaned transcript, deterministically structured from the caption
	 * stream's own signals (see `formatCaptionTranscript` in youtube-captions.ts): speaker-turn
	 * paragraphs from `>>` markers, chapter headings from the video
	 * description, and pause-based paragraph breaks from cue timing.
	 */
	text: string;
	/** BCP-47 language code of the selected track (e.g. `en`, `en-US`). */
	language: string;
	/** True when the track is YouTube's auto-generated (ASR) captions. */
	auto: boolean;
	/** Video title from the player response, when present. */
	title?: string;
	/** Largest poster frame from `videoDetails.thumbnail.thumbnails`, when present (#213). */
	thumbnailUrl?: string;
	/**
	 * True when STRONG deterministic structure was found (speaker turns or
	 * chapters) — the text is finished markdown, and AI restructuring would
	 * only degrade it. Weakly-structured transcripts (pause-paragraphed ASR)
	 * still benefit from the AI post-processing pass.
	 */
	structured: boolean;
}

/** One caption cue: a timed slice of transcript text. */
export interface CaptionCue {
	startMs: number;
	endMs: number;
	text: string;
}

/** A chapter declared in the video description (`MM:SS Title` lines). */
export interface VideoChapter {
	title: string;
	startMs: number;
}

/**
 * Result of a duration detection attempt.
 * `durationSeconds` is undefined when detection fails (e.g. missing ffprobe).
 */
export interface DurationResult {
	durationSeconds: number | undefined;
	title: string;
}
