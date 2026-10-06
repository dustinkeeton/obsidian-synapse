import { requestUrl } from 'obsidian';
import { isRecord } from '../../shared';
import type { MediaCandidate, MediaProvider, MediaSearchOptions } from '../types';
import { normalizeLicense } from '../license';

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ObsidianSynapse/1.0 (https://github.com/dustinkeeton/obsidian-synapse)';
const DOWNLOAD_WIDTH = 1024;

function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function metaValue(meta: unknown, key: string): string {
	if (!isRecord(meta)) return '';
	const entry = meta[key];
	return isRecord(entry) && typeof entry.value === 'string' ? entry.value : '';
}

/** Map one Commons `query.pages` entry to a candidate; `null` when the record is unusable. */
export function parseCommonsPage(page: unknown): MediaCandidate | null {
	if (!isRecord(page) || typeof page.title !== 'string') return null;
	const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] as unknown : null;
	if (!isRecord(info) || typeof info.url !== 'string') return null;
	const mime = typeof info.mime === 'string' ? info.mime : undefined;
	if (mime && !mime.startsWith('image/')) return null;
	const licenseRaw = metaValue(info.extmetadata, 'LicenseShortName');
	const license = normalizeLicense(licenseRaw);
	if (!license) return null;
	const thumb = typeof info.thumburl === 'string' ? info.thumburl : info.url;
	const artist = stripHtml(metaValue(info.extmetadata, 'Artist')) || stripHtml(metaValue(info.extmetadata, 'Credit'));
	return {
		provider: 'wikimedia',
		title: page.title.replace(/^File:/, ''),
		fileUrl: thumb,
		thumbnailUrl: thumb,
		pageUrl: typeof info.descriptionurl === 'string' ? info.descriptionurl : `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
		license,
		licenseUrl: metaValue(info.extmetadata, 'LicenseUrl'),
		attribution: artist || 'Wikimedia Commons contributors',
		mimeType: mime,
	};
}

export class WikimediaProvider implements MediaProvider {
	readonly id = 'wikimedia' as const;

	async search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]> {
		const params = new URLSearchParams({
			action: 'query',
			format: 'json',
			generator: 'search',
			gsrsearch: query,
			gsrnamespace: '6',
			gsrlimit: String(opts.limit),
			prop: 'imageinfo',
			iiprop: 'url|mime|extmetadata',
			iiurlwidth: String(DOWNLOAD_WIDTH),
			origin: '*',
		});
		const response = await requestUrl({
			url: `${API}?${params.toString()}`,
			method: 'GET',
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			throw: false,
		});
		if (response.status >= 400) throw new Error(`Wikimedia Commons search failed (HTTP ${response.status})`);
		const json: unknown = response.json;
		if (!isRecord(json) || !isRecord(json.query) || !isRecord(json.query.pages)) return [];
		return Object.values(json.query.pages)
			.map(parseCommonsPage)
			.filter((candidate): candidate is MediaCandidate => candidate !== null)
			.slice(0, opts.limit);
	}
}
