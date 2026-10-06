import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { OpenverseProvider, parseOpenverseResult, OPENVERSE_MAX_QUERIES_PER_RUN } from './openverse';

const result = {
	id: 'abc',
	title: 'Golden Gate',
	url: 'https://live.staticflickr.com/gg.jpg',
	thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/',
	creator: 'Jane',
	license: 'by',
	license_version: '2.0',
	license_url: 'https://creativecommons.org/licenses/by/2.0/',
	foreign_landing_url: 'https://www.flickr.com/photos/jane/1',
	source: 'flickr',
	filetype: 'jpg',
};

describe('parseOpenverseResult', () => {
	it('maps a result to a candidate', () => {
		expect(parseOpenverseResult(result)).toEqual({
			provider: 'openverse',
			title: 'Golden Gate',
			fileUrl: result.url,
			thumbnailUrl: result.thumbnail,
			pageUrl: result.foreign_landing_url,
			license: 'CC BY',
			licenseUrl: result.license_url,
			attribution: 'Jane via flickr',
			mimeType: 'image/jpg',
		});
	});

	it('drops results without a URL or with an unknown license', () => {
		expect(parseOpenverseResult({ ...result, url: undefined })).toBeNull();
		expect(parseOpenverseResult({ ...result, license: 'proprietary' })).toBeNull();
	});
});

describe('OpenverseProvider.search', () => {
	beforeEach(() => vi.mocked(requestUrl).mockReset());

	it('queries the images endpoint and returns parsed candidates', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { results: [result] } } as never);
		const results = await new OpenverseProvider().search('golden gate', { limit: 2 });
		expect(results).toHaveLength(1);
		const param = vi.mocked(requestUrl).mock.calls[0][0];
		const url = typeof param === 'string' ? param : param.url;
		expect(url).toContain('api.openverse.org/v1/images/?');
		expect(url).toContain('q=golden+gate');
		expect(url).toContain('page_size=2');
	});

	it('surfaces a rate-limit response as a clear error', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 429, json: null } as never);
		await expect(new OpenverseProvider().search('x', { limit: 1 })).rejects.toThrow('rate limit');
	});

	it('stops issuing requests after the per-run cap until reset', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { results: [] } } as never);
		const provider = new OpenverseProvider();
		for (let i = 0; i < OPENVERSE_MAX_QUERIES_PER_RUN + 2; i++) await provider.search('q', { limit: 1 });
		expect(requestUrl).toHaveBeenCalledTimes(OPENVERSE_MAX_QUERIES_PER_RUN);
		provider.resetRun();
		await provider.search('q', { limit: 1 });
		expect(requestUrl).toHaveBeenCalledTimes(OPENVERSE_MAX_QUERIES_PER_RUN + 1);
	});
});
