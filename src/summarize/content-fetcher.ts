import { requestUrl } from 'obsidian';
import { sanitizeUrl } from '../shared';

/**
 * Fetch a webpage and extract readable text content.
 */
/** Default timeout for page fetch requests (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchPageContent(url: string, maxLength: number): Promise<string> {
	const validatedUrl = sanitizeUrl(url);

	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error('Page fetch timed out')), FETCH_TIMEOUT_MS)
	);

	const response = await Promise.race([
		requestUrl({
			url: validatedUrl,
			method: 'GET',
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; ObsidianSynapse/1.0)',
				'Accept': 'text/html,application/xhtml+xml',
			},
		}),
		timeout,
	]);

	const html = response.text;
	const text = extractReadableText(html);
	return text.slice(0, maxLength);
}

/**
 * Extract readable text from HTML content.
 * Prioritizes <article>, <main>, then <body> content.
 * Strips all HTML tags, scripts, styles, and normalizes whitespace.
 */
export function extractReadableText(html: string): string {
	// Remove scripts and styles first
	let cleaned = html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');

	// Try to extract content from semantic containers
	const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
	const mainMatch = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);

	const contentHtml = articleMatch?.[1] ?? mainMatch?.[1] ?? bodyMatch?.[1] ?? cleaned;

	// Remove nav, header, footer, aside elements
	const withoutChrome = contentHtml
		.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
		.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
		.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
		.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');

	// Strip all remaining HTML tags
	const text = withoutChrome.replace(/<[^>]+>/g, ' ');

	// Decode common HTML entities
	const decoded = text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');

	// Normalize whitespace
	return decoded
		.replace(/\s+/g, ' ')
		.trim();
}
