import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { WikimediaProvider, parseCommonsPage } from './wikimedia';

const page = {
	pageid: 1,
	title: 'File:Red panda.jpg',
	imageinfo: [{
		url: 'https://upload.wikimedia.org/Red_panda.jpg',
		thumburl: 'https://upload.wikimedia.org/thumb/Red_panda.jpg/1024px-Red_panda.jpg',
		descriptionurl: 'https://commons.wikimedia.org/wiki/File:Red_panda.jpg',
		mime: 'image/jpeg',
		extmetadata: {
			LicenseShortName: { value: 'CC BY-SA 4.0' },
			LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
			Artist: { value: '<a href="/wiki/User:Jane">Jane Doe</a>' },
		},
	}],
};

describe('parseCommonsPage', () => {
	it('maps a Commons page to a candidate with HTML stripped from the artist', () => {
		expect(parseCommonsPage(page)).toEqual({
			provider: 'wikimedia',
			title: 'Red panda.jpg',
			fileUrl: page.imageinfo[0].thumburl,
			thumbnailUrl: page.imageinfo[0].thumburl,
			pageUrl: page.imageinfo[0].descriptionurl,
			license: 'CC BY-SA',
			licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
			attribution: 'Jane Doe',
			mimeType: 'image/jpeg',
		});
	});

	it('drops non-image files and unrecognized licenses', () => {
		const pdf = { ...page, imageinfo: [{ ...page.imageinfo[0], mime: 'application/pdf' }] };
		expect(parseCommonsPage(pdf)).toBeNull();
		const unlicensed = { ...page, imageinfo: [{ ...page.imageinfo[0], extmetadata: {} }] };
		expect(parseCommonsPage(unlicensed)).toBeNull();
	});

	it('falls back to Credit and then a generic attribution', () => {
		const credit = { ...page, imageinfo: [{ ...page.imageinfo[0], extmetadata: { ...page.imageinfo[0].extmetadata, Artist: undefined, Credit: { value: 'Own work' } } }] };
		expect(parseCommonsPage(credit)?.attribution).toBe('Own work');
		const none = { ...page, imageinfo: [{ ...page.imageinfo[0], extmetadata: { LicenseShortName: { value: 'CC0' } } }] };
		expect(parseCommonsPage(none)?.attribution).toBe('Wikimedia Commons contributors');
	});
});

describe('WikimediaProvider.search', () => {
	beforeEach(() => vi.mocked(requestUrl).mockReset());

	it('queries the Commons API in the file namespace and returns parsed candidates', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { query: { pages: { '1': page } } } } as never);
		const results = await new WikimediaProvider().search('red panda', { limit: 3 });
		expect(results).toHaveLength(1);
		const url = vi.mocked(requestUrl).mock.calls[0][0].url;
		expect(url).toContain('commons.wikimedia.org/w/api.php');
		expect(url).toContain('gsrsearch=red+panda');
		expect(url).toContain('gsrnamespace=6');
		expect(url).toContain('gsrlimit=3');
	});

	it('returns an empty list when the API has no pages', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { batchcomplete: '' } } as never);
		expect(await new WikimediaProvider().search('nothing', { limit: 3 })).toEqual([]);
	});

	it('throws on HTTP errors', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 503, json: null } as never);
		await expect(new WikimediaProvider().search('x', { limit: 1 })).rejects.toThrow('HTTP 503');
	});
});
