import { TFile, MetadataCache } from 'obsidian';
import { CALLOUT_TYPES } from '../shared';
import { AudioEmbed } from './types';

export const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i;
export const AUDIO_EMBED_REGEX = /!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|flac|webm|aac))\]\]/gi;

export function findAudioEmbeds(
	content: string,
	sourcePath: string,
	metadataCache: MetadataCache
): AudioEmbed[] {
	const embeds: AudioEmbed[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const matches = [...lines[i].matchAll(AUDIO_EMBED_REGEX)];
		for (const match of matches) {
			const fileName = match[1];

			if (hasTranscriptionBelow(lines, i, fileName)) {
				continue;
			}

			const file = metadataCache.getFirstLinkpathDest(
				fileName,
				sourcePath
			);
			if (file instanceof TFile && AUDIO_EXTENSIONS.test(file.name)) {
				embeds.push({ fileName, file, line: i });
			}
		}
	}

	return embeds;
}

export function hasTranscriptionBelow(lines: string[], embedLine: number, fileName: string): boolean {
	for (let j = embedLine + 1; j < lines.length && j <= embedLine + 3; j++) {
		// Legacy format
		if (lines[j].includes(`**Transcription of ${fileName}**`)) {
			return true;
		}
		// Callout format
		if (lines[j].includes(`[!${CALLOUT_TYPES.transcription}]`) && lines[j].includes(`Transcription of ${fileName}`)) {
			return true;
		}
		// Lyrics callout format (#234): a reformatted song transcript counts as
		// already transcribed, so re-scans don't re-offer transcription.
		if (lines[j].includes(`[!${CALLOUT_TYPES.lyrics}]`) && lines[j].includes(`Lyrics of ${fileName}`)) {
			return true;
		}
		// Stop looking if we hit another embed or non-empty non-blank line that isn't a blockquote
		if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
	}
	return false;
}
