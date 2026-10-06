import { requestUrl } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { sanitizeUrl } from '../shared';
import type { MediaCandidate } from './types';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
};

/** Derive `<slug>.<ext>` for the attachment from the candidate title, MIME type, and URL. */
export function attachmentFileName(candidate: MediaCandidate): string {
	const slug = candidate.title
		.replace(/\.[a-z0-9]{2,5}$/i, '')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase()
		.slice(0, 60) || 'illustration';
	const fromMime = candidate.mimeType ? EXT_BY_MIME[candidate.mimeType] : undefined;
	const fromUrl = candidate.fileUrl.match(/\.(jpe?g|png|gif|webp|svg)(?:[?#].*)?$/i)?.[1]?.toLowerCase();
	const ext = fromMime ?? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) ?? 'jpg';
	return `${slug}.${ext}`;
}

export class AssetWriter {
	constructor(private app: App) {}

	/** Download the candidate into the vault's attachment folder for `note`; returns the created file. */
	async download(candidate: MediaCandidate, note: TFile): Promise<TFile> {
		const url = sanitizeUrl(candidate.fileUrl);
		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(() => reject(new Error('Image download timed out')), DOWNLOAD_TIMEOUT_MS)
		);
		const response = await Promise.race([
			requestUrl({ url, method: 'GET', throw: false }),
			timeout,
		]);
		if (response.status >= 400) throw new Error(`Image download failed (HTTP ${response.status})`);
		const data = response.arrayBuffer;
		if (!data || data.byteLength === 0) throw new Error('Image download returned no data');
		if (data.byteLength > MAX_ASSET_BYTES) throw new Error('Image exceeds the 15 MB download limit');
		const path = await this.app.fileManager.getAvailablePathForAttachment(attachmentFileName(candidate), note.path);
		return this.app.vault.createBinary(path, data);
	}
}
