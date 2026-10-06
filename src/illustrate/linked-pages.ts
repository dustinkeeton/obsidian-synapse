import { extractImageUrls, fetchHtmlDocument, redactError, sanitizeUrl } from '../shared';
import type { SourceImage } from '../shared';

export const MAX_LINKED_PAGE_IMAGES = 12;

export interface LinkedPageOptions {
	maxPages: number;
	maxImages?: number;
}

/** Fetch up to `maxPages` linked pages and pool their images; every failure is per-URL and silent. */
export async function fetchLinkedPageImages(urls: string[], opts: LinkedPageOptions): Promise<SourceImage[]> {
	const maxImages = opts.maxImages ?? MAX_LINKED_PAGE_IMAGES;
	const images: SourceImage[] = [];
	const seen = new Set<string>();
	let fetched = 0;
	for (const raw of urls) {
		if (fetched >= opts.maxPages || images.length >= maxImages) break;
		let url: string;
		try {
			url = sanitizeUrl(raw);
		} catch {
			continue;
		}
		if (seen.has(url)) continue;
		seen.add(url);
		fetched++;
		try {
			const { html, contentType } = await fetchHtmlDocument(url);
			if (contentType && !/html/i.test(contentType)) continue;
			for (const image of extractImageUrls(html, url)) {
				if (images.length >= maxImages) break;
				if (!images.some((existing) => existing.url === image.url)) images.push(image);
			}
		} catch (error) {
			console.debug(`[Synapse] Illustrate: linked page skipped (${url}): ${redactError(error)}`);
		}
	}
	return images;
}
