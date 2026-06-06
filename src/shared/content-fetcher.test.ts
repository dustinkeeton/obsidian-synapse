import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	extractReadableText,
	fetchPageContent,
	fetchArticleContent,
	extractTitle,
	extractMetaDescription,
	extractJsonLdRecipes,
	formatRecipeStructuredData,
} from './content-fetcher';

/**
 * Tests for the shared content fetcher: readable-text extraction,
 * JSON-LD recipe parsing, page/article fetching, and title/description
 * extraction. Network access is mocked via the obsidian requestUrl stub.
 */

describe('extractReadableText', () => {
	it('strips HTML tags', () => {
		const html = '<p>Hello <strong>world</strong></p>';
		const text = extractReadableText(html);
		expect(text).toBe('Hello world');
	});

	it('removes script tags and their content', () => {
		const html = '<p>Content</p><script>alert("xss")</script><p>More</p>';
		const text = extractReadableText(html);
		expect(text).not.toContain('alert');
		expect(text).toContain('Content');
		expect(text).toContain('More');
	});

	it('removes style tags and their content', () => {
		const html = '<style>.foo { color: red }</style><p>Text</p>';
		const text = extractReadableText(html);
		expect(text).not.toContain('color');
		expect(text).toContain('Text');
	});

	it('prioritizes article content', () => {
		const html = '<body><nav>Menu</nav><article><p>Main content</p></article><footer>Footer</footer></body>';
		const text = extractReadableText(html);
		expect(text).toContain('Main content');
		expect(text).not.toContain('Menu');
		expect(text).not.toContain('Footer');
	});

	it('prioritizes main content when no article', () => {
		const html = '<body><nav>Nav</nav><main><p>Main stuff</p></main></body>';
		const text = extractReadableText(html);
		expect(text).toContain('Main stuff');
		expect(text).not.toContain('Nav');
	});

	it('falls back to body content', () => {
		const html = '<body><p>Body text</p></body>';
		const text = extractReadableText(html);
		expect(text).toContain('Body text');
	});

	it('decodes HTML entities', () => {
		const html = '<p>Tom &amp; Jerry &lt;3 &quot;fun&quot;</p>';
		const text = extractReadableText(html);
		expect(text).toBe('Tom & Jerry <3 "fun"');
	});

	it('normalizes whitespace', () => {
		const html = '<p>Hello    \n\n   world</p>';
		const text = extractReadableText(html);
		expect(text).toBe('Hello world');
	});

	it('removes nav, header, footer, aside elements', () => {
		const html = '<body><header>H</header><nav>N</nav><p>Content</p><aside>A</aside><footer>F</footer></body>';
		const text = extractReadableText(html);
		expect(text).toContain('Content');
		expect(text).not.toContain(' H ');
		expect(text).not.toContain(' N ');
		expect(text).not.toContain(' A ');
		expect(text).not.toContain(' F ');
	});

	it('handles empty HTML', () => {
		expect(extractReadableText('')).toBe('');
	});

	it('removes HTML comments', () => {
		const html = '<!-- comment --><p>Text</p>';
		const text = extractReadableText(html);
		expect(text).not.toContain('comment');
		expect(text).toContain('Text');
	});
});

// ── extractJsonLdRecipes ──────────────────────────────────────────────

