import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRedditContent, isRedditUrl, extractCanonicalPostUrl } from './reddit-fetcher';

/** Build a mock `.json` listing response (post + optional comment). */
function mockListing(
	post: { author?: string; title?: string; selftext?: string },
	commentBody?: string
) {
	const listings: unknown[] = [
		{ data: { children: [{ data: post }] } },
	];
	if (commentBody !== undefined) {
		listings.push({ data: { children: [{ data: { body: commentBody } }] } });
	}
	return { text: JSON.stringify(listings) };
}

const CANONICAL =
	'https://www.reddit.com/r/immich/comments/abc123/great_post/';

describe('isRedditUrl', () => {
	it('recognizes reddit.com post URLs', () => {
		expect(isRedditUrl('https://www.reddit.com/r/immich/comments/abc123/title/')).toBe(true);
	});

	it('recognizes reddit.com share (/s/) URLs', () => {
		expect(isRedditUrl('https://www.reddit.com/r/immich/s/DaHMD1DJhv')).toBe(true);
	});

	it('recognizes redd.it short URLs', () => {
		expect(isRedditUrl('https://redd.it/abc123')).toBe(true);
	});

	it('rejects non-Reddit URLs', () => {
		expect(isRedditUrl('https://example.com/article')).toBe(false);
		expect(isRedditUrl('https://twitter.com/user/status/123')).toBe(false);
		expect(isRedditUrl('')).toBe(false);
	});
});

describe('extractCanonicalPostUrl', () => {
	it('reads the canonical link tag', () => {
		const html = `<head><link rel="canonical" href="${CANONICAL}"/></head>`;
		expect(extractCanonicalPostUrl(html)).toBe(CANONICAL);
	});

	it('falls back to og:url meta tag', () => {
		const html = `<meta property="og:url" content="${CANONICAL}"/>`;
		expect(extractCanonicalPostUrl(html)).toBe(CANONICAL);
	});

	it('falls back to a bare permalink in markup', () => {
		const html = `<a href="${CANONICAL}">link</a>`;
		expect(extractCanonicalPostUrl(html)).toBe(CANONICAL);
	});

	it('ignores canonical links that are not post permalinks', () => {
		const html = '<link rel="canonical" href="https://www.reddit.com/r/immich/"/>';
		expect(extractCanonicalPostUrl(html)).toBe('');
	});

	it('returns empty string when nothing matches', () => {
		expect(extractCanonicalPostUrl('<html><body>nothing</body></html>')).toBe('');
	});
});

describe('fetchRedditContent', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('parses a .json listing into formatted output', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockListing({
				author: 'someuser',
				title: 'Great Immich tip',
				selftext: 'Here is the body of the post.',
			}) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('u/someuser');
		expect(result).toContain('Great Immich tip');
		expect(result).toContain('Here is the body of the post.');
		expect(result).toContain(`Source: ${CANONICAL}`);
	});

	it('includes the top comment when present', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockListing(
				{ author: 'op', title: 'Question', selftext: 'body' },
				'This is the top answer.'
			) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('Top comment: This is the top answer.');
	});

	it('resolves a /s/ share link to the canonical post before fetching JSON', async () => {
		const { requestUrl } = await import('obsidian');
		const shareUrl = 'https://www.reddit.com/r/immich/s/DaHMD1DJhv';
		const requestedUrls: string[] = [];

		(vi.mocked(requestUrl) as any).mockImplementation(async (params: any) => {
			const reqUrl = typeof params === 'string' ? params : params.url;
			requestedUrls.push(reqUrl);
			// First call: the share page HTML carrying the canonical permalink.
			if (reqUrl === shareUrl) {
				return { text: `<link rel="canonical" href="${CANONICAL}"/>` };
			}
			// Second call: the canonical post's .json listing.
			if (reqUrl.endsWith('.json')) {
				return mockListing({
					author: 'shareuser',
					title: 'Resolved post',
					selftext: 'Resolved body.',
				});
			}
			throw new Error(`Unexpected URL: ${reqUrl}`);
		});

		const result = await fetchRedditContent(shareUrl, 10000);

		// The share page is fetched first, then the canonical .json.
		expect(requestedUrls[0]).toBe(shareUrl);
		expect(requestedUrls[1]).toBe(`${CANONICAL.replace(/\/+$/, '')}.json`);
		expect(result).toContain('u/shareuser');
		expect(result).toContain('Resolved post');
	});

	it('throws when a share link cannot be resolved to a post', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue({
			text: '<html><body>blocked</body></html>',
		} as never);

		await expect(
			fetchRedditContent('https://www.reddit.com/r/immich/s/DaHMD1DJhv', 10000)
		).rejects.toThrow('Failed to fetch Reddit post');
	});

	it('falls back to "unknown" author and empty fields when missing', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(mockListing({}) as never);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('u/unknown');
		expect(result).toContain(`Source: ${CANONICAL}`);
	});

	it('throws when the listing has no post data', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue({
			text: JSON.stringify([{ data: { children: [] } }]),
		} as never);

		await expect(fetchRedditContent(CANONICAL, 10000))
			.rejects.toThrow('Failed to fetch Reddit post');
	});

	it('throws a descriptive error on network failure', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockRejectedValue(new Error('Network error'));

		await expect(fetchRedditContent(CANONICAL, 10000))
			.rejects.toThrow('Failed to fetch Reddit post: Network error');
	});

	it('truncates to maxLength', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockListing({
				author: 'user',
				title: 'A very long title that should be cut off',
				selftext: 'And a very long body that goes on and on and on.',
			}) as never
		);

		const result = await fetchRedditContent(CANONICAL, 20);
		expect(result.length).toBeLessThanOrEqual(20);
	});

	it('calls sanitizeUrl on input (rejects non-HTTP URLs)', async () => {
		await expect(fetchRedditContent('ftp://evil.com/r/x/comments/1/', 10000))
			.rejects.toThrow();
	});
});
