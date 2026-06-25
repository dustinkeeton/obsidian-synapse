import { requestUrl, RequestUrlResponse } from 'obsidian';
import { sanitizeUrl } from './validation';
import { extractReadableText } from './content-fetcher';

const FETCH_TIMEOUT_MS = 30_000;

/** User-Agent sent with Reddit fetches so the RSS/HTML endpoints respond. */
const FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; ObsidianSynapse/1.0)';

/**
 * Transient HTTP statuses worth retrying — Reddit rate-limits the RSS endpoint
 * aggressively (429 after even a single recent hit) and occasionally returns
 * 503. Permanent statuses (403/404) are NOT retried.
 */
const RETRY_STATUSES = new Set([429, 503]);

/** Backoff before each retry; its length doubles as the max retry count. */
const RETRY_BACKOFFS_MS = [1500, 3000];

/** Number of top comments included alongside the post body. */
const MAX_COMMENTS = 3;

export interface RedditContent {
	author: string;
	title: string;
	selftext: string;
	comments: string[];
	url: string;
}

/**
 * One parsed Atom `<entry>` from a Reddit post feed. The post is the first
 * entry (its `content` is the selftext); every entry after it is a comment.
 */
interface AtomEntry {
	author: string;
	title: string;
	content: string;
}

/**
 * Check whether a URL points to Reddit (including share/short links and the
 * `redd.it` media/short domain).
 */
export function isRedditUrl(url: string): boolean {
	// detectPlatform only recognizes video platforms (its Platform union has no
	// 'reddit'), so Reddit is matched purely by hostname against the web and
	// short/share domains.
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	return host === 'reddit.com' || host.endsWith('.reddit.com') ||
		host === 'redd.it' || host.endsWith('.redd.it');
}

/**
 * True when a Reddit URL is a `/s/` share link (or a `redd.it` short link)
 * that redirects to a canonical post rather than pointing directly at one.
 */
function isShareLink(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (host === 'redd.it' || host.endsWith('.redd.it')) {
			return true;
		}
		return /\/s\/[^/]+\/?$/.test(parsed.pathname);
	} catch {
		return false;
	}
}

/** Resolve after `ms`, using the same window timer the fetch timeout uses. */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

/**
 * GET a Reddit URL via Obsidian's `requestUrl` (never native fetch, for mobile
 * CSP compatibility #88), racing each attempt against {@link FETCH_TIMEOUT_MS}.
 *
 * Reddit rate-limits the RSS endpoint hard, so a transient 429/503 is retried
 * up to {@link RETRY_BACKOFFS_MS}.length times with backoff before the status is
 * surfaced to the caller. `throw: false` keeps a 4xx/5xx body intact (Obsidian
 * strips it on a thrown response) so the caller can report the real status
 * rather than an opaque network failure.
 */
async function requestRedditUrl(url: string, accept: string): Promise<RequestUrlResponse> {
	let response: RequestUrlResponse | undefined;
	for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(() => reject(new Error('Reddit fetch timed out')), FETCH_TIMEOUT_MS)
		);
		response = await Promise.race([
			requestUrl({
				url,
				method: 'GET',
				headers: { 'User-Agent': FETCH_USER_AGENT, 'Accept': accept },
				throw: false,
			}),
			timeout,
		]);
		if (RETRY_STATUSES.has(response.status) && attempt < RETRY_BACKOFFS_MS.length) {
			await sleep(RETRY_BACKOFFS_MS[attempt]);
			continue;
		}
		return response;
	}
	// The loop always returns inside its body once retries are exhausted; this
	// is only reached if RETRY_BACKOFFS_MS is empty.
	return response as RequestUrlResponse;
}

