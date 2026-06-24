import { requestUrl } from 'obsidian';
import { sanitizeUrl } from './validation';
import { isRecord, parseJson } from './json-utils';

const FETCH_TIMEOUT_MS = 30_000;

/** User-Agent sent with Reddit fetches so the JSON/HTML endpoints respond. */
const FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; ObsidianSynapse/1.0)';

export interface RedditContent {
	author: string;
	title: string;
	selftext: string;
	topComment: string;
	url: string;
}

/**
 * Reddit listing JSON shape (best-effort). GET `<post-url>.json` returns an
 * array of two listings: `[0]` is the post, `[1]` is the comment tree. Each
 * listing is `{ data: { children: [{ data: {...} }] } }`. Every consumed field
 * is narrowed defensively (see {@link asRedditPost}) so a missing/renamed key
 * degrades gracefully instead of throwing.
 */
interface RedditPost {
	author: string;
	title: string;
	selftext: string;
}

/** Narrow the `data.children[0].data` of a Reddit listing to a {@link RedditPost}. */
function asRedditPost(value: unknown): RedditPost | null {
	if (!isRecord(value)) {
		return null;
	}
	const data = value.data;
	if (!isRecord(data)) {
		return null;
	}
	// `Array.isArray` narrows `unknown` to `any[]`; bind to `unknown[]` first so
	// indexing doesn't leak `any` (each element is structurally guarded below).
	if (!Array.isArray(data.children) || data.children.length === 0) {
		return null;
	}
	const children: unknown[] = data.children;
	const first = children[0];
	if (!isRecord(first)) {
		return null;
	}
	const inner = first.data;
	if (!isRecord(inner)) {
		return null;
	}
	return {
		author: typeof inner.author === 'string' ? inner.author : 'unknown',
		title: typeof inner.title === 'string' ? inner.title : '',
		selftext: typeof inner.selftext === 'string' ? inner.selftext : '',
	};
}

/** Pull the first comment's body text from a Reddit comment listing, if any. */
function extractTopComment(value: unknown): string {
	if (!isRecord(value)) {
		return '';
	}
	const data = value.data;
	if (!isRecord(data)) {
		return '';
	}
	if (!Array.isArray(data.children)) {
		return '';
	}
	const children: unknown[] = data.children;
	for (const child of children) {
		if (!isRecord(child)) continue;
		// Skip the "more comments" stub and anything without a body.
		const inner = child.data;
		if (!isRecord(inner)) continue;
		const body = inner.body;
		if (typeof body === 'string' && body.trim()) {
			return body;
		}
	}
	return '';
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

/**
 * Fetch a Reddit post and format its author / title / selftext (plus the top
 * comment, when present) with a trailing `Source: <url>`.
 *
 * Uses Reddit's JSON endpoint (`<canonical-post-url>.json`) rather than
 * scraping the JS-rendered HTML page. `/s/` share links and `redd.it` short
 * links are redirects, so they are resolved to the canonical post URL before
 * `.json` is appended (see {@link resolveCanonicalUrl}).
 *
 * Uses Obsidian's `requestUrl` (never native fetch) for mobile CSP
 * compatibility (#88). URL validation is delegated to sanitizeUrl, which
 * rejects non-HTTP(S) schemes and shell metacharacters.
 */
export async function fetchRedditContent(url: string, maxLength: number): Promise<string> {
	const validatedUrl = sanitizeUrl(url);

	try {
		const canonicalUrl = await resolveCanonicalUrl(validatedUrl);
		const jsonUrl = toJsonUrl(canonicalUrl);

		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(() => reject(new Error('Reddit fetch timed out')), FETCH_TIMEOUT_MS)
		);

		const response = await Promise.race([
			requestUrl({
				url: jsonUrl,
				method: 'GET',
				headers: {
					'User-Agent': FETCH_USER_AGENT,
					'Accept': 'application/json',
				},
			}),
			timeout,
		]);

		const parsed = parseJson(response.text);

		// The post listing is the first element of the array; the comment tree
		// (when present) is the second. Narrow each defensively. Typed as
		// `unknown[]` so element access doesn't leak `any` from Array.isArray.
		const listings: unknown[] = Array.isArray(parsed) ? parsed : [];
		const post = asRedditPost(listings[0]);
		if (!post) {
			throw new Error('Reddit response missing post data');
		}
		const topComment = listings.length > 1 ? extractTopComment(listings[1]) : '';

		return formatReddit(
			{
				author: post.author,
				title: post.title,
				selftext: post.selftext,
				topComment,
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

	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('Reddit fetch timed out')), FETCH_TIMEOUT_MS)
	);

	const response = await Promise.race([
		requestUrl({
			url,
			method: 'GET',
			headers: {
				'User-Agent': FETCH_USER_AGENT,
				'Accept': 'text/html,application/xhtml+xml',
			},
		}),
		timeout,
	]);

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
 * Build the `.json` endpoint URL for a canonical Reddit post URL. Strips any
 * query/fragment and trailing slash, then appends `.json` (Reddit serves the
 * post listing at `<permalink>.json`).
 */
function toJsonUrl(url: string): string {
	const withoutQuery = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
	return `${withoutQuery}.json`;
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
	if (content.topComment.trim()) {
		parts.push('', `Top comment: ${content.topComment.trim()}`);
	}
	parts.push('', `Source: ${content.url}`);
	return parts.join('\n').slice(0, maxLength);
}
