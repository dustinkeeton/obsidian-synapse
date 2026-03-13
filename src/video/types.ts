export type Platform = 'youtube' | 'tiktok' | 'unknown';

export interface UrlDetectionResult {
	platform: Platform;
	videoId: string;
	url: string;
}

export interface VideoSource {
	type: 'url' | 'file';
	platform?: Platform;
	url?: string;
	filePath?: string;
	title?: string;
	channel?: string;
	duration?: number;
}

export interface VideoProcessOptions {
	postProcess?: boolean;
	extractFrames?: boolean;
	outputPath?: string;
	insertMode?: boolean;
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
