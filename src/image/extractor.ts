import { AIClient, NotificationManager, arrayBufferToBase64, preprocessImage } from '../shared';
import type { AIRequestOptions, ContentBlock } from '../shared';
import { SynapseSettings } from '../settings';
import { OCRResult } from './types';

export class ImageExtractor {
	private aiClient: AIClient;

	constructor(
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager
	) {
		this.aiClient = new AIClient(getSettings);
	}

	async extract(imageData: ArrayBuffer, fileName: string, aiOpts?: AIRequestOptions): Promise<OCRResult> {
		const settings = this.getSettings();
		const sourceMediaType = this.getMediaType(fileName);

		const maxBytes = (settings.image.maxImageSizeMb || 5) * 1024 * 1024;
		const processed = await preprocessImage(imageData, sourceMediaType, maxBytes);
		if (processed.downscaled) {
			// Routed through the manager so the 3s dedup collapses this otherwise
			// once-per-image flood into a single toast (#396).
			this.notifications.info('Large image auto-downscaled to fit the API limit');
		}

		const base64 = arrayBufferToBase64(processed.data);
		const mediaType = processed.mediaType;

		const contentBlocks: ContentBlock[] = [
			{
				type: 'image',
				data: base64,
				mediaType,
			},
			{
				type: 'text',
				text: 'Extract all visible text from this image. Return only the extracted text, preserving the original layout and formatting as much as possible. If no text is found, respond with "No text detected."',
			},
		];

		const text = await this.aiClient.chat([
			{ role: 'system', content: 'You are an OCR assistant. Extract text from images accurately.' },
			{ role: 'user', content: contentBlocks },
		], { ...aiOpts, model: settings.image.visionModel || settings.ai.model });
		return { text, sourceName: fileName };
	}

	private getMediaType(fileName: string): string {
		const ext = fileName.split('.').pop()?.toLowerCase() || '';
		const mimeMap: Record<string, string> = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			webp: 'image/webp',
			bmp: 'image/bmp',
			tiff: 'image/tiff',
		};
		return mimeMap[ext] || 'image/png';
	}
}
