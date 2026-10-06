import { parseFrontmatter, serializeFrontmatter } from './frontmatter-utils';

/** Where a proposal wants to land: a heading, the paragraph that opens with `text`, or the end of the note. */
export interface InsertionAnchor {
	kind: 'heading' | 'paragraph' | 'end';
	text: string;
}

export type InsertionStrategy = 'after-heading' | 'after-paragraph' | 'append';

/** Output of {@link resolveInsertionPoint}; `line` is the body line index the block goes after (null for append). */
export interface ResolvedInsertion {
	strategy: InsertionStrategy;
	line: number | null;
	matchedText: string | null;
	anchor: InsertionAnchor;
}

const HEADING_RE = /^#{1,6}\s/;
const DESCRIBE_MAX_CHARS = 48;

function normalizeAnchorText(text: string): string {
	return text
		.replace(/^#+\s*/, '')
		.replace(/!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/[*_`~>]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Index of the line matching `anchor` (exact normalized match wins over the first prefix match), or -1. */
function findAnchorLine(lines: string[], anchor: InsertionAnchor): number {
	const wanted = normalizeAnchorText(anchor.text);
	if (wanted === '') return -1;
	let prefix = -1;
	for (let i = 0; i < lines.length; i++) {
		if (anchor.kind === 'heading' && !HEADING_RE.test(lines[i])) continue;
		const line = normalizeAnchorText(lines[i]);
		if (line === '') continue;
		if (line === wanted) return i;
		if (prefix === -1 && (line.startsWith(wanted) || wanted.startsWith(line))) prefix = i;
	}
	return prefix;
}

/** A heading's block ends on its own line; a paragraph's at the line before the next blank. */
function blockEnd(lines: string[], start: number): number {
	if (HEADING_RE.test(lines[start])) return start;
	let i = start;
	while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
	return i;
}

function appendResolution(anchor: InsertionAnchor): ResolvedInsertion {
	return { strategy: 'append', line: null, matchedText: null, anchor };
}

/** Pure, frontmatter-aware: locate where `anchor` lands in `content`; a miss resolves to append. */
export function resolveInsertionPoint(content: string, anchor: InsertionAnchor): ResolvedInsertion {
	if (anchor.kind === 'end') return appendResolution(anchor);
	const lines = parseFrontmatter(content).body.split('\n');
	const at = findAnchorLine(lines, anchor);
	if (at === -1) return appendResolution(anchor);
	const isHeading = HEADING_RE.test(lines[at]);
	return {
		strategy: isHeading ? 'after-heading' : 'after-paragraph',
		line: blockEnd(lines, at),
		matchedText: lines[at].trim(),
		anchor: { kind: isHeading ? 'heading' : 'paragraph', text: anchor.text },
	};
}

/** Splice `block` after the resolved line (or append); frontmatter is never touched and a blank line always follows the block. */
export function applyInsertion(content: string, resolved: ResolvedInsertion, block: string): string {
	const parsed = parseFrontmatter(content);
	const lines = parsed.body.split('\n');
	const trimmedBlock = block.replace(/^\n+|\n+$/g, '');
	const line = resolved.line;
	if (resolved.strategy === 'append' || line === null || line < 0 || line >= lines.length) {
		return serializeFrontmatter(parsed.frontmatter, `${parsed.body.trimEnd()}\n\n${trimmedBlock}\n`);
	}
	const gap = line + 1 < lines.length && lines[line + 1].trim() !== '' ? [''] : [];
	lines.splice(line + 1, 0, '', trimmedBlock, ...gap);
	return serializeFrontmatter(parsed.frontmatter, lines.join('\n'));
}

function clip(text: string): string {
	return text.length > DESCRIBE_MAX_CHARS ? `${text.slice(0, DESCRIBE_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** One human-readable line for review UIs. */
export function describeInsertion(resolved: ResolvedInsertion): string {
	switch (resolved.strategy) {
		case 'after-heading':
			return `After heading "${clip((resolved.matchedText ?? '').replace(/^#+\s*/, ''))}"`;
		case 'after-paragraph':
			return `After paragraph "${clip(resolved.matchedText ?? '')}"`;
		case 'append':
			return resolved.anchor.kind === 'end' ? 'At end of note' : 'At end of note (anchor not found)';
	}
}
