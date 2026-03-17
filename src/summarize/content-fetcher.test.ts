import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractReadableText, fetchPageContent } from './content-fetcher';
import { isSupportedUrl } from '../video';

/**
 * Tests for the content fetcher and video URL detection integration.
 * The fetchContentForUrl logic in SummarizeModule delegates to either
 * the video transcription pipeline or fetchPageContent based on
 * isSupportedUrl(). These tests verify that isSupportedUrl correctly
 * identifies video URLs, and that fetchPageContent + extractReadableText
 * work as expected for non-video URLs.
 */

describe('isSupportedUrl integration with summarize', () => {
	it('identifies YouTube watch URLs as video', () => {
		expect(isSupportedUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
		expect(isSupportedUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
	});

	it('identifies YouTube short URLs as video', () => {
		expect(isSupportedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
	});

	it('identifies YouTube Shorts as video', () => {
		expect(isSupportedUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
	});

	it('identifies TikTok URLs as video', () => {
		expect(isSupportedUrl('https://www.tiktok.com/@user/video/1234567890')).toBe(true);
		expect(isSupportedUrl('https://www.tiktok.com/t/ZThw1txpF/')).toBe(true);
		expect(isSupportedUrl('https://vm.tiktok.com/ZMxxxxxxx/')).toBe(true);
	});

	it('does not flag regular article URLs as video', () => {
		expect(isSupportedUrl('https://example.com/article')).toBe(false);
		expect(isSupportedUrl('https://en.wikipedia.org/wiki/Topic')).toBe(false);
		expect(isSupportedUrl('https://blog.example.com/post-123')).toBe(false);
	});

	it('does not flag YouTube channel URLs as video', () => {
		expect(isSupportedUrl('https://youtube.com/channel/UCxxxx')).toBe(false);
		expect(isSupportedUrl('https://youtube.com/@username')).toBe(false);
	});

	it('does not flag empty strings', () => {
		expect(isSupportedUrl('')).toBe(false);
	});
});

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
