export interface VideoSource {
	type: 'url' | 'file';
	platform?: 'youtube' | 'tiktok' | 'unknown';
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
