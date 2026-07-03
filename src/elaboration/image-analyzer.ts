import { App, TFile } from 'obsidian';
import { AIClient, arrayBufferToBase64, NotificationManager, redactError } from '../shared';
import type { ContentBlock } from '../shared';
import { SynapseSettings } from '../settings';
import { preprocessImage } from '../image';

export interface ImageAnalysis {
	/** Original reference as it appears in the note */
	reference: string;
	/** AI-generated description of the image */
	description: string;
	/** Location hints from visual clues (landmarks, signs, etc.) */
	locationHints: string;
	/** Metadata observations (date clues, camera details from visible UI, etc.) */
	metadata: string;
}

/** Maximum number of images to analyze per note to avoid token overflow */
export const MAX_IMAGES_PER_NOTE = 5;

/** Regex patterns for finding image references in notes */
const WIKI_IMAGE_REGEX = /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff))\]\]/gi;
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

export class ImageAnalyzer {
	private aiClient: AIClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager
	) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Find all image references in a note's content.
	 * Returns both wiki-link (![[file]]) and markdown (![alt](url)) references.
	 */
	findImageReferences(content: string): Array<{ reference: string; path: string; isInternal: boolean }> {
		const refs: Array<{ reference: string; path: string; isInternal: boolean }> = [];
		const seen = new Set<string>();

		// Find wiki-link images: ![[image.png]]
		let match;
		const wikiRegex = new RegExp(WIKI_IMAGE_REGEX.source, WIKI_IMAGE_REGEX.flags);
		while ((match = wikiRegex.exec(content)) !== null) {
			const path = match[1];
			if (!seen.has(path)) {
				seen.add(path);
				refs.push({ reference: match[0], path, isInternal: true });
			}
		}

		// Find markdown images: ![alt](url)
		const mdRegex = new RegExp(MARKDOWN_IMAGE_REGEX.source, MARKDOWN_IMAGE_REGEX.flags);
		while ((match = mdRegex.exec(content)) !== null) {
			const url = match[2];
			// Skip external URLs -- we can only analyze vault images
			if (url.startsWith('http://') || url.startsWith('https://')) continue;
			if (!seen.has(url)) {
				seen.add(url);
				refs.push({ reference: match[0], path: url, isInternal: true });
			}
		}

		return refs.slice(0, MAX_IMAGES_PER_NOTE);
	}

	/**
	 * Analyze all images found in a note.
	 * Returns descriptions for each image that could be resolved and analyzed.
	 */
	async analyzeImagesInNote(notePath: string, content: string): Promise<ImageAnalysis[]> {
		const refs = this.findImageReferences(content);
		if (refs.length === 0) return [];

		const settings = this.getSettings();
		if (!settings.image.enabled) return [];

		const results: ImageAnalysis[] = [];

		for (const ref of refs) {
			try {
				const analysis = await this.analyzeImage(ref, notePath);
				if (analysis) {
					results.push(analysis);
				}
			} catch (error) {
				console.warn(`[Synapse] Failed to analyze image ${ref.path}:`, redactError(error));
				// Graceful degradation -- skip this image and continue
			}
		}

		return results;
	}

	private async analyzeImage(
		ref: { reference: string; path: string; isInternal: boolean },
		notePath: string
	): Promise<ImageAnalysis | null> {
		// Resolve the vault file
		const file = this.app.metadataCache.getFirstLinkpathDest(ref.path, notePath);
		if (!(file instanceof TFile)) {
			console.warn(`[Synapse] Could not resolve image: ${ref.path}`);
			return null;
		}

		// Read binary data
		const data = await this.app.vault.readBinary(file);
		const sourceMediaType = this.getMediaType(file.name);

		// Apply vision model override if configured
		const settings = this.getSettings();

		// Downscale oversized images so they fit under the API's base64 size limit.
		const maxBytes = (settings.image.maxImageSizeMb || 5) * 1024 * 1024;
		const processed = await preprocessImage(data, sourceMediaType, maxBytes);
		if (processed.downscaled) {
			// Routed through the manager so the 3s dedup collapses this otherwise
			// once-per-image flood into a single toast (#396).
			this.notifications.info('Large image auto-downscaled to fit the API limit');
		}
		const base64 = arrayBufferToBase64(processed.data);
		const mediaType = processed.mediaType;

		const visionModel = settings.image.visionModel || settings.ai.model;
		const originalModel = settings.ai.model;
		if (visionModel !== originalModel) {
			settings.ai.model = visionModel;
		}

		try {
			const contentBlocks: ContentBlock[] = [
				{
					type: 'image',
					data: base64,
					mediaType,
				},
				{
					type: 'text',
					text: `Analyze this image and provide a structured response with exactly these three sections:

DESCRIPTION: A concise description of what the image shows (objects, people, scenes, text, diagrams, etc.)

LOCATION: Any location hints visible in the image (landmarks, signs, GPS overlays, language on signs, architectural style, vegetation). If no location clues are visible, write "No location clues detected."

METADATA: Any observable metadata clues (timestamps visible in the image, camera UI elements, watermarks, image quality observations, apparent time of day from lighting). If nothing notable, write "No metadata observations."`,
				},
			];

			const response = await this.aiClient.chat([
				{
					role: 'system',
					content: 'You are an image analysis assistant. Analyze images and provide structured descriptions. Be concise but thorough. Focus on factual observations.',
				},
				{ role: 'user', content: contentBlocks },
			]);

			return this.parseAnalysisResponse(ref.reference, response);
		} finally {
			if (visionModel !== originalModel) {
				settings.ai.model = originalModel;
			}
		}
	}

	/**
	 * Parse a structured AI response into an ImageAnalysis object.
	 * Exported for testability.
	 */
	parseAnalysisResponse(reference: string, response: string): ImageAnalysis {
		// Parse the structured response into sections
		const descMatch = response.match(/DESCRIPTION:\s*([\s\S]*?)(?=LOCATION:|$)/i);
		const locMatch = response.match(/LOCATION:\s*([\s\S]*?)(?=METADATA:|$)/i);
		const metaMatch = response.match(/METADATA:\s*([\s\S]*?)$/i);

		return {
			reference,
			description: descMatch?.[1]?.trim() || response.trim(),
			locationHints: locMatch?.[1]?.trim() || '',
			metadata: metaMatch?.[1]?.trim() || '',
		};
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
