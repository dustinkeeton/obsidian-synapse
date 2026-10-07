import { describe, it, expect } from 'vitest';
import { mergeCacheUse, trackAiCache, transcriptCacheUse, usedCache, withCacheReport } from './cache-notice';
import type { CacheUse } from './cache-notice';

describe('withCacheReport', () => {
	it('returns the message unchanged when no cache was used', () => {
		expect(withCacheReport('Note tidied', [{}])).toBe('Note tidied');
		expect(withCacheReport('Note tidied', [])).toBe('Note tidied');
		expect(withCacheReport('Tidied 3 notes', [{}, { ai: false }, { transcript: false }])).toBe('Tidied 3 notes');
	});

	it('names a cached transcript and points at the refresh toggle', () => {
		expect(withCacheReport('Transcript added', [{ transcript: true }])).toBe(
			'Transcript added — used a cached transcript ("Fetch a fresh transcript" in Transcribe media replaces it)'
		);
	});

	it('names a cached AI response without a refresh hint', () => {
		expect(withCacheReport('Note tidied', [{ ai: true }])).toBe('Note tidied — used a cached AI response');
	});

	it('names both caches for a single result', () => {
		expect(withCacheReport('Done', [{ transcript: true, ai: true }])).toBe(
			'Done — used a cached transcript and a cached AI response ("Fetch a fresh transcript" in Transcribe media replaces the transcript)'
		);
	});

	it('aggregates several results into one line', () => {
		const items: CacheUse[] = [{ ai: true }, {}, { transcript: true }, {}, { transcript: true, ai: true }, {}, {}, {}];
		expect(withCacheReport('Tidied 8 notes', items)).toBe('Tidied 8 notes — 3 of 8 served from cache');
	});

	it('names the unit of the aggregate count', () => {
		const items: CacheUse[] = [{ ai: true }, {}, { transcript: true }];
		expect(withCacheReport('2 proposals', items, 'note')).toBe('2 proposals — 2 of 3 notes served from cache');
		expect(withCacheReport('Done -- 3 inline', items, 'summary')).toBe('Done -- 3 inline — 2 of 3 summaries served from cache');
		expect(withCacheReport('Note tidied', [{ ai: true }], 'note')).toBe('Note tidied — used a cached AI response');
	});
});

describe('cache use helpers', () => {
	it('usedCache is true for either cache', () => {
		expect(usedCache({})).toBe(false);
		expect(usedCache({ ai: true })).toBe(true);
		expect(usedCache({ transcript: true })).toBe(true);
	});

	it('mergeCacheUse ORs each cache across uses', () => {
		expect(mergeCacheUse([{ ai: true }, { transcript: true }, {}])).toEqual({ transcript: true, ai: true, systemOne: false });
		expect(mergeCacheUse([{}, {}])).toEqual({ transcript: false, ai: false, systemOne: false });
	});

	it('transcriptCacheUse maps the routed transcript flags', () => {
		expect(transcriptCacheUse({ cached: true })).toEqual({ transcript: true, ai: false });
		expect(transcriptCacheUse({ aiCached: true })).toEqual({ transcript: false, ai: true });
		expect(transcriptCacheUse({})).toEqual({ transcript: false, ai: false });
	});

	it('trackAiCache records a replay on the use', () => {
		const use: CacheUse = {};
		const opts = trackAiCache(use);
		expect(use.ai).toBeUndefined();
		opts.onCacheHit?.();
		expect(use.ai).toBe(true);
	});
});

describe('System 1 lane attribution (#558)', () => {
	it('trackAiCache flips systemOne when the lane reports a decision', () => {
		const use: CacheUse = {};
		const opts = trackAiCache(use);
		opts.onSystemOne?.();
		expect(use).toEqual({ systemOne: true });
		expect(usedCache(use)).toBe(false);
	});

	it('names the lane for a single result', () => {
		expect(withCacheReport('Enrichment proposal created', [{ systemOne: true }])).toBe(
			'Enrichment proposal created — decided by the System 1 lane'
		);
	});

	it('names both a cache hit and the lane for a single result', () => {
		expect(withCacheReport('Done', [{ ai: true, systemOne: true }])).toBe(
			'Done — used a cached AI response; decided by the System 1 lane'
		);
	});

	it('aggregates cache hits and lane decisions separately', () => {
		const items: CacheUse[] = [{ systemOne: true }, { ai: true, systemOne: true }, {}, { ai: true }];
		expect(withCacheReport('Generated 4 proposals', items, 'note')).toBe(
			'Generated 4 proposals — 2 of 4 notes served from cache; 2 of 4 notes decided by the System 1 lane'
		);
		expect(withCacheReport('Scan complete', [{ systemOne: true }, {}], 'note')).toBe(
			'Scan complete — 1 of 2 notes decided by the System 1 lane'
		);
	});

	it('mergeCacheUse folds the lane flag', () => {
		expect(mergeCacheUse([{}, { systemOne: true }])).toEqual({ transcript: false, ai: false, systemOne: true });
	});
});
