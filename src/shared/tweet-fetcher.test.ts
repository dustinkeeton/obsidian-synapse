import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fetchTweetContent, isTwitterUrl } from './tweet-fetcher';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';

/**
 * The `requestUrl` mock viewed with a precise async signature. The shared mock is
 * loosely typed (`vi.fn()`), so `mockImplementation(async …)` would otherwise be
 * seen as a void-returning callback and trip no-misused-promises. The view also
 * lets stubs return partial responses (only the fields the fetcher reads).
 */
const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam | string) => Promise<Partial<RequestUrlResponse>>
>;

function mockOEmbedResponse(authorName: string, tweetHtml: string): RequestUrlResponse {
	return {
		status: 200,
		headers: {},
		json: null,
		text: JSON.stringify({
			html: tweetHtml,
			author_name: authorName,
		}),
	};
}

describe('isTwitterUrl', () => {
	it('recognizes twitter.com status URLs', () => {
		expect(isTwitterUrl('https://twitter.com/user/status/123456')).toBe(true);
	});

	it('recognizes x.com status URLs', () => {
		expect(isTwitterUrl('https://x.com/user/status/123456')).toBe(true);
	});

	it('recognizes mobile twitter URLs', () => {
		expect(isTwitterUrl('https://mobile.twitter.com/user/status/123456')).toBe(true);
	});

	it('rejects non-Twitter URLs', () => {
		expect(isTwitterUrl('https://example.com/article')).toBe(false);
		expect(isTwitterUrl('https://youtube.com/watch?v=abc')).toBe(false);
		expect(isTwitterUrl('')).toBe(false);
	});
});

describe('fetchTweetContent', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('succeeds on first try via oEmbed', async () => {
		mockRequestUrl.mockResolvedValue(
			mockOEmbedResponse(
				'testuser',
				'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Hello world!</p></blockquote>'
			)
		);

		const result = await fetchTweetContent('https://twitter.com/testuser/status/123', 10000);
		expect(result).toContain('@testuser');
		expect(result).toContain('Hello world!');
		expect(result).toContain('Source: https://twitter.com/testuser/status/123');
	});

	it('falls back to fxtwitter when oEmbed returns 503', async () => {
		const error503 = new Error('Request failed: 503');

		// oEmbed fails on both retry attempts (withRetry makes 2 attempts)
		let callCount = 0;
		mockRequestUrl.mockImplementation(async (params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('publish.twitter.com')) {
				callCount++;
				throw error503;
			}
			if (url.includes('fxtwitter.com')) {
				return mockOEmbedResponse(
					'testuser',
					'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Fallback tweet</p></blockquote>'
				);
			}
			throw new Error('Unexpected URL');
		});

		const result = await fetchTweetContent('https://x.com/user/status/456', 10000);
		expect(result).toContain('Fallback tweet');
		// oEmbed should have been tried with retries (2 attempts)
		expect(callCount).toBe(2);
	});

	it('falls back to vxtwitter when oEmbed and fxtwitter both fail', async () => {
		const error503 = new Error('Request failed: 503');

		mockRequestUrl.mockImplementation(async (params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('publish.twitter.com') || url.includes('fxtwitter.com/oembed')) {
				throw error503;
			}
			if (url.includes('vxtwitter.com')) {
				return {
					text: JSON.stringify({
						user_name: 'vxuser',
						text: 'VX tweet content',
					}),
				};
			}
			throw new Error('Unexpected URL');
		});

		const result = await fetchTweetContent('https://x.com/user/status/789', 10000);
		expect(result).toContain('@vxuser');
		expect(result).toContain('VX tweet content');
	});

	it('throws when all endpoints fail', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Network error'));

		await expect(fetchTweetContent('https://x.com/user/status/000', 10000))
			.rejects.toThrow('Failed to fetch tweet from all sources');
	});

	it('retries oEmbed once before falling through', async () => {
		let oembedCalls = 0;

		mockRequestUrl.mockImplementation(async (params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('publish.twitter.com')) {
				oembedCalls++;
				if (oembedCalls === 1) {
					throw new Error('503');
				}
				return mockOEmbedResponse(
					'retryuser',
					'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Retry success</p></blockquote>'
				);
			}
			throw new Error('Unexpected URL');
		});

		const result = await fetchTweetContent('https://twitter.com/user/status/111', 10000);
		expect(result).toContain('Retry success');
		expect(oembedCalls).toBe(2);
	});

	it('truncates to maxLength', async () => {
		mockRequestUrl.mockResolvedValue(
			mockOEmbedResponse(
				'user',
				'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">A very long tweet content here</p></blockquote>'
			)
		);

		const result = await fetchTweetContent('https://x.com/user/status/999', 20);
		expect(result.length).toBeLessThanOrEqual(20);
	});

	it('calls sanitizeUrl on input', async () => {
		mockRequestUrl.mockResolvedValue(
			mockOEmbedResponse(
				'user',
				'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">test</p></blockquote>'
			)
		);

		// sanitizeUrl rejects non-HTTP URLs
		await expect(fetchTweetContent('ftp://evil.com/status/123', 10000))
			.rejects.toThrow();
	});

	it('handles HTML entities in tweet text', async () => {
		mockRequestUrl.mockResolvedValue(
			mockOEmbedResponse(
				'user',
				'<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Tom &amp; Jerry &lt;3</p></blockquote>'
			)
		);

		const result = await fetchTweetContent('https://x.com/user/status/456', 10000);
		expect(result).toContain('Tom & Jerry <3');
	});
});
