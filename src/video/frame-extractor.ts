import { AutoNotesSettings } from '../settings';

// Stretch goal: frame extraction and vision analysis
// This module is a placeholder for future implementation

export class FrameExtractor {
	constructor(private getSettings: () => AutoNotesSettings) {}

	async extractFrames(_videoPath: string): Promise<string[]> {
		const settings = this.getSettings().video.frameExtraction;
		if (!settings.enabled) {
			return [];
		}

		// Future implementation:
		// 1. Use ffmpeg to extract frames at settings.intervalSeconds intervals
		// 2. Cap at settings.maxFrames
		// 3. Send frames to vision model for analysis
		// 4. Return descriptions

		throw new Error('Frame extraction is not yet implemented');
	}
}
