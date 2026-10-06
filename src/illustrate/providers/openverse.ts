import { requestUrl } from 'obsidian';
import { isRecord } from '../../shared';
import type { MediaCandidate, MediaProvider, MediaSearchOptions } from '../types';
import { normalizeLicense } from '../license';

const API = 'https://api.openverse.org/v1/images/';
const USER_AGENT = 'ObsidianSynapse/1.0 (https://github.com/dustinkeeton/obsidian-synapse)';
const SEARCH_TIMEOUT_MS = 30_000;

/** Anonymous Openverse access is rate-limited, so one scan run never issues more than this many queries. */
export const OPENVERSE_MAX_QUERIES_PER_RUN = 10;

/** Map one Openverse result to a candidate; `null` when the record is unusable. */
export function parseOpenverseResult(result: unknown): MediaCandidate | null {
	if (!isRecord(result) || typeof result.url !== 'string') return null;
	const licenseCode = typeof result.license === 'string' ? result.license : '';
	const license = normalizeLicense(licenseCode);
	if (!license) return null;
	const title = typeof result.title === 'string' && result.title.trim() !== '' ? result.title.trim() : 'Untitled';
	const creator = typeof result.creator === 'string' ? result.creator.trim() : '';
	const source = typeof result.source === 'string' ? result.source : (typeof result.provider === 'string' ? result.provider : 'Openverse');
	return {
		provider: 'openverse',
		title,
		fileUrl: result.url,
		thumbnailUrl: typeof result.thumbnail === 'string' ? result.thumbnail : result.url,
		pageUrl: typeof result.foreign_landing_url === 'string' ? result.foreign_landing_url : result.url,
		license,
		licenseUrl: typeof result.license_url === 'string' ? result.license_url : '',
		attribution: creator ? `${creator} via ${source}` : source,
		mimeType: typeof result.filetype === 'string' ? `image/${result.filetype}` : undefined,
	};
}

export class OpenverseProvider implements MediaProvider {
	readonly id = 'openverse' as const;
	private queriesThisRun = 0;

	/** Call at the start of each scan run so the cap is per run, not per plugin lifetime. */
	resetRun(): void {
		this.queriesThisRun = 0;
	}

	async search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]> {
		if (this.queriesThisRun >= OPENVERSE_MAX_QUERIES_PER_RUN) return [];
		this.queriesThisRun++;
		const params = new URLSearchParams({
			q: query,
			page_size: String(opts.limit),
			license_type: 'all',
		});
		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(() => reject(new Error('Openverse search timed out')), SEARCH_TIMEOUT_MS)
		);
		const response = await Promise.race([
			requestUrl({
				url: `${API}?${params.toString()}`,
				method: 'GET',
				headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
				throw: false,
			}),
			timeout,
		]);
		if (response.status === 429) throw new Error('Openverse rate limit reached; try again later');
		if (response.status >= 400) throw new Error(`Openverse search failed (HTTP ${response.status})`);
		const json: unknown = response.json;
		if (!isRecord(json) || !Array.isArray(json.results)) return [];
		return (json.results as unknown[])
			.map(parseOpenverseResult)
			.filter((candidate): candidate is MediaCandidate => candidate !== null)
			.slice(0, opts.limit);
	}
}
