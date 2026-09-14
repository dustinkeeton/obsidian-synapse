import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { detectPlatform } from './url-detector';
import { isRecord, parseJson } from './json-utils';
import { ensureFolder } from './file-utils';
import { redactError } from './redact';
import type { TimeRange } from './validation';

/** Transcript fields persisted per media URL; structurally a subset of `UrlTranscript`. */
export interface CachedTranscript {
	text: string;
	raw: string;
	source: string;
	title?: string;
	language?: string;
	videoVaultPath?: string;
	reformatted?: boolean;
	schemaId?: string;
}

export interface TranscriptCacheEntry extends CachedTranscript {
	/** Canonical media URL (see {@link canonicalMediaUrl}). */
	url: string;
	fetchedAt: number;
	lastUsedAt: number;
}

export interface TranscriptCacheOptions {
	path?: string;
	maxEntries?: number;
	/** Cap on the summed `text` + `raw` length across all entries. */
	maxChars?: number;
}

const CACHE_FOLDER = '.synapse';
const CACHE_PATH = `${CACHE_FOLDER}/transcript-cache.json`;
const CACHE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_CHARS = 4_000_000;

interface CacheFile {
	version: number;
	entries: Record<string, TranscriptCacheEntry>;
}

/** Collapse URL variants of the same media onto one key (YouTube ids, stripped share params). */
export function canonicalMediaUrl(url: string): string {
	const detected = detectPlatform(url);
	if (detected?.platform === 'youtube') {
		return `https://www.youtube.com/watch?v=${detected.videoId}`;
	}
	if (detected?.platform === 'instagram') {
		return `https://www.instagram.com/p/${detected.videoId}`;
	}
	if (detected?.platform === 'tiktok') {
		return detected.url.replace(/\/+$/, '');
	}
	return url.replace(/#.*$/, '').replace(/\/+$/, '');
}

export function transcriptCacheKey(url: string, timeRange?: TimeRange): string {
	const canonical = canonicalMediaUrl(url);
	return timeRange
		? `${canonical}#t=${timeRange.startSeconds}-${timeRange.endSeconds}`
		: canonical;
}

function isEntry(v: unknown): v is TranscriptCacheEntry {
	return (
		isRecord(v) &&
		typeof v.url === 'string' &&
		typeof v.text === 'string' &&
		typeof v.raw === 'string' &&
		typeof v.source === 'string' &&
		typeof v.fetchedAt === 'number' &&
		typeof v.lastUsedAt === 'number'
	);
}

/**
 * Vault-file transcript store keyed by canonical URL (+ time range): every
 * URL-transcription path writes through it so summarize and explicit
 * transcription never repeat a caption fetch, download, or ASR call. Reads and
 * writes never throw — a broken cache degrades to a miss.
 */
export class TranscriptCache {
	private entries: Map<string, TranscriptCacheEntry> | null = null;
	private clock = 0;
	private readonly path: string;
	private readonly maxEntries: number;
	private readonly maxChars: number;

	constructor(private readonly app: App, options: TranscriptCacheOptions = {}) {
		this.path = normalizePath(options.path ?? CACHE_PATH);
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	}

	async get(url: string, timeRange?: TimeRange): Promise<TranscriptCacheEntry | null> {
		const entries = await this.load();
		const entry = entries.get(transcriptCacheKey(url, timeRange));
		if (!entry) return null;
		entry.lastUsedAt = this.tick();
		await this.persist(entries);
		return { ...entry };
	}

	async put(url: string, transcript: CachedTranscript, timeRange?: TimeRange): Promise<void> {
		const entries = await this.load();
		const now = this.tick();
		entries.set(transcriptCacheKey(url, timeRange), {
			...transcript,
			url: canonicalMediaUrl(url),
			fetchedAt: now,
			lastUsedAt: now,
		});
		this.evict(entries);
		await this.persist(entries);
	}

	async clear(): Promise<void> {
		this.entries = new Map();
		try {
			if (await this.app.vault.adapter.exists(this.path)) {
				await this.app.vault.adapter.remove(this.path);
			}
		} catch (error) {
			console.warn('[Synapse] Could not remove transcript cache:', redactError(error));
		}
	}

	async size(): Promise<number> {
		return (await this.load()).size;
	}

	/** Strictly increasing timestamp so LRU order survives same-millisecond writes. */
	private tick(): number {
		this.clock = Math.max(Date.now(), this.clock + 1);
		return this.clock;
	}

	private async load(): Promise<Map<string, TranscriptCacheEntry>> {
		if (this.entries) return this.entries;
		const entries = new Map<string, TranscriptCacheEntry>();
		try {
			if (await this.app.vault.adapter.exists(this.path)) {
				const parsed = parseJson(await this.app.vault.adapter.read(this.path));
				const file = isRecord(parsed) && parsed.version === CACHE_VERSION && isRecord(parsed.entries)
					? (parsed as unknown as CacheFile)
					: null;
				for (const [key, value] of Object.entries(file?.entries ?? {})) {
					if (isEntry(value)) entries.set(key, value);
				}
			}
		} catch (error) {
			console.warn('[Synapse] Could not read transcript cache:', redactError(error));
		}
		this.entries = entries;
		return entries;
	}

	private evict(entries: Map<string, TranscriptCacheEntry>): void {
		const byAge = [...entries.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
		let chars = byAge.reduce((sum, [, e]) => sum + e.text.length + e.raw.length, 0);
		for (const [key, entry] of byAge) {
			if (entries.size <= this.maxEntries && chars <= this.maxChars) break;
			entries.delete(key);
			chars -= entry.text.length + entry.raw.length;
		}
	}

	private async persist(entries: Map<string, TranscriptCacheEntry>): Promise<void> {
		const file: CacheFile = { version: CACHE_VERSION, entries: Object.fromEntries(entries) };
		try {
			await ensureFolder(this.app, CACHE_FOLDER);
			await this.app.vault.adapter.write(this.path, JSON.stringify(file));
		} catch (error) {
			console.warn('[Synapse] Could not write transcript cache:', redactError(error));
		}
	}
}
