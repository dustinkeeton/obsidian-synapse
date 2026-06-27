import { AIClient, NotificationManager } from '../shared';
import type { ContentBlock } from '../shared';
import { SynapseSettings } from '../settings';
import { OCRResult } from './types';
import { arrayBufferToBase64, preprocessImage } from './preprocess';

export class ImageExtractor {
	private aiClient: AIClient;

	constructor(
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager
	) {
		this.aiClient = new AIClient(getSettings);
	}

	async extract(imageData: ArrayBuffer, fileName: string): Promise<OCRResult> {
		const settings = this.getSettings();
		const sourceMediaType = this.getMediaType(fileName);

		const maxBytes = (settings.image.maxImageSizeMb || 5) * 1024 * 1024;
		const processed = await preprocessImage(imageData, sourceMediaType, maxBytes);
		if (processed.downscaled) {
			// Routed through the manager so the 3s dedup collapses this otherwise
			// once-per-image flood into a single toast (#396).
			this.notifications.info('large image auto-downscaled to fit the API limit');
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

		// Use the configured vision model or fall back to the default AI model
		const visionModel = settings.image.visionModel || settings.ai.model;

		// Temporarily override the model for this request if a vision model is set
		const originalModel = settings.ai.model;
		if (visionModel !== originalModel) {
			settings.ai.model = visionModel;
		}

		try {
			const text = await this.aiClient.chat([
				{ role: 'system', content: 'You are an OCR assistant. Extract text from images accurately.' },
				{ role: 'user', content: contentBlocks },
			]);
			return { text, sourceName: fileName };
		} finally {
			if (visionModel !== originalModel) {
				settings.ai.model = originalModel;
			}
		}
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
