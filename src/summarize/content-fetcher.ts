import { requestUrl } from 'obsidian';
import { sanitizeUrl } from '../shared';

/**
 * Fetch a webpage and extract readable text content.
 */
/** Default timeout for page fetch requests (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

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
			parsed = JSON.parse(match[1]);
		} catch {
			continue;
		}

		const candidates: unknown[] = [];

		if (Array.isArray(parsed)) {
			candidates.push(...parsed);
		} else if (parsed && typeof parsed === 'object') {
			const obj = parsed as Record<string, unknown>;
			if (Array.isArray(obj['@graph'])) {
				candidates.push(...obj['@graph']);
			} else {
				candidates.push(obj);
			}
		}

		for (const candidate of candidates) {
			if (candidate && typeof candidate === 'object') {
				const c = candidate as Record<string, unknown>;
				const type = c['@type'];
				const isRecipe =
					type === 'Recipe' ||
					(Array.isArray(type) && type.includes('Recipe'));
				if (isRecipe) {
					recipes.push(candidate as RecipeJsonLd);
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

/**
 * Fetch tweet text via Twitter's oEmbed API (no auth required).
 * Extracts the tweet body from the HTML field in the oEmbed response.
 */
export async function fetchTweetContent(url: string, maxLength: number): Promise<string> {
	const validatedUrl = sanitizeUrl(url);
	const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(validatedUrl)}`;

	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error('Tweet fetch timed out')), FETCH_TIMEOUT_MS)
	);

	const response = await Promise.race([
		requestUrl({ url: oembedUrl, method: 'GET' }),
		timeout,
	]);

	const data = JSON.parse(response.text);

	// Extract tweet text from the blockquote in the HTML field
	const blockquoteMatch = (data.html as string).match(/<blockquote[^>]*><p[^>]*>([\s\S]*?)<\/p>/);
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
	const formatted = `${author}: ${tweetText}\n\nSource: ${validatedUrl}`;
	return formatted.slice(0, maxLength);
}

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
