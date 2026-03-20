import { CALLOUT_TYPES } from '../shared';
import { VideoUrlEmbed } from './types';
import { detectPlatform } from './url-detector';

const URL_REGEX = /https?:\/\/[^\s)\]>]+/g;
const CALLOUT_TRANSCRIPTION_PREFIX = `[!${CALLOUT_TYPES.transcription}]`;

export function findVideoUrls(content: string): VideoUrlEmbed[] {
	const embeds: VideoUrlEmbed[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		// Skip blockquote lines — these are transcription output, not user content
		if (lines[i].trimStart().startsWith('>')) continue;

		const matches = [...lines[i].matchAll(URL_REGEX)];
		for (const match of matches) {
			const url = match[0];
			const detected = detectPlatform(url);
			if (!detected || detected.platform === 'twitter') continue;

			if (hasTranscriptionBelow(lines, i, url)) {
				continue;
			}

			embeds.push({
				url,
				platform: detected.platform,
				line: i,
			});
		}
	}

	return embeds;
}

export function hasTranscriptionBelow(lines: string[], embedLine: number, url: string): boolean {
	for (let j = embedLine + 1; j < lines.length && j <= embedLine + 3; j++) {
		// Legacy format
		if (lines[j].includes(`**Transcription of ${url}**`)) {
			return true;
		}
		// Callout format
		if (lines[j].includes(CALLOUT_TRANSCRIPTION_PREFIX) && lines[j].includes(`Transcription of ${url}`)) {
			return true;
		}
		if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
	}
	return false;
}
