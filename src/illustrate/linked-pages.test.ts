import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { fetchLinkedPageImages } from './linked-pages';

function page(n: number, imgs = 1): { status: number; text: string; headers: Record<string, string> } {
	const body = Array.from({ length: imgs }, (_, i) => `<img src="/p${n}-${i}.jpg">`).join('');
	return { status: 200, text: `<html><body>${body}</body></html>`, headers: { 'content-type': 'text/html; charset=utf-8' } };
}

describe('fetchLinkedPageImages', () => {
	beforeEach(() => vi.mocked(requestUrl).mockReset());

	it('fetches at most maxPages distinct http(s) pages and pools their images', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(page(1) as never).mockResolvedValueOnce(page(2) as never);
		const images = await fetchLinkedPageImages(
			['https://a.test/1', 'https://a.test/1', 'ftp://bad', 'https://a.test/2', 'https://a.test/3'],
			{ maxPages: 2 },
		);
		expect(requestUrl).toHaveBeenCalledTimes(2);
		expect(images.map((i) => i.url)).toEqual(['https://a.test/p1-0.jpg', 'https://a.test/p2-0.jpg']);
		expect(images[1].pageUrl).toBe('https://a.test/2');
	});

	it('skips non-HTML responses and failed fetches without aborting', async () => {
		vi.mocked(requestUrl)
			.mockResolvedValueOnce({ status: 200, text: '%PDF', headers: { 'content-type': 'application/pdf' } } as never)
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValueOnce(page(3) as never);
		const images = await fetchLinkedPageImages(['https://a.test/doc.pdf', 'https://a.test/down', 'https://a.test/3'], { maxPages: 3 });
		expect(images.map((i) => i.url)).toEqual(['https://a.test/p3-0.jpg']);
	});

	it('caps pooled images at 12 by default', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(page(1, 20) as never).mockResolvedValueOnce(page(2, 5) as never);
		const images = await fetchLinkedPageImages(['https://a.test/1', 'https://a.test/2'], { maxPages: 5 });
		expect(images).toHaveLength(12);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});
