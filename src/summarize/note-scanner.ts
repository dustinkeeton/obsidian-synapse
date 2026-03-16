import { ENRICHMENT_START, ENRICHMENT_END } from '../enrichment/enrichment-applier';
import { SummarizeTarget } from './types';

const URL_REGEX = /https?:\/\/[^\s)\]>]+/g;
const TRANSCRIPTION_HEADER = /^>\s*\*\*Transcription of (.+?)\*\*$/;

/**
 * Scan note content for URLs and transcription blocks that need summaries.
 * Skips targets that already have a summary block below them.
 * Skips content inside enrichment marker sections (managed by the enrichment module).
 */
export function findSummarizeTargets(content: string): SummarizeTarget[] {
	const lines = content.split('\n');
	const targets: SummarizeTarget[] = [];
	let inEnrichmentSection = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track enrichment marker sections — content inside is managed
		// by the enrichment module and must not be modified
		if (line.trim() === ENRICHMENT_START) {
			inEnrichmentSection = true;
			continue;
		}
		if (line.trim() === ENRICHMENT_END) {
			inEnrichmentSection = false;
			continue;
		}
		if (inEnrichmentSection) {
			// Detect markdown links in enrichment reference lists
			// e.g. "- [AI Overview](https://example.com) — reason"
			const mdLinkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
			if (mdLinkMatch) {
				targets.push({
					type: 'url',
					source: mdLinkMatch[2],
					line: i,
					endLine: i,
					inEnrichmentSection: true,
					linkTitle: mdLinkMatch[1],
				});
			}
			continue;
		}

		// Check for transcription block headers
		const transcriptionMatch = line.match(TRANSCRIPTION_HEADER);
		if (transcriptionMatch) {
			const source = transcriptionMatch[1];
			const { endLine, text } = extractTranscriptionContent(lines, i);

			if (!hasSummaryBelow(lines, endLine, source)) {
				targets.push({
					type: 'transcription',
					source,
					line: i,
					endLine,
					content: text,
				});
			}
			// Skip past the transcription block
			i = endLine;
			continue;
		}

		// Skip blockquote lines for URL scanning
		if (line.trimStart().startsWith('>')) continue;

		// Scan for URLs
		const matches = [...line.matchAll(URL_REGEX)];
		for (const match of matches) {
			const url = match[0];

			// Check if this URL has a transcription block below — if so,
			// the transcription handler above will cover it
			if (hasTranscriptionBelow(lines, i, url)) continue;

			// Check if this URL already has a summary below
			if (hasSummaryBelow(lines, i, url)) continue;

			targets.push({
				type: 'url',
				source: url,
				line: i,
				endLine: i,
			});
		}
	}

	return targets;
}

/**
 * Check if a summary block already exists below a given line for the specified source.
 * Looks within 3 lines below, allowing blank lines and blockquotes.
 */
export function hasSummaryBelow(lines: string[], startLine: number, source: string): boolean {
	for (let j = startLine + 1; j < lines.length && j <= startLine + 3; j++) {
		if (lines[j].includes(`**Summary of ${source}**`)) {
			return true;
		}
		// Stop at non-empty, non-blockquote content
		if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
	}
	return false;
}

/**
 * Check if a transcription block exists below a URL line.
 */
function hasTranscriptionBelow(lines: string[], urlLine: number, url: string): boolean {
	for (let j = urlLine + 1; j < lines.length && j <= urlLine + 5; j++) {
		if (lines[j].includes(`**Transcription of ${url}**`)) {
			return true;
		}
		// Stop at non-empty, non-blockquote content
		if (lines[j].trim().length > 0 && !lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
	}
	return false;
}

/**
 * Extract the text content from a transcription blockquote block.
 * Returns the end line index and the plain text content.
 */
export function extractTranscriptionContent(lines: string[], headerLine: number): { endLine: number; text: string } {
	const textLines: string[] = [];
	let endLine = headerLine;

	for (let j = headerLine + 1; j < lines.length; j++) {
		if (!lines[j].startsWith('>') && lines[j].trim() !== '') {
			break;
		}
		if (!lines[j].startsWith('>')) {
			// Empty line outside blockquote — end of block
			break;
		}
		endLine = j;
		// Strip the blockquote prefix and collect text
		const stripped = lines[j].replace(/^>\s?/, '');
		textLines.push(stripped);
	}

	return {
		endLine,
		text: textLines.join('\n').trim(),
	};
}
