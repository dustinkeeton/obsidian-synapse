import { requestUrl } from 'obsidian';
import { sanitizeUrl } from './validation';
import { isRecord, parseJson } from './json-utils';

/**
 * Fetch a webpage and extract readable text content.
 *
 * Lives in shared/ (alongside tweet-fetcher.ts) so any feature module can
 * consume web-fetching utilities without creating cross-feature coupling.
 */
/** Default timeout for page fetch requests (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Default maximum length for assembled article content (characters).
 * TODO(#115): make configurable via settings UI.
 */
const DEFAULT_ARTICLE_MAX_LENGTH = 8000;

/** User-Agent sent with page fetches so servers return real HTML. */
const FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; ObsidianSynapse/1.0)';

export interface RecipeJsonLd {
	name?: string;
	recipeIngredient?: string[];
	recipeInstructions?: (string | { '@type'?: string; text?: string; name?: string; image?: string | string[] })[];
	image?: string | string[];
	prepTime?: string;
	cookTime?: string;
	totalTime?: string;
	recipeYield?: string | string[];
}

/**
 * Fetch raw HTML for a URL with sanitization, a browser-like User-Agent,
 * and a hard timeout. Shared by every fetcher in this module so a given
 * page is only requested once per call site.
 */
async function fetchHtml(url: string): Promise<string> {
	const validatedUrl = sanitizeUrl(url);

	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('Page fetch timed out')), FETCH_TIMEOUT_MS)
	);

	// Obsidian's requestUrl follows HTTP redirects automatically and resolves
	// with the final 200 response body, so share/short links (e.g. a `/s/`
	// Reddit link or a shortener) are dereferenced here without any extra work.
	// Note: the resolved RequestUrlResponse does NOT expose the final URL, so a
	// caller that needs the canonical URL (see reddit-fetcher.ts) must derive it
	// from the response body rather than reading it back off the response.
	const response = await Promise.race([
		requestUrl({
			url: validatedUrl,
			method: 'GET',
			headers: {
				'User-Agent': FETCH_USER_AGENT,
				'Accept': 'text/html,application/xhtml+xml',
			},
		}),
		timeout,
	]);

	return response.text;
}

/**
 * Extract JSON-LD Recipe data from raw HTML.
 * Handles direct `@type: "Recipe"`, `@graph` arrays, and top-level arrays.
 */
export function extractJsonLdRecipes(html: string): RecipeJsonLd[] {
	const recipes: RecipeJsonLd[] = [];
	const scriptRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match: RegExpExecArray | null;

	while ((match = scriptRegex.exec(html)) !== null) {
		let parsed: unknown;
		try {
			parsed = parseJson(match[1]);
		} catch {
			continue;
		}

		const candidates: unknown[] = [];

		// `Array.isArray` narrows `unknown` to `any[]`, so spreading the result
		// directly would leak `any` into `candidates`. Type the arrays as
		// `unknown[]` first; each element is structurally guarded below anyway.
		if (Array.isArray(parsed)) {
			const arr: unknown[] = parsed;
			candidates.push(...arr);
		} else if (isRecord(parsed)) {
			const graph = parsed['@graph'];
			if (Array.isArray(graph)) {
				const arr: unknown[] = graph;
				candidates.push(...arr);
			} else {
				candidates.push(parsed);
			}
		}

		for (const candidate of candidates) {
			if (isRecord(candidate)) {
				const type = candidate['@type'];
				const isRecipe =
					type === 'Recipe' ||
					(Array.isArray(type) && type.includes('Recipe'));
				if (isRecipe) {
					recipes.push(candidate);
				}
			}
		}
	}

	return recipes;
}

/**
 * Convert extracted JSON-LD recipes into a plain-text preamble.
 * Returns empty string if no recipes found.
 */
