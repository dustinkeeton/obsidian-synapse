import { buildCallout, CALLOUT_TYPES, parseFrontmatter, serializeFrontmatter } from '../shared';
import { mermaidBlock } from './diagram';
import type { IllustrateItem, MediaCandidate } from './types';

function mdLink(text: string, url: string): string {
	const safeText = text.replace(/[[\]]/g, '');
	return url ? `[${safeText}](${url})` : safeText;
}

export function attributionLine(candidate: MediaCandidate): string {
	const source = mdLink(candidate.title, candidate.pageUrl);
	const license = mdLink(candidate.license, candidate.licenseUrl);
	return `Source: ${source} · License: ${license} · ${candidate.attribution}`;
}

/** Embed (`![[vault path]]` or remote URL) plus the caption/attribution callout. */
export function buildPhotoBlock(item: Extract<IllustrateItem, { kind: 'photo' }>, vaultPath: string | null): string {
	const embed = vaultPath ? `![[${vaultPath}]]` : `![${item.caption.replace(/[[\]]/g, '')}](${item.candidate.fileUrl})`;
	return `${embed}\n${buildCallout(CALLOUT_TYPES.illustrate, item.caption, attributionLine(item.candidate))}`;
}

/** Mermaid fence plus a caption callout noting the diagram was built from the note itself. */
export function buildMermaidItemBlock(item: Extract<IllustrateItem, { kind: 'diagram' | 'chart' }>): string {
	const origin = item.kind === 'chart' ? 'Chart built from figures in this note' : 'Diagram generated from this note';
	return `${mermaidBlock(item.mermaid)}\n${buildCallout(CALLOUT_TYPES.illustrate, item.caption, origin)}`;
}

function normalizeAnchorText(text: string): string {
	return text
		.replace(/^#+\s*/, '')
		.replace(/!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/[*_`~>]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Index of the line matching `anchor` (heading or paragraph opening), or -1. */
export function findAnchorLine(lines: string[], anchor: string): number {
	const wanted = normalizeAnchorText(anchor);
	if (wanted === '') return -1;
	let exact = -1;
	let prefix = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = normalizeAnchorText(lines[i]);
		if (line === '') continue;
		if (line === wanted) { exact = i; break; }
		if (prefix === -1 && (line.startsWith(wanted) || wanted.startsWith(line))) prefix = i;
	}
	return exact !== -1 ? exact : prefix;
}

/** End of the block starting at `start`: a heading ends immediately, a paragraph at its next blank line. */
function blockEnd(lines: string[], start: number): number {
	if (/^#{1,6}\s/.test(lines[start])) return start;
	let i = start;
	while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
	return i;
}

/** Insert `block` after the anchor's block (falls back to appending); frontmatter is never touched. */
export function insertAtAnchor(content: string, anchor: string, block: string): string {
	const parsed = parseFrontmatter(content);
	const lines = parsed.body.split('\n');
	const at = findAnchorLine(lines, anchor);
	const trimmedBlock = block.replace(/^\n+|\n+$/g, '');
	let body: string;
	if (at === -1) {
		body = `${parsed.body.trimEnd()}\n\n${trimmedBlock}\n`;
	} else {
		const end = blockEnd(lines, at);
		lines.splice(end + 1, 0, '', trimmedBlock);
		body = lines.join('\n');
	}
	return serializeFrontmatter(parsed.frontmatter, body);
}
