import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRedditContent, isRedditUrl, extractCanonicalPostUrl } from './reddit-fetcher';

/** XML-escape a string the way Reddit's Atom feed escapes its title/content. */
function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Build one Atom `<entry>` (author name is stored Reddit-style as `/u/<name>`). */
function entry(author: string, title: string, bodyHtml: string): string {
	return (
		`<entry>` +
		`<author><name>/u/${author}</name></author>` +
		`<title>${esc(title)}</title>` +
		`<content type="html">${esc(bodyHtml)}</content>` +
		`</entry>`
	);
}

/** Build a mock Reddit post Atom feed response (post entry + comment entries). */
function mockFeed(
	post: { author?: string; title?: string; bodyHtml?: string },
	comments: Array<{ author?: string; bodyHtml: string }> = [],
	status = 200
) {
	const entries = [
		entry(post.author ?? 'op', post.title ?? '', post.bodyHtml ?? ''),
		...comments.map((c, i) => entry(c.author ?? `commenter${i}`, `c${i} on post`, c.bodyHtml)),
	];
	return { status, text: `<?xml version="1.0" encoding="UTF-8"?><feed>${entries.join('')}</feed>` };
}

const CANONICAL =
	'https://www.reddit.com/r/immich/comments/abc123/great_post/';
/** What toRssUrl(CANONICAL) produces: trailing slash stripped, `.rss?sort=top` appended. */
const CANONICAL_RSS =
	'https://www.reddit.com/r/immich/comments/abc123/great_post.rss?sort=top';

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

	it('parses a post Atom feed into formatted output', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockFeed({
				author: 'someuser',
				title: 'Great Immich tip',
				bodyHtml: '<p>Here is the body of the post.</p>',
			}) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('u/someuser: Great Immich tip');
		expect(result).toContain('Here is the body of the post.');
		expect(result).toContain(`Source: ${CANONICAL}`);
	});

	it('requests the .rss?sort=top endpoint with an Atom Accept header', async () => {
		const { requestUrl } = await import('obsidian');
		let captured: { url: string; headers?: Record<string, string> } | undefined;
		(vi.mocked(requestUrl) as any).mockImplementation(async (params: any) => {
			captured = { url: params.url, headers: params.headers };
			return mockFeed({ author: 'u', title: 't', bodyHtml: '<p>b</p>' });
		});

		await fetchRedditContent(CANONICAL, 10000);
		expect(captured?.url).toBe(CANONICAL_RSS);
		expect(captured?.headers?.['Accept']).toContain('xml');
	});

	it('includes up to the top three comments and labels them', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockFeed(
				{ author: 'op', title: 'Question', bodyHtml: '<p>body</p>' },
				[
					{ bodyHtml: '<p>first answer</p>' },
					{ bodyHtml: '<p>second answer</p>' },
					{ bodyHtml: '<p>third answer</p>' },
					{ bodyHtml: '<p>fourth answer</p>' },
				]
			) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('Comment 1: first answer');
		expect(result).toContain('Comment 2: second answer');
		expect(result).toContain('Comment 3: third answer');
		expect(result).not.toContain('fourth answer');
	});

	it('strips the "submitted by" footer from the post selftext', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			mockFeed({
				author: 'op',
				title: 'Title',
				bodyHtml:
					'<p>Real body text.</p> submitted by <a href="x">/u/op</a> ' +
					'<span><a href="y">[link]</a></span> <span><a href="z">[comments]</a></span>',
			}) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('Real body text.');
		expect(result).not.toContain('submitted by');
		expect(result).not.toContain('[comments]');
	});

	it('decodes numeric character references and double-escaped entities', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			// `I&#39;ve` survives esc() as `I&amp;#39;ve` (double-escaped); `&#32;`
			// is Reddit's numeric-space separator.
			mockFeed({
				author: 'op',
				title: 'T',
				bodyHtml: '<p>I&#39;ve&#32;done it</p>',
			}) as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain("I've done it");
		expect(result).not.toContain('&#');
	});

	it('resolves a /s/ share link to canonical, then fetches its .rss feed', async () => {
		const { requestUrl } = await import('obsidian');
		const shareUrl = 'https://www.reddit.com/r/immich/s/DaHMD1DJhv';
		const requestedUrls: string[] = [];

		(vi.mocked(requestUrl) as any).mockImplementation(async (params: any) => {
			const reqUrl = typeof params === 'string' ? params : params.url;
			requestedUrls.push(reqUrl);
			// First call: the share page HTML carrying the canonical permalink.
			if (reqUrl === shareUrl) {
				return { status: 200, text: `<link rel="canonical" href="${CANONICAL}"/>` };
			}
			// Second call: the canonical post's Atom feed.
			if (reqUrl.includes('.rss')) {
				return mockFeed({ author: 'shareuser', title: 'Resolved post', bodyHtml: '<p>Resolved body.</p>' });
			}
			throw new Error(`Unexpected URL: ${reqUrl}`);
		});

		const result = await fetchRedditContent(shareUrl, 10000);

		expect(requestedUrls[0]).toBe(shareUrl);
		expect(requestedUrls[1]).toBe(CANONICAL_RSS);
		expect(result).toContain('u/shareuser: Resolved post');
		expect(result).toContain('Resolved body.');
	});

	it('throws when a share link cannot be resolved to a post', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '<html><body>blocked</body></html>',
		} as never);

		await expect(
			fetchRedditContent('https://www.reddit.com/r/immich/s/DaHMD1DJhv', 10000)
		).rejects.toThrow('Failed to fetch Reddit post');
	});

	it('falls back to "unknown" author and empty fields when missing', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue(
			{ status: 200, text: '<?xml version="1.0"?><feed><entry></entry></feed>' } as never
		);

		const result = await fetchRedditContent(CANONICAL, 10000);
		expect(result).toContain('u/unknown');
		expect(result).toContain(`Source: ${CANONICAL}`);
	});

	it('throws `Reddit returned HTTP <status>` on a blocked/error response', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue({ status: 403, text: '<html>forbidden</html>' } as never);

		await expect(fetchRedditContent(CANONICAL, 10000))
			.rejects.toThrow('Failed to fetch Reddit post: Reddit returned HTTP 403');
	});

	it('throws when the feed has no post entry', async () => {
		const { requestUrl } = await import('obsidian');
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '<?xml version="1.0"?><feed></feed>',
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
			mockFeed({
				author: 'user',
				title: 'A very long title that should be cut off',
				bodyHtml: '<p>And a very long body that goes on and on and on.</p>',
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
