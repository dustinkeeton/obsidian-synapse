import { parseFrontmatter, serializeFrontmatter } from './frontmatter-utils';
import { findMarkerRegions, markerAttrsMatch } from './markers';
import type { MarkerAttrs } from './markers';

/** Where a proposal wants to land: a heading, the paragraph that opens with `text`, or the end of the note. */
export interface InsertionAnchor {
	kind: 'heading' | 'paragraph' | 'end';
	text: string;
}

export type InsertionStrategy = 'after-heading' | 'after-section-lead' | 'after-paragraph' | 'append';

/** Structural block kinds the resolver never splits. */
export type InsertionBlockType = 'paragraph' | 'heading' | 'code' | 'list' | 'table' | 'quote' | 'html' | 'math';

/** The part of a note a previous action produced, so a follow-up can place content inside it. */
export type RegionLocator =
	| { kind: 'callout'; calloutType: string; title?: string }
	| { kind: 'marker'; marker: string; attrs?: MarkerAttrs }
	| { kind: 'whole-note' };

export interface ResolveInsertionOptions {
	/** Restrict matching to this region; a miss resolves to the region's end, never the note's. */
	within?: RegionLocator;
	/** Descend into quote/callout blocks and insert after the inner block instead of after the whole quote. */
	insideContainers?: boolean;
}

/** Output of {@link resolveInsertionPoint}; `line` is the body line index the block goes after (null for append). */
export interface ResolvedInsertion {
	strategy: InsertionStrategy;
	line: number | null;
	matchedText: string | null;
	anchor: InsertionAnchor;
	/** Kind of the block the insertion follows; absent for append. */
	blockType?: InsertionBlockType;
	/** Set when the insertion lands inside a quote/callout: every inserted line must carry `prefix`. */
	container?: { prefix: string; label: string };
}

export interface StructBlock {
	type: InsertionBlockType;
	start: number;
	end: number;
	/** Quote blocks: the one-level prefix to strip/add (`> `) and the scan of the de-prefixed lines (indexes relative to `start`). */
	prefix?: string;
	children?: StructBlock[];
}

const HEADING_RE = /^ {0,3}#{1,6}\s/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_RE = /^ {0,3}\$\$/;
const QUOTE_RE = /^ {0,3}>/;
const QUOTE_PREFIX_RE = /^ {0,3}> ?/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
const LIST_CONTINUATION_RE = /^(?: {2,}|\t)\S/;
const TABLE_ROW_RE = /\|/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const HTML_RE = /^ {0,3}<(?:[a-zA-Z][\w-]*|\/|!)/;
const CALLOUT_HEADER_RE = /^\[!([^\]]+)\]-?\s*(.*)$/;
const QUOTE_PREFIX = '> ';
const DESCRIBE_MAX_CHARS = 48;

/** Same fence character, at least the opening length, nothing else on the line. */
function isClosingFence(line: string, marker: string): boolean {
	const trimmed = line.trim();
	return trimmed.length >= marker.length && trimmed === marker[0].repeat(trimmed.length);
}

function isBlank(line: string): boolean {
	return line.trim() === '';
}

function startsStructure(line: string): boolean {
	return HEADING_RE.test(line) || FENCE_RE.test(line) || MATH_RE.test(line) || QUOTE_RE.test(line)
		|| LIST_ITEM_RE.test(line) || HTML_RE.test(line);
}

function isTableStart(lines: string[], i: number): boolean {
	return TABLE_ROW_RE.test(lines[i]) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]) && TABLE_ROW_RE.test(lines[i + 1]);
}

function stripQuotePrefix(line: string): string {
	return line.replace(QUOTE_PREFIX_RE, '');
}