describe('extractJsonLdRecipes', () => {
	it('extracts a direct Recipe JSON-LD', () => {
		const html = `<html><head><script type="application/ld+json">{"@type":"Recipe","name":"Pancakes","recipeIngredient":["1 cup flour","2 eggs"]}</script></head><body></body></html>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].name).toBe('Pancakes');
		expect(recipes[0].recipeIngredient).toEqual(['1 cup flour', '2 eggs']);
	});

	it('extracts recipes from @graph wrapper', () => {
		const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage","name":"Site"},{"@type":"Recipe","name":"Soup","recipeIngredient":["1 lb chicken"]}]}</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].name).toBe('Soup');
	});

	it('extracts recipes from top-level array', () => {
		const html = `<script type="application/ld+json">[{"@type":"Recipe","name":"Cake"},{"@type":"Recipe","name":"Cookies"}]</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(2);
		expect(recipes[0].name).toBe('Cake');
		expect(recipes[1].name).toBe('Cookies');
	});

	it('handles @type as array', () => {
		const html = `<script type="application/ld+json">{"@type":["Recipe","HowTo"],"name":"Bread"}</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].name).toBe('Bread');
	});

	it('returns empty array when no ld+json scripts exist', () => {
		const html = `<html><head><script>var x = 1;</script></head><body>Hello</body></html>`;
		expect(extractJsonLdRecipes(html)).toEqual([]);
	});

	it('skips non-Recipe types', () => {
		const html = `<script type="application/ld+json">{"@type":"Article","name":"News"}</script>`;
		expect(extractJsonLdRecipes(html)).toEqual([]);
	});

	it('skips malformed JSON', () => {
		const html = `<script type="application/ld+json">{not valid json}</script>`;
		expect(extractJsonLdRecipes(html)).toEqual([]);
	});

	it('handles multiple script blocks', () => {
		const html = `
			<script type="application/ld+json">{"@type":"Article","name":"News"}</script>
			<script type="application/ld+json">{"@type":"Recipe","name":"Tacos"}</script>
		`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].name).toBe('Tacos');
	});

	it('handles recipes with missing optional fields', () => {
		const html = `<script type="application/ld+json">{"@type":"Recipe"}</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].name).toBeUndefined();
		expect(recipes[0].recipeIngredient).toBeUndefined();
	});

	it('handles HowToStep instruction objects', () => {
		const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Pasta","recipeInstructions":[{"@type":"HowToStep","text":"Boil water","image":"http://img.com/step1.jpg"}]}</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes).toHaveLength(1);
		expect(recipes[0].recipeInstructions).toHaveLength(1);
	});

	it('handles string instructions', () => {
		const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Toast","recipeInstructions":["Put bread in toaster","Wait 2 minutes"]}</script>`;
		const recipes = extractJsonLdRecipes(html);
		expect(recipes[0].recipeInstructions).toEqual(['Put bread in toaster', 'Wait 2 minutes']);
	});
});

// ── formatRecipeStructuredData ────────────────────────────────────────

describe('formatRecipeStructuredData', () => {
	it('formats a complete recipe', () => {
		const result = formatRecipeStructuredData([{
			name: 'Pancakes',
			recipeIngredient: ['1 cup flour', '2 eggs'],
			recipeInstructions: ['Mix ingredients', 'Cook on griddle'],
			image: 'http://img.com/pancakes.jpg',
			prepTime: 'PT10M',
			cookTime: 'PT15M',
			totalTime: 'PT25M',
			recipeYield: '4 servings',
		}]);
		expect(result).toContain('STRUCTURED RECIPE DATA');
		expect(result).toContain('Recipe: Pancakes');
		expect(result).toContain('- 1 cup flour');
		expect(result).toContain('- 2 eggs');
		expect(result).toContain('1. Mix ingredients');
		expect(result).toContain('2. Cook on griddle');
		expect(result).toContain('Images: http://img.com/pancakes.jpg');
		expect(result).toContain('Prep time: PT10M');
		expect(result).toContain('Cook time: PT15M');
		expect(result).toContain('Total time: PT25M');
		expect(result).toContain('Yield: 4 servings');
	});

	it('returns empty string for empty array', () => {
		expect(formatRecipeStructuredData([])).toBe('');
	});

	it('omits missing sections', () => {
		const result = formatRecipeStructuredData([{ name: 'Simple' }]);
		expect(result).toContain('Recipe: Simple');
		expect(result).not.toContain('Ingredients:');
		expect(result).not.toContain('Instructions:');
		expect(result).not.toContain('Images:');
	});

	it('formats multiple recipes', () => {
		const result = formatRecipeStructuredData([
			{ name: 'Recipe A', recipeIngredient: ['1 cup sugar'] },
			{ name: 'Recipe B', recipeIngredient: ['2 tbsp oil'] },
		]);
		expect(result).toContain('Recipe: Recipe A');
		expect(result).toContain('Recipe: Recipe B');
		expect(result).toContain('- 1 cup sugar');
		expect(result).toContain('- 2 tbsp oil');
	});

	it('includes step images from HowToStep objects', () => {
		const result = formatRecipeStructuredData([{
			name: 'Pasta',
			recipeInstructions: [
				{ '@type': 'HowToStep', text: 'Boil water', image: 'http://img.com/boil.jpg' },
			],
		}]);
		expect(result).toContain('1. Boil water [Image: http://img.com/boil.jpg]');
	});

	it('handles image as array', () => {
		const result = formatRecipeStructuredData([{
			name: 'Cake',
			image: ['http://img.com/a.jpg', 'http://img.com/b.jpg'],
		}]);
		expect(result).toContain('Images: http://img.com/a.jpg, http://img.com/b.jpg');
	});

	it('handles image as string', () => {
		const result = formatRecipeStructuredData([{
			name: 'Cake',
			image: 'http://img.com/cake.jpg',
		}]);
		expect(result).toContain('Images: http://img.com/cake.jpg');
	});

	it('handles recipeYield as array', () => {
		const result = formatRecipeStructuredData([{
			name: 'Bread',
			recipeYield: ['1 loaf', '8 slices'],
		}]);
		expect(result).toContain('Yield: 1 loaf, 8 slices');
	});
});

