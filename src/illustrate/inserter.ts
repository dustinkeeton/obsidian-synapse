import { buildCallout, CALLOUT_TYPES } from '../shared';
import { mermaidBlock } from './diagram';
import type { IllustrateItem, MediaCandidate } from './types';

/** Provider-supplied URL, or '' unless it parses as http(s) — nothing else is written into a note. */
export function httpUrlOrEmpty(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
	} catch {
		return '';
	}
}

function mdLink(text: string, url: string): string {
	const safeText = text.replace(/[[\]]/g, '');
	const safeUrl = httpUrlOrEmpty(url);
	return safeUrl ? `[${safeText}](${safeUrl})` : safeText;
}

export function attributionLine(candidate: MediaCandidate): string {
	const source = mdLink(candidate.title, candidate.pageUrl);
	const license = mdLink(candidate.license, candidate.licenseUrl);
	return `Source: ${source} · License: ${license} · ${candidate.attribution}`;
}

/** Embed (`![[vault path]]` or remote URL) plus the caption/attribution callout; `fallbackReason` notes a failed download. */
export function buildPhotoBlock(item: Extract<IllustrateItem, { kind: 'photo' }>, vaultPath: string | null, fallbackReason?: string): string {
	const safeCaption = item.caption.replace(/[[\]]/g, '');
	const remoteUrl = httpUrlOrEmpty(item.candidate.fileUrl);
	const embed = vaultPath ? `![[${vaultPath}]]` : remoteUrl ? `![${safeCaption}](${remoteUrl})` : safeCaption;
	const note = fallbackReason ? ` · (download failed; remote embed: ${fallbackReason.replace(/\s+/g, ' ').trim()})` : '';
	return `${embed}\n${buildCallout(CALLOUT_TYPES.illustrate, item.caption, attributionLine(item.candidate) + note)}`;
}

/** Mermaid fence plus a caption callout noting the diagram was built from the note itself. */
export function buildMermaidItemBlock(item: Extract<IllustrateItem, { kind: 'diagram' | 'chart' }>): string {
	const origin = item.kind === 'chart' ? 'Chart built from figures in this note' : 'Diagram generated from this note';
	return `${mermaidBlock(item.mermaid)}\n${buildCallout(CALLOUT_TYPES.illustrate, item.caption, origin)}`;
}
