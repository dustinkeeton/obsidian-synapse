import { AIClient } from '../shared';
import { SynapseSettings } from '../settings';
import { ContentBlock } from '../shared/types';
import { OCRResult } from './types';

export class ImageExtractor {
	private aiClient: AIClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.aiClient = new AIClient(getSettings);
	}

	async extract(imageData: ArrayBuffer, fileName: string): Promise<OCRResult> {
		const base64 = this.arrayBufferToBase64(imageData);
		const mediaType = this.getMediaType(fileName);
		const settings = this.getSettings();

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

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
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
