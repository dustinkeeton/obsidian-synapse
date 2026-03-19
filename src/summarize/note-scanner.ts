import { ENRICHMENT_START, ENRICHMENT_END } from '../enrichment/enrichment-applier';
import { CALLOUT_TYPES } from '../shared';
import { SummarizeTarget } from './types';

const URL_REGEX = /https?:\/\/[^\s)\]>]+/g;
const TIKTOK_HOST_RE = /(?:vm\.|vt\.)?tiktok\.com/;
const TRANSCRIPTION_HEADER = /^>\s*\*\*Transcription of (.+?)\*\*$/;
const CALLOUT_TRANSCRIPTION_HEADER = new RegExp(
	`^>\\s*\\[!${CALLOUT_TYPES.transcription}\\][-+]?\\s+Transcription of (.+)$`
);
const CALLOUT_SUMMARY_PREFIX = `[!${CALLOUT_TYPES.summary}]`;
const CALLOUT_TRANSCRIPTION_PREFIX = `[!${CALLOUT_TYPES.transcription}]`;
const CALLOUT_ENRICHMENT_PREFIX = `[!${CALLOUT_TYPES.enrichment}]`;

/**
 * Scan note content for URLs and transcription blocks that need summaries.
 * Skips targets that already have a summary block below them.
 * Skips content inside enrichment marker sections (managed by the enrichment module).
 */
export function findSummarizeTargets(content: string): SummarizeTarget[] {
	const lines = content.split('\n');
	const targets: SummarizeTarget[] = [];
	let inEnrichmentSection = false;
	let enrichmentIsCallout = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track enrichment marker sections (legacy comment markers)
		if (line.trim() === ENRICHMENT_START) {
			inEnrichmentSection = true;
			enrichmentIsCallout = false;
			continue;
		}
		if (line.trim() === ENRICHMENT_END) {
			inEnrichmentSection = false;
			continue;
		}

		// Track callout-format enrichment sections
		if (!inEnrichmentSection && line.includes(CALLOUT_ENRICHMENT_PREFIX)) {
			inEnrichmentSection = true;
			enrichmentIsCallout = true;
		}
		// Exit callout-format enrichment when we hit a non-blockquote, non-empty line
		if (inEnrichmentSection && enrichmentIsCallout && !line.startsWith('>') && line.trim() !== '' && !line.includes(CALLOUT_ENRICHMENT_PREFIX)) {
			inEnrichmentSection = false;
			enrichmentIsCallout = false;
		}

		if (inEnrichmentSection) {
			// Detect markdown links in enrichment reference lists
			// Legacy: "- [AI Overview](https://example.com) — reason"
			// Callout: "> - [AI Overview](https://example.com) — reason"
			const strippedLine = enrichmentIsCallout ? line.replace(/^>\s?/, '') : line;
			const mdLinkMatch = strippedLine.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
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

		// Check for transcription block headers (legacy blockquote format)
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
			i = endLine;
			continue;
		}

		// Check for transcription block headers (callout format)
		const calloutTranscriptionMatch = line.match(CALLOUT_TRANSCRIPTION_HEADER);
		if (calloutTranscriptionMatch) {
			const source = calloutTranscriptionMatch[1];
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
 * Strip query parameters and fragment from TikTok URLs for comparison.
 * Non-TikTok URLs are returned unchanged.
 */
function normalizeTikTokUrl(url: string): string {
	if (TIKTOK_HOST_RE.test(url)) {
		return url.replace(/[?#].*$/, '');
	}
	return url;
}

/**
 * Check if a summary block already exists below a given line for the specified source.
 * Looks within 3 lines below, allowing blank lines and blockquotes.
 */
export function hasSummaryBelow(lines: string[], startLine: number, source: string): boolean {
	const normalized = normalizeTikTokUrl(source);
	for (let j = startLine + 1; j < lines.length && j <= startLine + 3; j++) {
		const line = lines[j];
		// Legacy format: > **Summary of <source>**
		if (line.includes(`**Summary of ${source}**`) || line.includes(`**Summary of ${normalized}**`)) {
			return true;
		}
		// Callout format: > [!synapse-summary] Summary of <source>
		if (line.includes(CALLOUT_SUMMARY_PREFIX) && (line.includes(`Summary of ${source}`) || line.includes(`Summary of ${normalized}`))) {
			return true;
		}
		// Stop at non-empty, non-blockquote content
		if (line.trim().length > 0 && !line.startsWith('>') && line.trim() !== '') {
			break;
		}
	}
	return false;
}

/**
 * Check if a transcription block exists below a URL line.
 */
function hasTranscriptionBelow(lines: string[], urlLine: number, url: string): boolean {
	const normalized = normalizeTikTokUrl(url);
	for (let j = urlLine + 1; j < lines.length && j <= urlLine + 5; j++) {
		const line = lines[j];
		// Legacy format: > **Transcription of <url>**
		if (line.includes(`**Transcription of ${url}**`) || line.includes(`**Transcription of ${normalized}**`)) {
			return true;
		}
		// Callout format: > [!synapse-transcription] Transcription of <url>
		if (line.includes(CALLOUT_TRANSCRIPTION_PREFIX) && (line.includes(`Transcription of ${url}`) || line.includes(`Transcription of ${normalized}`))) {
			return true;
		}
		// Stop at non-empty, non-blockquote content
		if (line.trim().length > 0 && !line.startsWith('>') && line.trim() !== '') {
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