export function formatRecipeStructuredData(recipes: RecipeJsonLd[]): string {
	if (recipes.length === 0) return '';

	const sections: string[] = ['STRUCTURED RECIPE DATA (from page schema):'];

	for (const recipe of recipes) {
		if (recipe.name) {
			sections.push(`Recipe: ${recipe.name}`);
		}

		if (recipe.recipeIngredient && recipe.recipeIngredient.length > 0) {
			sections.push('Ingredients:');
			for (const ing of recipe.recipeIngredient) {
				sections.push(`- ${ing}`);
			}
		}

		if (recipe.recipeInstructions && recipe.recipeInstructions.length > 0) {
			sections.push('Instructions:');
			let stepNum = 1;
			for (const instruction of recipe.recipeInstructions) {
				if (typeof instruction === 'string') {
					sections.push(`${stepNum}. ${instruction}`);
					stepNum++;
				} else if (instruction && typeof instruction === 'object') {
					const text = instruction.text || instruction.name || '';
					if (text) {
						let line = `${stepNum}. ${text}`;
						const img = instruction.image;
						if (img) {
							const imgUrl = Array.isArray(img) ? img[0] : img;
							if (imgUrl) line += ` [Image: ${imgUrl}]`;
						}
						sections.push(line);
						stepNum++;
					}
				}
			}
		}

		const images: string[] = [];
		if (recipe.image) {
			if (Array.isArray(recipe.image)) {
				images.push(...recipe.image);
			} else {
				images.push(recipe.image);
			}
		}
		if (images.length > 0) {
			sections.push(`Images: ${images.join(', ')}`);
		}

		if (recipe.prepTime) sections.push(`Prep time: ${recipe.prepTime}`);
		if (recipe.cookTime) sections.push(`Cook time: ${recipe.cookTime}`);
		if (recipe.totalTime) sections.push(`Total time: ${recipe.totalTime}`);
		if (recipe.recipeYield) {
			const yield_ = Array.isArray(recipe.recipeYield)
				? recipe.recipeYield.join(', ')
				: recipe.recipeYield;
			sections.push(`Yield: ${yield_}`);
		}
	}

	return sections.join('\n');
}

export async function fetchPageContent(url: string, maxLength: number): Promise<string> {
	const html = await fetchHtml(url);
	const recipes = extractJsonLdRecipes(html);
	const structuredPreamble = formatRecipeStructuredData(recipes);
	const readableText = extractReadableText(html);
	const combined = structuredPreamble
		? structuredPreamble + '\n\n' + readableText
		: readableText;
	return combined.slice(0, maxLength);
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

/**
 * Decode the small set of HTML entities that appear in titles and meta tags.
 */
function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.trim();
}

/**
 * Extract the page title from raw HTML.
 * Prefers the <title> element, falling back to the og:title meta tag.
 * Returns an empty string when neither is present.
 */
export function extractTitle(html: string): string {
	const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	if (titleMatch?.[1]) {
		const title = decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' '));
		if (title) return title;
	}

	const ogTitle = extractMetaContent(html, 'og:title');
	return ogTitle ? decodeHtmlEntities(ogTitle) : '';
}

/**
 * Extract the page description from raw HTML.
 * Prefers <meta name="description">, falling back to og:description.
 * Returns an empty string when neither is present.
 */
export function extractMetaDescription(html: string): string {
	const description = extractMetaContent(html, 'description');
	if (description) return decodeHtmlEntities(description);

	const ogDescription = extractMetaContent(html, 'og:description');
	return ogDescription ? decodeHtmlEntities(ogDescription) : '';
}

/**
 * Pull the `content` attribute from a <meta> tag matching the given
 * name or property key. Handles attribute ordering in either direction
 * (name-before-content and content-before-name).
 */
function extractMetaContent(html: string, key: string): string {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	// name/property attribute appears before content attribute
	const forward = new RegExp(
		`<meta\\b[^>]*?(?:name|property)\\s*=\\s*["']${escapedKey}["'][^>]*?\\bcontent\\s*=\\s*["']([^"']*)["']`,
		'i'
	);
	const forwardMatch = html.match(forward);
	if (forwardMatch?.[1]) return forwardMatch[1];

	// content attribute appears before name/property attribute
	const backward = new RegExp(
		`<meta\\b[^>]*?\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*?(?:name|property)\\s*=\\s*["']${escapedKey}["']`,
		'i'
	);
	const backwardMatch = html.match(backward);
	if (backwardMatch?.[1]) return backwardMatch[1];

	return '';
}

/**
 * Fetch an article URL and assemble readable context for elaboration.
 *
 * The result is prefixed with a `Source: <url>` header, followed by the
 * page title and meta description (when present), then the extracted body
 * text. The whole thing is truncated to `maxLength` characters.
 *
 * Uses Obsidian's `requestUrl` (never native fetch) for mobile CSP
 * compatibility (#88). URL validation is delegated to sanitizeUrl, which
 * rejects non-HTTP(S) schemes and shell metacharacters.
 */
export async function fetchArticleContent(
	url: string,
	maxLength: number = DEFAULT_ARTICLE_MAX_LENGTH
): Promise<string> {
	const html = await fetchHtml(url);

	const title = extractTitle(html);
	const description = extractMetaDescription(html);
	const body = extractReadableText(html);

	const parts: string[] = [`Source: ${url}`];
	if (title) parts.push(`Title: ${title}`);
	if (description) parts.push(`Description: ${description}`);
	if (body) parts.push('', body);

	return parts.join('\n').slice(0, maxLength);
}
