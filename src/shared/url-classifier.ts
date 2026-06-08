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
];

/**
 * Global matcher for http(s) URLs embedded in free text. Trailing punctuation
 * that commonly abuts a URL in prose (`.,;:!?` and closing brackets/quotes) is
 * trimmed by {@link trimTrailingPunctuation} after extraction.
 */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

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
 * KNOWN LIMITATION: sanitizeUrl rejects shell metacharacters including `()`,
 * so disambiguation URLs like `…/wiki/Obsidian_(software)` classify as
 * `unknown` today. Relaxing that safely requires loosening sanitizeUrl for the
 * non-shell (fetch) path, which is out of scope for this module (see #109).
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

/**
 * Trim a single run of trailing punctuation that prose commonly places right
 * after a URL (sentence enders, closing brackets, quotes). Conservative by
 * design: it only strips characters that are never meaningful as the final
 * character of a real link in note text.
 */
function trimTrailingPunctuation(url: string): string {
	return url.replace(/[.,;:!?)\]}>'"]+$/, '');
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

/**
 * Extract every http(s) URL from free text, in document order, with trailing
 * prose punctuation trimmed. Lets the intake monitor pull links out of a note
 * body. Duplicates are removed while preserving first-seen order so callers
 * get a stable, de-duplicated list.
 */
export function extractUrls(text: string): string[] {
	if (typeof text !== 'string' || text.length === 0) {
		return [];
	}

	const matches = text.match(URL_IN_TEXT_REGEX);
	if (!matches) {
		return [];
	}

	const seen = new Set<string>();
	const urls: string[] = [];
	for (const raw of matches) {
		const cleaned = trimTrailingPunctuation(raw);
		if (cleaned.length === 0 || seen.has(cleaned)) {
			continue;
		}
		seen.add(cleaned);
		urls.push(cleaned);
	}

	return urls;
}