/**
 * Fetch a Reddit post and format its author / title / selftext (plus the top
 * few comments, when present) with a trailing `Source: <url>`.
 *
 * Uses Reddit's per-post Atom feed (`<canonical-post-url>.rss?sort=top`) rather
 * than the `.json` API (which now returns HTTP 403 for unauthenticated, non-
 * browser clients) or the JS-rendered HTML page (which has no readable text).
 * The feed's first entry is the post; the remaining entries are comments.
 * `/s/` share links and `redd.it` short links are redirects, so they are
 * resolved to the canonical post URL before `.rss` is appended (see
 * {@link resolveCanonicalUrl}).
 *
 * Uses Obsidian's `requestUrl` (never native fetch) for mobile CSP
 * compatibility (#88). URL validation is delegated to sanitizeUrl, which
 * rejects non-HTTP(S) schemes and shell metacharacters.
 */
export async function fetchRedditContent(url: string, maxLength: number): Promise<string> {
	const validatedUrl = sanitizeUrl(url);

	try {
		const canonicalUrl = await resolveCanonicalUrl(validatedUrl);
		const rssUrl = toRssUrl(canonicalUrl);

		const response = await requestRedditUrl(rssUrl, 'application/atom+xml, text/xml');

		if (response.status >= 400) {
			throw new Error(`Reddit returned HTTP ${response.status}`);
		}

		const entries = parseAtomEntries(response.text);
		const post = entries[0];
		if (!post) {
			throw new Error('Reddit response missing post data');
		}

		// Comment entries follow the post; keep the first few non-empty bodies.
		const comments = entries
			.slice(1)
			.map(entry => entry.content)
			.filter(text => text.trim())
			.slice(0, MAX_COMMENTS);

		return formatReddit(
			{
				author: post.author,
				title: post.title,
				// The post entry's content carries a trailing "submitted by …"
				// footer that comment entries don't; strip it from the selftext.
				selftext: stripSubmittedByFooter(post.content),
				comments,
				url: canonicalUrl,
			},
			maxLength
		);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		throw new Error(`Failed to fetch Reddit post: ${reason}`);
	}
}

/**
 * Resolve a Reddit URL to the canonical post URL.
 *
 * Direct post URLs (`/r/<sub>/comments/<id>/...`) are returned unchanged. For
 * `/s/` share links and `redd.it` short links — which are server-side
 * redirects — Obsidian's `requestUrl` follows the redirect but does NOT expose
 * the final URL (its `RequestUrlResponse` has no `url`/`location` field), so we
 * fetch the share page and derive the canonical permalink from the HTML
 * (`<link rel="canonical">`, `og:url`, or an inline `permalink`).
 */
async function resolveCanonicalUrl(url: string): Promise<string> {
	if (!isShareLink(url)) {
		return url;
	}

	const response = await requestRedditUrl(url, 'text/html,application/xhtml+xml');

	if (response.status >= 400) {
		throw new Error(`Reddit returned HTTP ${response.status}`);
	}

	const canonical = extractCanonicalPostUrl(response.text);
	if (!canonical) {
		throw new Error('Could not resolve share link to a Reddit post');
	}
	return canonical;
}

/**
 * Derive the canonical Reddit post URL from a share page's HTML. Tries, in
 * order: `<link rel="canonical">`, the `og:url` meta tag, then a bare
 * `/r/<sub>/comments/<id>/...` permalink anywhere in the markup. Returns an
 * empty string when none is found. Only canonical post permalinks (those
 * containing `/comments/`) are accepted so a share link never resolves back to
 * another share link.
 */
