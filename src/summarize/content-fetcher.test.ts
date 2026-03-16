import { describe, it, expect } from 'vitest';
import { extractReadableText } from './content-fetcher';

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
