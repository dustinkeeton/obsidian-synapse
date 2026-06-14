import { requestUrl } from 'obsidian';
import { sanitizeUrl } from './validation';
import { withRetry } from './api-utils';
import { detectPlatform } from './url-detector';
import { isRecord, parseJson } from './json-utils';

const FETCH_TIMEOUT_MS = 30_000;

export interface TweetContent {
	author: string;
	text: string;
	url: string;
}

/**
 * Twitter / fxtwitter oEmbed response — an HTML blockquote plus author handle.
 * Both fields are best-effort: a missing `html` yields empty tweet text and a
 * missing `author_name` falls back to "Unknown" (see {@link fetchViaOEmbed}),
 * so neither is required.
 */
interface OEmbedResponse {
	html?: string;
	author_name?: string;
}

/**
 * vxtwitter JSON response — structured `{ user_name, text }`. Both are
 * best-effort: a missing `user_name` falls back to "Unknown" and a missing
 * `text` to an empty string (see {@link fetchViaVxTwitter}).
 */
interface VxTwitterResponse {
	user_name?: string;
	text?: string;
}

/** Narrow unknown oEmbed JSON, coercing each consumed field to a string. */
function asOEmbedResponse(value: unknown): OEmbedResponse {
	if (!isRecord(value)) {
		return {};
	}
	return {
		html: typeof value.html === 'string' ? value.html : undefined,
		author_name: typeof value.author_name === 'string' ? value.author_name : undefined,
	};
}

/** Narrow unknown vxtwitter JSON, coercing each consumed field to a string. */
function asVxTwitterResponse(value: unknown): VxTwitterResponse {
	if (!isRecord(value)) {
		return {};
	}
	return {
		user_name: typeof value.user_name === 'string' ? value.user_name : undefined,
		text: typeof value.text === 'string' ? value.text : undefined,
	};
}

/**
 * Check whether a URL points to Twitter or X.com.
 */
export function isTwitterUrl(url: string): boolean {
	const result = detectPlatform(url);
	return result?.platform === 'twitter';
}

/**
 * Fetch tweet text via a fallback chain of oEmbed / proxy APIs.
 *
 * 1. Twitter oEmbed (with retry) — official, sometimes returns 503
 * 2. fxtwitter oEmbed — community mirror, same HTML format
 * 3. vxtwitter JSON — community mirror, structured JSON
 */
export async function fetchTweetContent(url: string, maxLength: number): Promise<string> {
	const validatedUrl = sanitizeUrl(url);

	// Try the primary + two fallbacks in order
	let lastError: Error | undefined;

	// 1. Official Twitter oEmbed with retry (2 attempts, 1s exponential backoff)
	try {
		const tweet = await withRetry(
			() => fetchViaOEmbed(validatedUrl, 'https://publish.twitter.com/oembed'),
			2,
			1000
		);
		return formatTweet(tweet, maxLength);
	} catch (e) {
		lastError = e as Error;
	}

	// 2. fxtwitter oEmbed — single attempt
	try {
		const tweet = await fetchViaFxTwitter(validatedUrl);
		return formatTweet(tweet, maxLength);
	} catch (e) {
		lastError = e as Error;
	}

	// 3. vxtwitter JSON — single attempt
	try {
		const tweet = await fetchViaVxTwitter(validatedUrl);
		return formatTweet(tweet, maxLength);
	} catch (e) {
		lastError = e as Error;
	}

	throw new Error(
		`Failed to fetch tweet from all sources: ${lastError?.message ?? 'unknown error'}`
	);
}

/**
 * Fetch via any oEmbed endpoint that returns the same HTML blockquote format.
 */
async function fetchViaOEmbed(url: string, endpoint: string): Promise<TweetContent> {
	const oembedUrl = `${endpoint}?url=${encodeURIComponent(url)}`;

	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('Tweet fetch timed out')), FETCH_TIMEOUT_MS)
	);

	const response = await Promise.race([
		requestUrl({ url: oembedUrl, method: 'GET' }),
		timeout,
	]);

	const data = asOEmbedResponse(parseJson(response.text));

	// A missing/non-string `html` yields no match → empty tweet text, instead of
	// throwing on `.match` of undefined (preserves graceful degradation).
	const blockquoteMatch = data.html?.match(/<blockquote[^>]*><p[^>]*>([\s\S]*?)<\/p>/);
	const tweetText = blockquoteMatch
		? blockquoteMatch[1]
			.replace(/<br\s*\/?>/g, '\n')
			.replace(/<a[^>]*>([\s\S]*?)<\/a>/g, '$1')
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.trim()
		: '';

	const author = data.author_name ? `@${data.author_name}` : 'Unknown';
	return { author, text: tweetText, url };
}

/**
 * Fetch via fxtwitter oEmbed — same HTML blockquote format as Twitter.
 */
async function fetchViaFxTwitter(url: string): Promise<TweetContent> {
	return fetchViaOEmbed(url, 'https://api.fxtwitter.com/oembed');
}

/**
 * Fetch via vxtwitter JSON API — returns structured { user_name, text }.
 * URL format: https://api.vxtwitter.com/Twitter/status/{id}
 */
async function fetchViaVxTwitter(url: string): Promise<TweetContent> {
	// Extract status ID from the URL
	const idMatch = url.match(/status\/(\d+)/);
	if (!idMatch) {
		throw new Error('Cannot extract tweet ID from URL');
	}

	const apiUrl = `https://api.vxtwitter.com/Twitter/status/${idMatch[1]}`;

	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('Tweet fetch timed out')), FETCH_TIMEOUT_MS)
	);

	const response = await Promise.race([
		requestUrl({ url: apiUrl, method: 'GET' }),
		timeout,
	]);

	const data = asVxTwitterResponse(parseJson(response.text));

	const author = data.user_name ? `@${data.user_name}` : 'Unknown';
	const text = data.text ?? '';
	return { author, text, url };
}

function formatTweet(tweet: TweetContent, maxLength: number): string {
	const formatted = `${tweet.author}: ${tweet.text}\n\nSource: ${tweet.url}`;
	return formatted.slice(0, maxLength);
}