export function extractCanonicalPostUrl(html: string): string {
	const canonicalMatch = html.match(
		/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i
	) ?? html.match(
		/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i
	);
	if (canonicalMatch?.[1] && canonicalMatch[1].includes('/comments/')) {
		return canonicalMatch[1];
	}

	const ogMatch = html.match(
		/<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']([^"']+)["']/i
	) ?? html.match(
		/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:url["']/i
	);
	if (ogMatch?.[1] && ogMatch[1].includes('/comments/')) {
		return ogMatch[1];
	}

	const permalinkMatch = html.match(
		/https?:\/\/(?:www\.)?reddit\.com\/r\/[^/\s"']+\/comments\/[^\s"'<>\\]+/i
	);
	if (permalinkMatch?.[0]) {
		return permalinkMatch[0];
	}

	return '';
}

/**
 * Build the `.rss` endpoint URL for a canonical Reddit post URL. Strips any
 * query/fragment and trailing slash, then appends `.rss?sort=top` (Reddit
 * serves the post + comments as an Atom feed at `<permalink>.rss`, and
 * `sort=top` surfaces the best-voted comments first).
 */
function toRssUrl(url: string): string {
	const withoutQuery = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
	return `${withoutQuery}.rss?sort=top`;
}

/**
 * Parse a Reddit post Atom feed into its entries. The first entry is the post
 * (title + selftext + OP author); the rest are comments. Reddit's feed is
 * consistently shaped, so each `<entry>` is matched with a regex — the same
 * dependency-free approach used for canonical-URL and article-text extraction
 * — rather than a DOM/XML parser the test environment doesn't provide.
 */
function parseAtomEntries(xml: string): AtomEntry[] {
	const entries: AtomEntry[] = [];
	const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
	let match: RegExpExecArray | null;
	while ((match = entryRe.exec(xml)) !== null) {
		const block = match[1];
		const titleRaw = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
		const nameRaw = block.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1] ?? '';
		const contentRaw = block.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i)?.[1] ?? '';
		entries.push({
			author: normalizeAuthor(decodeEntities(nameRaw).trim()),
			title: decodeEntities(titleRaw).replace(/\s+/g, ' ').trim(),
			content: atomContentToText(contentRaw),
		});
	}
	return entries;
}

/**
 * Convert an Atom `<content type="html">` payload to plain text. The payload is
 * entity-escaped HTML, so decode that layer first (turning `&lt;p&gt;` back into
 * real tags), strip the tags via the shared extractor, then decode the inner
 * HTML entities the recovered text still carries — including numeric references
 * like `&#32;` that the extractor leaves untouched.
 */
function atomContentToText(raw: string): string {
	if (!raw.trim()) return '';
	return decodeEntities(extractReadableText(decodeEntities(raw)));
}

/**
 * Decode the named entities Reddit's Atom feed uses plus all numeric (decimal
 * and hex) character references. `&amp;` is decoded last so a double-escaped
 * entity (e.g. `&amp;#39;`) is reduced to `&#39;` for the second decode pass
 * rather than being collapsed too early.
 */
function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(parseInt(dec, 10)))
		.replace(/&amp;/g, '&');
}

/** Safe String.fromCodePoint — empty string for out-of-range/invalid points. */
function fromCodePoint(code: number): string {
	return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
		? String.fromCodePoint(code)
		: '';
}

/** Strip the leading `/u/` (or `u/`) from a Reddit RSS author name. */
function normalizeAuthor(name: string): string {
	const stripped = name.replace(/^\/?u\//i, '').trim();
	return stripped || 'unknown';
}

/**
 * Strip Reddit's RSS post footer ("submitted by /u/… [link] [comments]") that
 * is appended to the post entry's content. Anchored on the trailing
 * `[comments]` marker so it can't truncate legitimate post prose.
 */
function stripSubmittedByFooter(text: string): string {
	return text.replace(/\s*submitted by\b[\s\S]*?\[comments\]\s*$/i, '').trim();
}

function formatReddit(content: RedditContent, maxLength: number): string {
	const parts: string[] = [];
	const header = content.title
		? `u/${content.author}: ${content.title}`
		: `u/${content.author}`;
	parts.push(header);
	if (content.selftext.trim()) {
		parts.push('', content.selftext.trim());
	}
	content.comments.forEach((comment, i) => {
		if (comment.trim()) {
			parts.push('', `Comment ${i + 1}: ${comment.trim()}`);
		}
	});
	parts.push('', `Source: ${content.url}`);
	return parts.join('\n').slice(0, maxLength);
}