/** Split body lines into structural blocks (blank lines belong to no block); quotes carry their inner scan. */
export function scanBlocks(lines: string[]): StructBlock[] {
	const blocks: StructBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) { i++; continue; }
		const start = i;
		let type: InsertionBlockType;
		const fence = line.match(FENCE_RE);
		if (fence) {
			type = 'code';
			const marker = fence[1];
			i++;
			while (i < lines.length && !isClosingFence(lines[i], marker)) i++;
		} else if (MATH_RE.test(line)) {
			type = 'math';
			const closesOnSameLine = line.trim().length > 2 && line.trim().endsWith('$$');
			if (!closesOnSameLine) {
				i++;
				while (i < lines.length && !lines[i].includes('$$')) i++;
			}
		} else if (HEADING_RE.test(line)) {
			type = 'heading';
		} else if (QUOTE_RE.test(line)) {
			type = 'quote';
			while (i + 1 < lines.length && (QUOTE_RE.test(lines[i + 1]) || (!isBlank(lines[i + 1]) && !startsStructure(lines[i + 1])))) i++;
		} else if (isTableStart(lines, i)) {
			type = 'table';
			i++;
			while (i + 1 < lines.length && !isBlank(lines[i + 1]) && TABLE_ROW_RE.test(lines[i + 1])) i++;
		} else if (HTML_RE.test(line)) {
			type = 'html';
			while (i + 1 < lines.length && !isBlank(lines[i + 1])) i++;
		} else if (LIST_ITEM_RE.test(line)) {
			type = 'list';
			for (;;) {
				if (i + 1 < lines.length && (LIST_ITEM_RE.test(lines[i + 1]) || LIST_CONTINUATION_RE.test(lines[i + 1]))) { i++; continue; }
				// Loose list: blank lines stay inside when the next non-blank line is still part of the list.
				let j = i + 1;
				while (j < lines.length && isBlank(lines[j])) j++;
				if (j > i + 1 && j < lines.length && (LIST_ITEM_RE.test(lines[j]) || LIST_CONTINUATION_RE.test(lines[j]))) { i = j; continue; }
				break;
			}
		} else {
			type = 'paragraph';
			while (i + 1 < lines.length && !isBlank(lines[i + 1]) && !startsStructure(lines[i + 1]) && !isTableStart(lines, i + 1)) i++;
		}
		const end = Math.min(i, lines.length - 1);
		const block: StructBlock = { type, start, end };
		if (type === 'quote') {
			block.prefix = QUOTE_PREFIX;
			block.children = scanBlocks(lines.slice(start, end + 1).map(stripQuotePrefix));
		}
		blocks.push(block);
		i++;
	}
	return blocks;
}

