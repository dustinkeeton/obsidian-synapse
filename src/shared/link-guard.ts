/** Minimal `MetadataCache` surface needed to resolve a wikilink target. */
export interface LinkResolver {
	getFirstLinkpathDest(linkpath: string, sourcePath: string): unknown;
}

export interface StripLinksOptions {
	/** Linkpaths (case-insensitive) left linked even when unresolved, e.g. links the user already had. */
	keep?: Iterable<string>;
}

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const FENCE = /^(?:\s*>)*\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?:.*?)\1(?!`)/g;

interface ParsedLink {
	target: string;
	alias: string | undefined;
	linkpath: string;
}

function parseInner(inner: string): ParsedLink {
	const pipe = inner.indexOf('|');
	let target = pipe >= 0 ? inner.slice(0, pipe) : inner;
	const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : undefined;
	// Table cells escape the alias pipe as `\|`.
	if (target.endsWith('\\')) target = target.slice(0, -1);
	target = target.trim();
	const linkpath = target.split(/[#^]/)[0].trim();
	return { target, alias, linkpath };
}

/** Apply `fn` to every stretch of `text` outside fenced code blocks and inline code spans. */
function mapOutsideCode(text: string, fn: (segment: string) => string): string {
	const lines = text.split('\n');
	let fence: string | null = null;
	return lines.map((line) => {
		const marker = FENCE.exec(line)?.[1];
		if (fence !== null) {
			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			return line;
		}
		if (marker) {
			fence = marker;
			return line;
		}
		let out = '';
		let last = 0;
		for (const m of line.matchAll(INLINE_CODE)) {
			out += fn(line.slice(last, m.index)) + m[0];
			last = m.index + m[0].length;
		}
		return out + fn(line.slice(last));
	}).join('\n');
}

/** Lowercased linkpaths of every non-embed wikilink in `text` outside code. */
export function wikilinkTargets(text: string): Set<string> {
	const targets = new Set<string>();
	mapOutsideCode(text, (segment) => {
		for (const m of segment.matchAll(WIKILINK)) {
			if (m[1] === '!') continue;
			const { linkpath } = parseInner(m[2]);
			if (linkpath) targets.add(linkpath.toLowerCase());
		}
		return segment;
	});
	return targets;
}

/** True when `linkpath` resolves to an existing vault file from `sourcePath`. */
export function linkResolves(linkpath: string, resolver: LinkResolver, sourcePath: string): boolean {
	return !!resolver.getFirstLinkpathDest(linkpath, sourcePath);
}

/**
 * Turn every `[[target]]` / `[[target|alias]]` whose note does not exist into plain text
 * (alias, else target). Embeds, same-note `[[#H]]` refs and code are left untouched.
 */
export function stripUnresolvedLinks(
	text: string,
	resolver: LinkResolver,
	sourcePath: string,
	options: StripLinksOptions = {}
): string {
	if (!text.includes('[[')) return text;
	const keep = new Set([...(options.keep ?? [])].map((k) => k.toLowerCase()));
	return mapOutsideCode(text, (segment) =>
		segment.replace(WIKILINK, (whole, bang: string, inner: string) => {
			if (bang === '!') return whole;
			const { target, alias, linkpath } = parseInner(inner);
			if (!linkpath) return whole;
			if (keep.has(linkpath.toLowerCase())) return whole;
			if (linkResolves(linkpath, resolver, sourcePath)) return whole;
			return alias || target;
		})
	);
}
