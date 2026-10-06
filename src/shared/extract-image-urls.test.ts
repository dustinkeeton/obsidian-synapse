import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { extractImageUrls, fetchPageContentWithImages, fetchHtmlDocument, stripTrackingParams } from './content-fetcher';

const BASE = 'https://example.com/articles/pandas';

describe('extractImageUrls', () => {
	it('puts og:image and twitter:image first, carrying the page title', () => {
		const html = '<html><head><title>Pandas &amp; bamboo</title><meta property="og:image" content="/img/hero.jpg"><meta name="twitter:image" content="https://cdn.example.com/card.png"></head><body><img src="/img/body.jpg" alt="A panda"></body></html>';
		const images = extractImageUrls(html, BASE);
		expect(images.map((i) => i.url)).toEqual(['https://example.com/img/hero.jpg', 'https://cdn.example.com/card.png', 'https://example.com/img/body.jpg']);
		expect(images[0]).toMatchObject({ pageUrl: BASE, title: 'Pandas & bamboo', alt: 'Pandas & bamboo' });
		expect(images[2].alt).toBe('A panda');
	});

	it('resolves relative URLs, reads srcset, and dedupes', () => {
		const html = '<img srcset="../a.jpg 1x, ../a@2x.jpg 2x" alt="x"><img src="../a.jpg"><img src=\'b.webp\'>';
		expect(extractImageUrls(html, BASE).map((i) => i.url)).toEqual(['https://example.com/a.jpg', 'https://example.com/articles/b.webp']);
	});

	it('skips data URIs, tracking pixels, SVGs, chrome assets, and non-http schemes', () => {
		const html = [
			'<img src="data:image/gif;base64,R0lGOD">',
			'<img src="/pixel.gif" width="1" height="1">',
			'<img src="/t.png" height=1>',
			'<img src="/brand/logo.png">',
			'<img src="/icons/sprite.svg">',
			'<img src="/img/avatar-12.jpg">',
			'<img src="ftp://example.com/x.jpg">',
			'<img src="/real.jpg">',
		].join('');
		expect(extractImageUrls(html, BASE).map((i) => i.url)).toEqual(['https://example.com/real.jpg']);
	});

	it('strips tracking params and resolves protocol-relative Wikimedia srcs against the page origin', () => {
		const html = '<meta property="og:image" content="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Flag.svg/1280px-Flag.svg.png?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=thumbnail&width=1280"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Ship.jpg/220px-Ship.jpg" srcset="//upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Ship.jpg/330px-Ship.jpg 1.5x" alt="Ship">';
		expect(extractImageUrls(html, 'https://en.wikipedia.org/wiki/Piracy').map((i) => i.url)).toEqual([
			'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Flag.svg/1280px-Flag.svg.png?width=1280',
			'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Ship.jpg/220px-Ship.jpg',
		]);
		expect(stripTrackingParams('https://x.test/a.jpg?fbclid=1&ref=home&size=2')).toBe('https://x.test/a.jpg?size=2');
		expect(stripTrackingParams('not a url')).toBe('not a url');
	});

	it('caps at 12 images', () => {
		const html = Array.from({ length: 20 }, (_, i) => `<img src="/p${i}.jpg">`).join('');
		expect(extractImageUrls(html, BASE)).toHaveLength(12);
	});
});

describe('fetchPageContentWithImages', () => {
	beforeEach(() => vi.mocked(requestUrl).mockReset());

	it('returns readable text alongside the extracted images', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, text: '<html><body><article><p>Hello</p><img src="/x.jpg"></article></body></html>', headers: { 'content-type': 'text/html' } } as never);
		const result = await fetchPageContentWithImages(BASE, 1000);
		expect(result.text).toBe('Hello');
		expect(result.images.map((i) => i.url)).toEqual(['https://example.com/x.jpg']);
	});

	it('exposes the content type through fetchHtmlDocument', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, text: '%PDF', headers: { 'Content-Type': 'application/pdf' } } as never);
		expect(await fetchHtmlDocument(BASE)).toEqual({ html: '%PDF', contentType: 'application/pdf' });
	});
});
