import { detectPlatform, isSupportedUrl } from './url-detector';
import { sanitizeUrl } from './validation';

/**
 * Classify arbitrary URLs as video / audio / article / unknown so the intake
 * monitor can route each link to the right pipeline.
 *
 * Lives in shared/ (alongside content-fetcher.ts) so any feature module can
 * consume URL classification without creating cross-feature coupling. The
 * video case is delegated to the existing video-only detector
 * (video/url-detector.ts) rather than re-implementing platform regexes, which
 * keeps the two in sync and preserves backward compatibility.
 */

export type UrlContentType = 'video' | 'audio' | 'article' | 'unknown';

export interface UrlClassification {
	type: UrlContentType;
	platform: string;
	url: string;
}

/**
 * Host suffixes for audio platforms. A host matches when it equals the entry
 * or ends with `.<entry>` (covers subdomains like `m.soundcloud.com`).
 */
const AUDIO_HOSTS: ReadonlyArray<{ suffix: string; platform: string }> = [
	{ suffix: 'open.spotify.com', platform: 'spotify' },
	{ suffix: 'spotify.com', platform: 'spotify' },
	{ suffix: 'podcasts.apple.com', platform: 'apple-podcasts' },
	{ suffix: 'soundcloud.com', platform: 'soundcloud' },
];

/**
 * Host suffixes for known article platforms. Anything not matched here that is
 * still a valid http(s) URL falls through to the generic-article default.
 */
const ARTICLE_HOSTS: ReadonlyArray<{ suffix: string; platform: string }> = [
	{ suffix: 'medium.com', platform: 'medium' },
	{ suffix: 'substack.com', platform: 'substack' },
	{ suffix: 'wikipedia.org', platform: 'wikipedia' },
	{ suffix: 'reddit.com', platform: 'reddit' },
];

/** Candidate run for a bare URL; trailing prose punctuation is trimmed afterwards. */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"`]+/gi;

/** `[text](` immediately followed by an http(s) destination; the `)` is found by paren balancing. */
const MARKDOWN_LINK_OPEN_REGEX = /\[([^\]]+)\]\((?=https?:\/\/)/gi;

const TRAILING_PROSE_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ']', '}', '>', "'", '"']);

/** A bare URL found in text; `index` is its offset in the scanned string. */
export interface UrlMatch {
	url: string;
	index: number;
}

/** A `[text](url)` link; `index`/`length` span the whole link in the scanned string. */
export interface MarkdownLinkMatch {
	text: string;
	url: string;
	index: number;
	length: number;
}

/**
 * Parse a URL into a {@link URL} after defensive sanitization, returning null
 * when the input is not a safe, fetchable http(s) URL. Centralizing this keeps
 * every classifier branch from having to guard `new URL` / `sanitizeUrl` throws.
 *
 * Classification is deliberately gated on the project's canonical
 * {@link sanitizeUrl} (the same guard every downstream fetcher applies, e.g.
 * content-fetcher.ts's fetchHtml). A URL that cannot pass sanitizeUrl cannot be
 * fetched by any pipeline, so classifying it as anything other than `unknown`
 * would route it to a pipeline guaranteed to throw. Keeping the gate identical
 * means a non-`unknown` classification is always a fetchable URL.
 *
 * sanitizeUrl now allows the URL-legal characters `()`, `{}`, `!` and `&`
 * (multi-param query strings), so disambiguation URLs like
 * `…/wiki/Obsidian_(software)` and multi-param TikTok/YouTube links classify
 * normally for the fetch path. It still rejects the shell-dangerous `$`,
 * backtick, `;` and `|` (plus control chars and null bytes) as
 * defense-in-depth, so a URL like `…/$(rm -rf /)` remains `unknown`.
 */
function safeParseUrl(url: string): URL | null {
	if (typeof url !== 'string' || url.trim().length === 0) {
		return null;
	}

	try {
		// sanitizeUrl throws on null bytes, non-http(s) schemes, and shell
		// metacharacters; treat any rejection as a non-classifiable URL.
		sanitizeUrl(url);
		return new URL(url);
	} catch {
		return null;
	}
}

/**
 * True when `host` equals `suffix` or is a subdomain of it
 * (e.g. `example.medium.com` matches `medium.com`).
 */
function hostMatches(host: string, suffix: string): boolean {
	return host === suffix || host.endsWith('.' + suffix);
}

