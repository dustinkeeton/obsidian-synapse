import { scanBlocks, parseCalloutHeader, CALLOUT_TYPES } from '../shared';
import type { RemLinkCandidate } from './types';

/** Region of text to skip during scanning (absolute character offsets). */
export interface SkipRegion {
	start: number;
	end: number;
}

/**
 * Build a list of character ranges to skip during scanning:
 * - YAML frontmatter (--- delimited)
 * - Fenced code blocks
 * - Inline code
 * - Existing wikilinks
 * - Image/file embeds
 * - Markdown links
 * - Synapse-identity callouts (summary, enrichment, deep-dive nav, and every other `CALLOUT_TYPES` identity, either header spelling)
 */
export function buildSkipRegions(content: string): SkipRegion[] {
	const regions: SkipRegion[] = [];

	// Frontmatter: starts at position 0 with ---
	if (content.startsWith('---')) {
		const endIdx = content.indexOf('\n---', 3);
		if (endIdx !== -1) {
			regions.push({ start: 0, end: endIdx + 4 });
		}
	}

	// Fenced code blocks (``` or ~~~)
	const fencedCodeRegex = /^(```|~~~).*\n[\s\S]*?\n\1/gm;
	let match: RegExpExecArray | null;
	while ((match = fencedCodeRegex.exec(content)) !== null) {
		regions.push({ start: match.index, end: match.index + match[0].length });
	}

	// Inline code
	const inlineCodeRegex = /`[^`\n]+`/g;
	while ((match = inlineCodeRegex.exec(content)) !== null) {
		regions.push({ start: match.index, end: match.index + match[0].length });
	}

	// Existing wikilinks and embeds: [[...]] and ![[...]]
	const wikilinkRegex = /!?\[\[[^\]]+\]\]/g;
	while ((match = wikilinkRegex.exec(content)) !== null) {
		regions.push({ start: match.index, end: match.index + match[0].length });
	}

	// Markdown links: [text](url)
	const mdLinkRegex = /\[[^\]]*\]\([^)]*\)/g;
	while ((match = mdLinkRegex.exec(content)) !== null) {
		regions.push({ start: match.index, end: match.index + match[0].length });
	}

	regions.push(...synapseCalloutRegions(content));

	// Sort by start position
	regions.sort((a, b) => a.start - b.start);

	return regions;
}

const SYNAPSE_IDENTITIES: ReadonlySet<string> = new Set(Object.values(CALLOUT_TYPES));

function synapseCalloutRegions(content: string): SkipRegion[] {
	const lines = content.split('\n');
	const lineStarts = lineStartOffsets(lines);
	const regions: SkipRegion[] = [];
	for (const block of scanBlocks(lines)) {
		if (block.type !== 'quote') continue;
		const identity = parseCalloutHeader(lines[block.start])?.identity;
		if (identity === undefined || !SYNAPSE_IDENTITIES.has(identity)) continue;
		regions.push({ start: lineStarts[block.start], end: lineStarts[block.end] + lines[block.end].length });
	}
	return regions;
}

/** Absolute character offset of each line's first character. */
export function lineStartOffsets(lines: string[]): number[] {
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	return starts;
}

/** True when the absolute range overlaps any skip region (regions sorted by start). */
export function isInSkipRegion(absStart: number, absEnd: number, regions: SkipRegion[]): boolean {
	for (const region of regions) {
		if (region.start > absEnd) break;
		if (absStart < region.end && absEnd > region.start) return true;
	}
	return false;
}

/** True when `text[start..end)` has non-word characters (or the string edge) on both sides. */
export function isWordBoundary(text: string, start: number, end: number): boolean {
	if (start > 0 && isWordChar(text[start - 1])) return false;
	if (end < text.length && isWordChar(text[end])) return false;
	return true;
}

function isWordChar(ch: string): boolean {
	return /[\p{L}\p{M}\p{N}_]/u.test(ch);
}

/** Drop occurrences inside skip regions, then candidates left with none. */
export function withoutSkipRegions(candidates: RemLinkCandidate[], content: string): RemLinkCandidate[] {
	if (candidates.length === 0) return candidates;
	const regions = buildSkipRegions(content);
	const lineStarts = lineStartOffsets(content.split('\n'));
	const kept: RemLinkCandidate[] = [];
	for (const candidate of candidates) {
		const occurrences = candidate.occurrences.filter(o => {
			const base = lineStarts[o.lineNumber];
			return base === undefined || !isInSkipRegion(base + o.startOffset, base + o.endOffset, regions);
		});
		if (occurrences.length === 0) continue;
		kept.push(occurrences.length === candidate.occurrences.length ? candidate : { ...candidate, occurrences });
	}
	return kept;
}
