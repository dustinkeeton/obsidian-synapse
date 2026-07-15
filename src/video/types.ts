import type { Platform } from '../shared';

export type { Platform };

export interface VideoSource {
	type: 'url' | 'file';
	platform?: Platform;
	url?: string;
	filePath?: string;
	title?: string;
	channel?: string;
	duration?: number;
}

import { TimeRange } from '../shared';

export interface VideoProcessOptions {
	postProcess?: boolean;
	extractFrames?: boolean;
	outputPath?: string;
	insertMode?: boolean;
	timeRange?: TimeRange;
}

export interface ExtractionResult {
	audioPath: string;
	metadata: VideoMetadata;
}

export interface VideoMetadata {
	title: string;
	channel?: string;
	duration?: number;
	uploadDate?: string;
	description?: string;
	platform?: string;
	url?: string;
}

export interface VideoUrlEmbed {
	url: string;
	platform: Platform;
	line: number;
}

/**
 * Result of the tier-routed URL transcriber injected by main.ts —
 * structurally compatible with `UrlTranscript` from `src/transcription`
 * (declared here so the video module never imports the transcription module,
 * whose barrel imports this one).
 */
export interface RoutedUrlTranscript {
	text: string;
	videoVaultPath?: string;
	reformatted?: boolean;
	schemaId?: string;
}

/**
 * Tier-routed URL transcription callback (captions first, then extraction).
 * Throws on failure — including when no tier can handle the URL.
 */
export type RoutedUrlTranscriber = (
	url: string,
	parentOp?: { update: (message: string) => void }
) => Promise<RoutedUrlTranscript>;