/**
 * Detect podcast RSS feeds by shape rather than host: a `.rss`/`.xml` path, or
 * a path/host segment containing `feed` or `rss`. Pathname and search are
 * lowercased so query-string feed hints (`?format=rss`) are caught too.
 */
function isPodcastFeed(parsed: URL): boolean {
	const path = parsed.pathname.toLowerCase();
	const search = parsed.search.toLowerCase();

	if (path.endsWith('.rss') || path.endsWith('.xml')) {
		return true;
	}

	const haystack = path + search;
	return haystack.includes('/feed') || haystack.includes('feed') ||
		haystack.includes('/rss') || haystack.includes('rss');
}

/** Strip trailing prose punctuation; a `)` is kept while it balances an earlier `(` (CommonMark autolink rule). */
function trimTrailingPunctuation(url: string): string {
	let open = 0;
	let close = 0;
	for (const ch of url) {
		if (ch === '(') open++;
		else if (ch === ')') close++;
	}

	let end = url.length;
	while (end > 0) {
		const ch = url[end - 1];
		if (TRAILING_PROSE_PUNCTUATION.has(ch)) {
			end--;
		} else if (ch === ')' && close > open) {
			close--;
			end--;
		} else {
			break;
		}
	}
	return url.slice(0, end);
}

/** Index of the `)` closing a link destination that starts at `start`, or -1 if whitespace/EOL comes first. */
function findLinkDestinationEnd(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (/\s/.test(ch)) return -1;
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			if (depth === 0) return i;
			depth--;
		}
	}
	return -1;
}

/**
 * Classify a single URL into a content type plus a specific platform label.
 *
 * Order matters: video is checked first (so platform-specific routing wins
 * over the generic-article default), then audio, then known article hosts,
 * then any remaining valid http(s) URL is treated as a generic article.
 * Anything that fails {@link safeParseUrl} is `unknown`.
 */
export function classifyUrl(url: string): UrlClassification {
	const parsed = safeParseUrl(url);
	if (!parsed) {
		return { type: 'unknown', platform: 'unknown', url };
	}

	// 1. Video — delegate entirely to the existing video detector so the
	//    supported-platform set stays in sync with video/url-detector.ts.
	const videoResult = detectPlatform(url);
	if (videoResult && isSupportedUrl(url)) {
		return { type: 'video', platform: videoResult.platform, url };
	}

	const host = parsed.hostname.toLowerCase();

	// 2. Audio — known audio hosts, then podcast-feed shape.
	for (const { suffix, platform } of AUDIO_HOSTS) {
		if (hostMatches(host, suffix)) {
			return { type: 'audio', platform, url };
		}
	}
	if (isPodcastFeed(parsed)) {
		return { type: 'audio', platform: 'podcast-rss', url };
	}

	// 3. Article — known article hosts, then any valid http(s) URL as default.
	for (const { suffix, platform } of ARTICLE_HOSTS) {
		if (hostMatches(host, suffix)) {
			return { type: 'article', platform, url };
		}
	}

	return { type: 'article', platform: 'generic', url };
}

/** Every bare http(s) URL in document order with its offset; duplicates are kept. */
export function findUrls(text: string): UrlMatch[] {
	if (typeof text !== 'string' || text.length === 0) {
		return [];
	}

	const matches: UrlMatch[] = [];
	for (const match of text.matchAll(URL_IN_TEXT_REGEX)) {
		const url = trimTrailingPunctuation(match[0]);
		if (url.length > 0) {
			matches.push({ url, index: match.index });
		}
	}
	return matches;
}

/** Bare http(s) URLs in document order, de-duplicated (first occurrence wins). */
export function extractUrls(text: string): string[] {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const { url } of findUrls(text)) {
		if (seen.has(url)) {
			continue;
		}
		seen.add(url);
		urls.push(url);
	}
	return urls;
}

/** Every `[text](http(s)-url)` link in document order; parens inside the URL survive when balanced. */
export function findMarkdownLinks(text: string): MarkdownLinkMatch[] {
	if (typeof text !== 'string' || text.length === 0) {
		return [];
	}

	const links: MarkdownLinkMatch[] = [];
	for (const match of text.matchAll(MARKDOWN_LINK_OPEN_REGEX)) {
		const urlStart = match.index + match[0].length;
		const urlEnd = findLinkDestinationEnd(text, urlStart);
		if (urlEnd < 0) {
			continue;
		}
		links.push({
			text: match[1],
			url: text.slice(urlStart, urlEnd),
			index: match.index,
			length: urlEnd + 1 - match.index,
		});
	}
	return links;
}
