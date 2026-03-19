import { TFile, MetadataCache } from 'obsidian';
import { CALLOUT_TYPES } from '../shared';
import { ImageEmbed } from './types';

export const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i;
export const IMAGE_EMBED_REGEX = /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff))\]\]/gi;

export function findImageEmbeds(
	content: string,
	sourcePath: string,
	metadataCache: MetadataCache
): ImageEmbed[] {
	const embeds: ImageEmbed[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const matches = [...lines[i].matchAll(IMAGE_EMBED_REGEX)];
		for (const match of matches) {
			const fileName = match[1];

			if (hasExtractionBelow(lines, i, fileName)) {
				continue;
			}

			const file = metadataCache.getFirstLinkpathDest(
				fileName,
				sourcePath
			);
			if (file instanceof TFile && IMAGE_EXTENSIONS.test(file.name)) {
				embeds.push({ fileName, file, line: i });
			}
		}
	}

	return embeds;
}

export function hasExtractionBelow(lines: string[], embedLine: number, fileName: string): boolean {
	for (let j = embedLine + 1; j < lines.length && j <= embedLine + 3; j++) {
		// Legacy format
		if (lines[j].includes(`**OCR of ${fileName}**`)) {
			return true;
		}
		// Callout format
		if (lines[j].includes(`[!${CALLOUT_TYPES.ocr}]`) && lines[j].includes(`OCR of ${fileName}`)) {
			return true;
		}
		// Stop looking if we hit another embed or non-empty non-blank line that isn't a blockquote
		if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
	}
	return false;
}
