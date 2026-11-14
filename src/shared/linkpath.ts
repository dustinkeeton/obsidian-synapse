import type { App } from 'obsidian';

/** Wikilink target for a vault path, or null when no link can reach it unambiguously. */
export type LinkpathFor = (path: string) => string | null;

/** Characters Obsidian reads as link syntax inside a linkpath. */
const UNSAFE_LINKPATH = /[#^|[\]]/;

/**
 * Bare basename while no other note shares it, so the link survives a move; the
 * folder-qualified path once another note does. Null when only a qualified link would
 * be unambiguous but the path holds link syntax.
 */
export function linkpathFor(app: App, path: string): string | null {
	const linkpath = path.replace(/\.md$/i, '');
	const basename = linkpath.slice(linkpath.lastIndexOf('/') + 1);
	if (linkpath === basename) return basename;
	const lower = basename.toLowerCase();
	const shared = app.vault.getMarkdownFiles().some((f) => f.path !== path && f.basename.toLowerCase() === lower);
	if (!shared) return basename;
	return UNSAFE_LINKPATH.test(linkpath) ? null : linkpath;
}
