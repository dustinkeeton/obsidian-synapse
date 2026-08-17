import { App, TFile } from 'obsidian';

/**
 * Backlink remediation for title renames (#485).
 *
 * `vault.rename` deliberately bypasses Obsidian's automatic link updating
 * (which would rewrite `[[Old Title]]` to `[[New Title]]` and silently change
 * the visible prose of referencing notes). Instead, the title module snapshots
 * inbound links BEFORE the rename and rewrites each one afterwards, retargeting
 * the link while preserving its rendered display text byte-for-byte:
 *
 * - `[[Old Title]]`          -> `[[New Title|Old Title]]`
 * - `[[Old Title|Custom]]`   -> `[[New Title|Custom]]`
 * - `[[Old Title#Heading]]`  -> `[[New Title#Heading|Old Title]]` (and `#^block`)
 * - `[text](Old%20Title.md)` -> `[text](New%20Title.md)` (path only)
 * - `![[Old Title]]`         -> `![[New Title]]` (embeds render content, not text)
 */

/** A snapshot of one inbound link, captured BEFORE the rename. */
export interface InboundLinkRef {
	/** Vault path of the note containing the link. */
	sourcePath: string;
	/** The link exactly as written in that note, e.g. `[[Old Title|Custom]]`. */
	original: string;
}

/** Minimal shape of the unexposed `metadataCache.getBacklinksForFile` result. */
interface BacklinkDict {
	data: Map<string, unknown[]> | Record<string, unknown[]>;
}

type BacklinkCapableCache = {
	getBacklinksForFile?: (file: TFile) => BacklinkDict | null | undefined;
};

/**
 * Snapshot all inbound links to `file` via `metadataCache.getBacklinksForFile`.
 * The method is not in the public typings, so it is feature-detected: on an
 * Obsidian build without it this returns `[]` and remediation is a no-op.
 * `.data` is a Map on current builds but was a plain object historically —
 * both shapes are accepted.
 */
export function collectInboundLinks(app: App, file: TFile): InboundLinkRef[] {
	const cache = app.metadataCache as unknown as BacklinkCapableCache;
	if (typeof cache.getBacklinksForFile !== 'function') return [];

	let dict: BacklinkDict | null | undefined;
	try {
		dict = cache.getBacklinksForFile(file);
	} catch {
		return [];
	}
	const data = dict?.data;
	if (!data) return [];

	const entries: Iterable<[string, unknown]> =
		data instanceof Map ? data.entries() : Object.entries(data);

	const refs: InboundLinkRef[] = [];
	for (const [sourcePath, links] of entries) {
		if (!Array.isArray(links)) continue;
		for (const link of links) {
			const original = (link as { original?: unknown } | null)?.original;
			if (typeof original === 'string' && original.length > 0) {
				refs.push({ sourcePath, original });
			}
		}
	}
	return refs;
}

/** Final path segment without a trailing `.md`, e.g. `Inbox/Old.md` -> `Old`. */
function noteBasename(path: string): string {
	const name = path.split('/').pop() ?? path;
	return name.replace(/\.md$/i, '');
}

/**
 * Retarget the path portion of a link from the old note to the new one,
 * preserving how the author wrote it: folder prefix and `.md` extension are
 * kept if present. Returns `null` when the written path does not end in the
 * old note's basename (resolved some other way — do not guess).
 */
function retargetLinkpath(linkpath: string, oldPath: string, newPath: string): string | null {
	if (!linkpath) return null;
	const slash = linkpath.lastIndexOf('/');
	const dir = slash >= 0 ? linkpath.slice(0, slash + 1) : '';
	const name = linkpath.slice(slash + 1);
	const hadExt = /\.md$/i.test(name);
	const base = hadExt ? name.slice(0, -3) : name;
	if (base.toLowerCase() !== noteBasename(oldPath).toLowerCase()) return null;
	return dir + noteBasename(newPath) + (hadExt ? '.md' : '');
}

const WIKILINK_RE = /^(!?)\[\[([^\][|]*)(?:\|([^\][]*))?\]\]$/;
const MARKDOWN_RE = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/;

/**
 * Rewrite a single link (as written) so it targets `newPath` while its
 * rendered text stays byte-identical. Returns `null` when the text is not a
 * recognized link form or does not target `oldPath` — callers must leave the
 * original untouched in that case.
 */
export function rewriteLinkText(original: string, oldPath: string, newPath: string): string | null {
	const wiki = WIKILINK_RE.exec(original);
	if (wiki) {
		const [, bang, target, alias] = wiki;
		const hash = target.indexOf('#');
		const linkpath = hash >= 0 ? target.slice(0, hash) : target;
		const subpath = hash >= 0 ? target.slice(hash) : '';
		const newLinkpath = retargetLinkpath(linkpath, oldPath, newPath);
		if (newLinkpath === null) return null;
		if (bang === '!') {
			// Embeds render content, not text — retarget without adding an alias,
			// but keep an existing one (it may carry sizing like `|300`).
			const aliasPart = alias !== undefined ? `|${alias}` : '';
			return `![[${newLinkpath}${subpath}${aliasPart}]]`;
		}
		// Preserve rendered text: an existing alias is kept verbatim; otherwise
		// the old written path becomes the alias so the reader sees no change.
		const display = alias !== undefined ? alias : linkpath;
		return `[[${newLinkpath}${subpath}|${display}]]`;
	}

	const md = MARKDOWN_RE.exec(original);
	if (md) {
		const [, bang, text, rawTarget] = md;
		const wrapped = rawTarget.startsWith('<') && rawTarget.endsWith('>');
		const target = wrapped ? rawTarget.slice(1, -1) : rawTarget;
		const hash = target.indexOf('#');
		const pathPart = hash >= 0 ? target.slice(0, hash) : target;
		const anchor = hash >= 0 ? target.slice(hash) : '';
		let decoded = pathPart;
		try {
			decoded = decodeURIComponent(pathPart);
		} catch {
			// Not valid percent-encoding — treat as a literal path.
		}
		const newLinkpath = retargetLinkpath(decoded, oldPath, newPath);
		if (newLinkpath === null) return null;
		const newTarget = wrapped ? `<${newLinkpath}${anchor}>` : `${encodeURI(newLinkpath)}${anchor}`;
		return `${bang}[${text}](${newTarget})`;
	}

	return null;
}

/**
 * Rewrite every collected link occurrence inside one note's content. Only
 * exact matches of the recorded `original` text are replaced (identical links
 * get identical rewrites), so a stale cache entry can never corrupt prose —
 * unrecognized or non-matching links are left untouched.
 */
export function rewriteContent(
	content: string,
	originals: string[],
	oldPath: string,
	newPath: string
): string {
	let out = content;
	const seen = new Set<string>();
	for (const original of originals) {
		if (seen.has(original)) continue;
		seen.add(original);
		const rewritten = rewriteLinkText(original, oldPath, newPath);
		if (rewritten === null || rewritten === original) continue;
		out = out.split(original).join(rewritten);
	}
	return out;
}
