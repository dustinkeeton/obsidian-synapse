import { describe, it, expect } from 'vitest';
import { SourceProvider, imageRelevance, toSourceCandidate } from './source';
import type { SourceImage } from '../../shared';

const page = 'https://example.com/pandas';
const images: SourceImage[] = [
	{ url: 'https://example.com/hero.jpg', alt: 'Site hero banner', pageUrl: page, title: 'Pandas' },
	{ url: 'https://example.com/panda.jpg', alt: 'A red panda eating bamboo', pageUrl: page, title: 'Pandas' },
	{ url: 'https://example.com/map.png', pageUrl: page },
];

describe('imageRelevance', () => {
	it('scores by query-token overlap with alt and title, ignoring short tokens', () => {
		expect(imageRelevance(images[1], 'red panda bamboo')).toBe(1);
		expect(imageRelevance(images[1], 'panda bamboo forest')).toBeCloseTo(2 / 3);
		expect(imageRelevance(images[0], 'red panda')).toBe(0);
		expect(imageRelevance(images[2], 'a of')).toBe(0);
	});
});

describe('SourceProvider', () => {
	it('ranks by relevance, keeps input order for ties, and honors the limit', async () => {
		const results = await new SourceProvider(images).search('red panda', { limit: 2 });
		expect(results.map((c) => c.fileUrl)).toEqual(['https://example.com/panda.jpg', 'https://example.com/hero.jpg']);
	});

	it('still returns zero-overlap images so a lone thumbnail is usable', async () => {
		const results = await new SourceProvider([images[2]]).search('red panda', { limit: 5 });
		expect(results).toHaveLength(1);
	});

	it('maps an image to a Source page candidate with the page as license and attribution target', () => {
		expect(toSourceCandidate(images[2])).toEqual({
			provider: 'source', title: 'example.com', fileUrl: images[2].url, thumbnailUrl: images[2].url,
			pageUrl: page, license: 'Source page', licenseUrl: page, attribution: 'example.com',
		});
		expect(toSourceCandidate(images[1])).toMatchObject({ title: 'A red panda eating bamboo', attribution: 'Pandas' });
	});
});
