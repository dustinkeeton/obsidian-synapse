import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { asStringArray } from '../shared';
import type { InternalLinkCandidate } from './types';

function linkpathOf(displayText: string): string {
	return displayText.split('|')[0].split(/[#^]/)[0].replace(/[[\]]/g, '').trim();
}

function basenameOf(path: string): string {
	return path.replace(/^.*\//, '').replace(/\.md$/i, '');
}

function sourceAliases(app: App, sourcePath: string): Set<string> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	const raw: unknown = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter?.aliases : undefined;
	const list = typeof raw === 'string' ? [raw] : asStringArray(raw);
	return new Set(list.map((a) => a.trim().toLowerCase()).filter(Boolean));
}

/** True when `candidate` points back at `sourcePath` by path, resolved linkpath, basename, or alias. */
export function isSelfLink(
	candidate: Pick<InternalLinkCandidate, 'targetPath' | 'displayText'>,
	app: App,
	sourcePath: string
): boolean {
	if (candidate.targetPath === sourcePath) return true;
	const linkpath = linkpathOf(candidate.displayText);
	if (!linkpath) return false;
	if (app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path === sourcePath) return true;
	const lower = linkpath.toLowerCase();
	if (lower === basenameOf(sourcePath).toLowerCase()) return true;
	return sourceAliases(app, sourcePath).has(lower);
}

/** Drop every candidate that links the note to itself. */
export function withoutSelfLinks<T extends Pick<InternalLinkCandidate, 'targetPath' | 'displayText'>>(
	candidates: T[],
	app: App,
	sourcePath: string
): T[] {
	return candidates.filter((c) => !isSelfLink(c, app, sourcePath));
}