// ── fetchPageContent integration ──────────────────────────────────────

describe('fetchPageContent with JSON-LD', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('prepends structured recipe data when JSON-LD is present', async () => {
		const { requestUrl } = await import('obsidian');
		const html = `<html><head><script type="application/ld+json">{"@type":"Recipe","name":"Test","recipeIngredient":["1 cup flour"]}</script></head><body><p>Some article text</p></body></html>`;
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchPageContent('https://example.com/recipe', 10000);
		expect(result).toMatch(/^STRUCTURED RECIPE DATA/);
		expect(result).toContain('- 1 cup flour');
		expect(result).toContain('Some article text');
	});

	it('returns plain text for non-recipe pages', async () => {
		const { requestUrl } = await import('obsidian');
		const html = `<html><body><p>Just a blog post</p></body></html>`;
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchPageContent('https://example.com/blog', 10000);
		expect(result).not.toContain('STRUCTURED RECIPE DATA');
		expect(result).toContain('Just a blog post');
	});
});

// ── extractTitle ──────────────────────────────────────────────────────

describe('extractTitle', () => {
	it('extracts the <title> element', () => {
		const html = '<html><head><title>My Article</title></head><body></body></html>';
		expect(extractTitle(html)).toBe('My Article');
	});

	it('normalizes whitespace inside the title', () => {
		const html = '<title>Spaced   out\n  title</title>';
		expect(extractTitle(html)).toBe('Spaced out title');
	});

	it('decodes HTML entities in the title', () => {
		const html = '<title>Tom &amp; Jerry &lt;3</title>';
		expect(extractTitle(html)).toBe('Tom & Jerry <3');
	});

	it('falls back to og:title when <title> is absent', () => {
		const html = '<head><meta property="og:title" content="OG Headline"></head>';
		expect(extractTitle(html)).toBe('OG Headline');
	});

	it('falls back to og:title when <title> is empty', () => {
		const html = '<head><title>   </title><meta property="og:title" content="OG Headline"></head>';
		expect(extractTitle(html)).toBe('OG Headline');
	});

	it('returns empty string when no title is present', () => {
		expect(extractTitle('<html><body><p>No title here</p></body></html>')).toBe('');
	});
});

// ── extractMetaDescription ────────────────────────────────────────────

