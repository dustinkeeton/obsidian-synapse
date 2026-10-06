import { parseFrontmatter, serializeFrontmatter } from './frontmatter-utils';

/** Where a proposal wants to land: a heading, the paragraph that opens with `text`, or the end of the note. */
export interface InsertionAnchor {
	kind: 'heading' | 'paragraph' | 'end';
	text: string;
}

export type InsertionStrategy = 'after-heading' | 'after-section-lead' | 'after-paragraph' | 'append';

/** Structural block kinds the resolver never splits. */
export type InsertionBlockType = 'paragraph' | 'heading' | 'code' | 'list' | 'table' | 'quote' | 'html' | 'math';

/** Output of {@link resolveInsertionPoint}; `line` is the body line index the block goes after (null for append). */
export interface ResolvedInsertion {
	strategy: InsertionStrategy;
	line: number | null;
	matchedText: string | null;
	anchor: InsertionAnchor;
	/** Kind of the block the insertion follows; absent for append. */
	blockType?: InsertionBlockType;
}

interface StructBlock {
	type: InsertionBlockType;
	start: number;
	end: number;
}

const HEADING_RE = /^ {0,3}#{1,6}\s/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_RE = /^ {0,3}\$\$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
const LIST_CONTINUATION_RE = /^(?: {2,}|\t)\S/;
const TABLE_ROW_RE = /\|/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const HTML_RE = /^ {0,3}<(?:[a-zA-Z][\w-]*|\/|!)/;
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

/** Split body lines into structural blocks (blank lines belong to no block). */
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
		blocks.push({ type, start, end: Math.min(i, lines.length - 1) });
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

/** Index of the line matching `anchor`: exact normalized match, then prefix, then substring; -1 on miss. */
function findAnchorLine(lines: string[], anchor: InsertionAnchor): number {
	const wanted = normalizeAnchorText(anchor.text);
	if (wanted === '') return -1;
	let prefix = -1;
	let contains = -1;
	for (let i = 0; i < lines.length; i++) {
		if (anchor.kind === 'heading' && !HEADING_RE.test(lines[i])) continue;
		const line = normalizeAnchorText(lines[i]);
		if (line === '') continue;
		if (line === wanted) return i;
		if (prefix === -1 && (line.startsWith(wanted) || wanted.startsWith(line))) prefix = i;
		if (contains === -1 && line.includes(wanted)) contains = i;
	}
	return prefix !== -1 ? prefix : contains;
}

function appendResolution(anchor: InsertionAnchor): ResolvedInsertion {
	return { strategy: 'append', line: null, matchedText: null, anchor };
}

/** Pure, frontmatter-aware: locate the block `anchor` lands in; the insertion line is always that block's end. */
export function resolveInsertionPoint(content: string, anchor: InsertionAnchor): ResolvedInsertion {
	if (anchor.kind === 'end') return appendResolution(anchor);
	const lines = parseFrontmatter(content).body.split('\n');
	const at = findAnchorLine(lines, anchor);
	if (at === -1) return appendResolution(anchor);
	const blocks = scanBlocks(lines);
	const index = blocks.findIndex((b) => b.start <= at && at <= b.end);
	if (index === -1) return appendResolution(anchor);
	const block = blocks[index];
	const matchedText = lines[at].trim();
	if (block.type === 'heading') {
		const next = blocks[index + 1];
		const headingAnchor: InsertionAnchor = { kind: 'heading', text: anchor.text };
		if (next && next.type === 'paragraph') {
			return { strategy: 'after-section-lead', line: next.end, matchedText, anchor: headingAnchor, blockType: 'paragraph' };
		}
		return { strategy: 'after-heading', line: block.end, matchedText, anchor: headingAnchor, blockType: 'heading' };
	}
	return {
		strategy: 'after-paragraph',
		line: block.end,
		matchedText,
		anchor: { kind: 'paragraph', text: anchor.text },
		blockType: block.type,
	};
}

/** Splice `block` after the resolved line (or append) with exactly one blank line on each side; frontmatter is never touched. */
export function applyInsertion(content: string, resolved: ResolvedInsertion, block: string): string {
	const parsed = parseFrontmatter(content);
	const lines = parsed.body.split('\n');
	const trimmedBlock = block.replace(/^\n+|\n+$/g, '');
	const line = resolved.line;
	if (resolved.strategy === 'append' || line === null || line < 0 || line >= lines.length) {
		return serializeFrontmatter(parsed.frontmatter, `${parsed.body.trimEnd()}\n\n${trimmedBlock}\n`);
	}
	const before = isBlank(lines[line]) ? [] : [''];
	const after = line + 1 < lines.length && !isBlank(lines[line + 1]) ? [''] : [];
	lines.splice(line + 1, 0, ...before, trimmedBlock, ...after);
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
	switch (resolved.strategy) {
		case 'after-heading':
			return `After heading "${clip(heading)}"`;
		case 'after-section-lead':
			return `After the opening paragraph of "${clip(heading)}"`;
		case 'after-paragraph':
			return `After ${BLOCK_LABELS[resolved.blockType ?? 'paragraph']} "${clip(resolved.matchedText ?? '')}"`;
		case 'append':
			return resolved.anchor.kind === 'end' ? 'At end of note' : 'At end of note (anchor not found)';
	}
}
