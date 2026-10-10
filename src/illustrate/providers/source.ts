import type { SourceImage } from '../../shared';
import type { MediaCandidate, MediaProvider, MediaSearchOptions } from '../types';
import { SOURCE_PAGE_LICENSE } from '../license';

function tokens(text: string): Set<string> {
	return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));
}

/** Fraction of query tokens present in the image's alt/title text. */
export function imageRelevance(image: SourceImage, query: string): number {
	const wanted = tokens(query);
	if (wanted.size === 0) return 0;
	const have = tokens(`${image.alt ?? ''} ${image.title ?? ''}`);
	let hits = 0;
	for (const token of wanted) if (have.has(token)) hits++;
	return hits / wanted.size;
}

function hostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

export function toSourceCandidate(image: SourceImage): MediaCandidate {
	return {
		provider: 'source',
		title: image.alt || image.title || hostname(image.pageUrl),
		fileUrl: image.url,
		thumbnailUrl: image.url,
		pageUrl: image.pageUrl,
		license: SOURCE_PAGE_LICENSE,
		licenseUrl: image.pageUrl,
		attribution: image.title || hostname(image.pageUrl),
	};
}

/** Serves the acted-on material's own images, ranked by alt/title overlap with the query; zero-overlap images are dropped. */
export class SourceProvider implements MediaProvider {
	readonly id = 'source' as const;

	constructor(private images: SourceImage[]) {}

	search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]> {
		const ranked = this.images
			.map((image, index) => ({ image, index, score: imageRelevance(image, query) }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score || a.index - b.index)
			.slice(0, opts.limit)
			.map(({ image }) => toSourceCandidate(image));
		return Promise.resolve(ranked);
	}
}