describe('extractMetaDescription', () => {
	it('extracts <meta name="description">', () => {
		const html = '<head><meta name="description" content="A short summary."></head>';
		expect(extractMetaDescription(html)).toBe('A short summary.');
	});

	it('handles content attribute before name attribute', () => {
		const html = '<head><meta content="Reversed order." name="description"></head>';
		expect(extractMetaDescription(html)).toBe('Reversed order.');
	});

	it('falls back to og:description', () => {
		const html = '<head><meta property="og:description" content="Open Graph summary."></head>';
		expect(extractMetaDescription(html)).toBe('Open Graph summary.');
	});

	it('prefers name=description over og:description', () => {
		const html =
			'<head><meta name="description" content="Primary."><meta property="og:description" content="Secondary."></head>';
		expect(extractMetaDescription(html)).toBe('Primary.');
	});

	it('decodes HTML entities in the description', () => {
		const html = '<meta name="description" content="Rock &amp; Roll">';
		expect(extractMetaDescription(html)).toBe('Rock & Roll');
	});

	it('returns empty string when no description is present', () => {
		expect(extractMetaDescription('<html><body><p>Body</p></body></html>')).toBe('');
	});
});

// ── fetchArticleContent ───────────────────────────────────────────────

describe('fetchArticleContent', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('assembles source header, title, description, and body', async () => {
		const { requestUrl } = await import('obsidian');
		const html =
			'<html><head><title>Great Article</title>' +
			'<meta name="description" content="A summary of the article."></head>' +
			'<body><article><p>The full article body text.</p></article></body></html>';
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchArticleContent('https://example.com/post', 10000);

		expect(result).toContain('Source: https://example.com/post');
		expect(result).toContain('Title: Great Article');
		expect(result).toContain('Description: A summary of the article.');
		expect(result).toContain('The full article body text.');
		// Source header must come first
		expect(result.startsWith('Source: https://example.com/post')).toBe(true);
	});

	it('omits title and description lines when absent', async () => {
		const { requestUrl } = await import('obsidian');
		const html = '<html><body><p>Just body content.</p></body></html>';
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchArticleContent('https://example.com/bare', 10000);

		expect(result).toContain('Source: https://example.com/bare');
		expect(result).not.toContain('Title:');
		expect(result).not.toContain('Description:');
		expect(result).toContain('Just body content.');
	});

	it('truncates the assembled content to maxLength', async () => {
		const { requestUrl } = await import('obsidian');
		const longBody = 'word '.repeat(500);
		const html = `<html><head><title>Long</title></head><body><p>${longBody}</p></body></html>`;
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchArticleContent('https://example.com/long', 50);

		expect(result.length).toBe(50);
		expect(result.startsWith('Source: https://example.com/long')).toBe(true);
	});

	it('sends a browser User-Agent header', async () => {
		const { requestUrl } = await import('obsidian');
		const spy = vi
			.mocked(requestUrl)
			.mockResolvedValue({ text: '<html><body><p>x</p></body></html>' } as never);

		await fetchArticleContent('https://example.com/ua', 10000);

		const call = spy.mock.calls[0][0] as { headers?: Record<string, string> };
		expect(call.headers?.['User-Agent']).toBe('Mozilla/5.0 (compatible; ObsidianSynapse/1.0)');
	});

	it('rejects non-HTTP URLs via sanitizeUrl', async () => {
		await expect(fetchArticleContent('ftp://evil.example.com/x', 10000)).rejects.toThrow();
	});

	it('rejects malformed URLs via sanitizeUrl', async () => {
		await expect(fetchArticleContent('not a url', 10000)).rejects.toThrow();
	});

	it('uses a sensible default maxLength when omitted', async () => {
		const { requestUrl } = await import('obsidian');
		const html = '<html><head><title>Default</title></head><body><p>Body</p></body></html>';
		vi.mocked(requestUrl).mockResolvedValue({ text: html } as never);

		const result = await fetchArticleContent('https://example.com/default');
		expect(result).toContain('Source: https://example.com/default');
		expect(result).toContain('Title: Default');
	});
});

// fetchTweetContent tests have been migrated to src/shared/tweet-fetcher.test.ts