function normalizeAnchorText(text: string): string {
	return text
		.replace(/^ {0,3}#+\s*/, '')
		.replace(/!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/[*_`~>]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

const MIN_REVERSE_PREFIX_CHARS = 8;

/** Index of the line matching `anchor`: exact > line starts with anchor > line contains anchor > anchor starts with a (long enough) line; -1 on miss. */
function findAnchorLine(lines: string[], anchor: InsertionAnchor): number {
	const wanted = normalizeAnchorText(anchor.text);
	if (wanted === '') return -1;
	let prefix = -1;
	let contains = -1;
	let reverse = -1;
	for (let i = 0; i < lines.length; i++) {
		if (anchor.kind === 'heading' && !HEADING_RE.test(lines[i])) continue;
		const line = normalizeAnchorText(lines[i]);
		if (line === '') continue;
		if (line === wanted) return i;
		if (prefix === -1 && line.startsWith(wanted)) prefix = i;
		if (contains === -1 && line.includes(wanted)) contains = i;
		if (reverse === -1 && line.length >= MIN_REVERSE_PREFIX_CHARS && wanted.startsWith(line)) reverse = i;
	}
	if (prefix !== -1) return prefix;
	return contains !== -1 ? contains : reverse;
}

/** Human label for a callout type: `synapse-summary` -> `summary`. */
function calloutLabel(calloutType: string): string {
	return calloutType.replace(/^synapse-/, '').replace(/-/g, ' ') || 'callout';
}

function quoteLabel(firstLine: string): string {
	const header = stripQuotePrefix(firstLine).match(CALLOUT_HEADER_RE);
	return header ? calloutLabel(header[1]) : 'callout';
}

interface LocalResolution {
	strategy: InsertionStrategy;
	line: number;
	matchedText: string;
	blockType: InsertionBlockType;
	container?: { prefix: string; label: string };
}

/** Resolve within one level of (already de-prefixed) lines; `prefix`/`label` describe the container these lines sit in. */
function resolveInLines(lines: string[], anchor: InsertionAnchor, insideContainers: boolean, prefix: string, label: string): LocalResolution | null {
	const at = findAnchorLine(lines, anchor);
	if (at === -1) return null;
	const blocks = scanBlocks(lines);
	const index = blocks.findIndex((b) => b.start <= at && at <= b.end);
	if (index === -1) return null;
	const block = blocks[index];
	const container = prefix ? { prefix, label } : undefined;
	if (block.type === 'quote' && insideContainers && block.children) {
		const inner = lines.slice(block.start, block.end + 1).map(stripQuotePrefix);
		const innerLabel = quoteLabel(lines[block.start]);
		const nested = resolveInLines(inner, anchor, true, prefix + QUOTE_PREFIX, label || innerLabel);
		if (nested) return { ...nested, line: block.start + nested.line };
	}
	const matchedText = lines[at].trim();
	if (block.type === 'heading') {
		const next = blocks[index + 1];
		if (next && next.type === 'paragraph') return { strategy: 'after-section-lead', line: next.end, matchedText, blockType: 'paragraph', container };
		return { strategy: 'after-heading', line: block.end, matchedText, blockType: 'heading', container };
	}
	return { strategy: 'after-paragraph', line: block.end, matchedText, blockType: block.type, container };
}

export interface LocatedRegion {
	/** Body line range of the region (inclusive). */
	start: number;
	end: number;
	prefix: string;
	label: string;
	/** De-prefixed region text. */
	text: string;
}

/** Find the region a previous action produced (body line indexes); null when the note has no such callout or marker pair. */
export function locateRegion(content: string, within: RegionLocator): LocatedRegion | null {
	const lines = parseFrontmatter(content).body.split('\n');
	if (within.kind === 'whole-note') {
		return { start: 0, end: lines.length - 1, prefix: '', label: 'note', text: lines.join('\n') };
	}
	if (within.kind === 'marker') {
		// Region = the lines strictly between the marker pair; an empty pair has nowhere to place content.
		const region = findMarkerRegions(lines, within.marker).find((r) => markerAttrsMatch(r, within.attrs));
		if (!region || region.end - region.start < 2) return null;
		return { start: region.start + 1, end: region.end - 1, prefix: '', label: calloutLabel(region.kind), text: region.body };
	}
	const wantedType = within.calloutType.toLowerCase();
	for (const block of scanBlocks(lines)) {
		if (block.type !== 'quote') continue;
		const header = stripQuotePrefix(lines[block.start]).match(CALLOUT_HEADER_RE);
		if (!header || header[1].toLowerCase() !== wantedType) continue;
		if (within.title && header[2].trim() !== within.title.trim()) continue;
		const inner = lines.slice(block.start, block.end + 1).map(stripQuotePrefix);
		return { start: block.start, end: block.end, prefix: QUOTE_PREFIX, label: calloutLabel(header[1]), text: inner.join('\n') };
	}
	return null;
}

function appendResolution(anchor: InsertionAnchor): ResolvedInsertion {
	return { strategy: 'append', line: null, matchedText: null, anchor };
}

/** Pure, frontmatter-aware: locate the block `anchor` lands in; the insertion line is always a block boundary. */
export function resolveInsertionPoint(content: string, anchor: InsertionAnchor, opts: ResolveInsertionOptions = {}): ResolvedInsertion {
	const lines = parseFrontmatter(content).body.split('\n');
	const region = opts.within && opts.within.kind !== 'whole-note' ? locateRegion(content, opts.within) : null;
	if (anchor.kind === 'end') {
		return region
			? { strategy: 'append', line: region.end, matchedText: null, anchor, container: { prefix: region.prefix, label: region.label } }
			: appendResolution(anchor);
	}
	if (region) {
		const regionLines = lines.slice(region.start, region.end + 1);
		const inner = region.prefix ? regionLines.map(stripQuotePrefix) : regionLines;
		const hit = resolveInLines(inner, anchor, true, region.prefix, region.label);
		const container = { prefix: region.prefix, label: region.label };
		if (!hit) return { strategy: 'append', line: region.end, matchedText: null, anchor, container };
		return { ...hit, line: region.start + hit.line, anchor: resolvedAnchor(anchor, hit), container: hit.container ?? container };
	}
	const hit = resolveInLines(lines, anchor, opts.insideContainers === true, '', '');
	if (!hit) return appendResolution(anchor);
	return { ...hit, anchor: resolvedAnchor(anchor, hit) };
}

function resolvedAnchor(anchor: InsertionAnchor, hit: LocalResolution): InsertionAnchor {
	return { kind: hit.strategy === 'after-paragraph' ? 'paragraph' : 'heading', text: anchor.text };
}

function prefixBlock(block: string, prefix: string): string[] {
	return block.split('\n').map((line) => (isBlank(line) ? prefix.trimEnd() : prefix + line));
}

/** Splice `block` after the resolved line (or append) with exactly one blank line on each side; frontmatter is never touched. */
export function applyInsertion(content: string, resolved: ResolvedInsertion, block: string): string {
	const parsed = parseFrontmatter(content);
	const lines = parsed.body.split('\n');
	const trimmedBlock = block.replace(/^\n+|\n+$/g, '');
	const line = resolved.line;
	const prefix = resolved.container?.prefix ?? '';
	if (line === null || line < 0 || line >= lines.length || (resolved.strategy === 'append' && !resolved.container)) {
		return serializeFrontmatter(parsed.frontmatter, `${parsed.body.trimEnd()}\n\n${trimmedBlock}\n`);
	}
	const spacer = prefix.trimEnd();
	const next = line + 1 < lines.length ? lines[line + 1] : null;
	const before = isBlank(lines[line]) ? [] : [spacer];
	let after: string[] = [];
	// A bare `>` (any depth) is a blank line inside its container.
	if (next !== null && !isBlank(next.replace(/^[\s>]+$/, ''))) after = prefix && !QUOTE_RE.test(next) ? [''] : [spacer];
	lines.splice(line + 1, 0, ...before, ...prefixBlock(trimmedBlock, prefix), ...after);
	return serializeFrontmatter(parsed.frontmatter, lines.join('\n'));
}

function clip(text: string): string {
	return text.length > DESCRIBE_MAX_CHARS ? `${text.slice(0, DESCRIBE_MAX_CHARS - 1).trimEnd()}…` : text;
}

const BLOCK_LABELS: Record<InsertionBlockType, string> = {
	paragraph: 'paragraph', heading: 'heading', code: 'code block', list: 'list', table: 'table', quote: 'callout', html: 'HTML block', math: 'math block',
};

/** One human-readable line for review UIs. */
export function describeInsertion(resolved: ResolvedInsertion): string {
	const heading = (resolved.matchedText ?? '').replace(/^ {0,3}#+\s*/, '');
	let text: string;
	switch (resolved.strategy) {
		case 'after-heading':
			text = `After heading "${clip(heading)}"`;
			break;
		case 'after-section-lead':
			text = `After the opening paragraph of "${clip(heading)}"`;
			break;
		case 'after-paragraph':
			text = `After ${BLOCK_LABELS[resolved.blockType ?? 'paragraph']} "${clip(resolved.matchedText ?? '')}"`;
			break;
		case 'append':
			if (resolved.container) return `Inside the ${resolved.container.label}, at its end`;
			return resolved.anchor.kind === 'end' ? 'At end of note' : 'At end of note (anchor not found)';
	}
	return resolved.container ? `Inside the ${resolved.container.label}, ${text[0].toLowerCase()}${text.slice(1)}` : text;
}
