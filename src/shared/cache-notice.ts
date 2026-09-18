import type { AIRequestOptions } from './ai-client';

/** Which caches served any part of one result (#527). */
export interface CacheUse {
	transcript?: boolean;
	ai?: boolean;
}

const REFRESH_TOGGLE = '"Fetch a fresh transcript" in Transcribe media';

export function usedCache(use: CacheUse): boolean {
	return use.transcript === true || use.ai === true;
}

export function mergeCacheUse(uses: CacheUse[]): CacheUse {
	return {
		transcript: uses.some((u) => u.transcript === true),
		ai: uses.some((u) => u.ai === true),
	};
}

/** Cache use of a routed URL transcript: `cached` = transcript store hit, `aiCached` = replayed post-processing. */
export function transcriptCacheUse(result: { cached?: boolean; aiCached?: boolean }): CacheUse {
	return { transcript: result.cached === true, ai: result.aiCached === true };
}

/** AI request options that record a response-cache replay on `use`. */
export function trackAiCache(use: CacheUse): AIRequestOptions {
	return { onCacheHit: () => { use.ai = true; } };
}

function cacheNote(use: CacheUse): string | null {
	if (use.transcript && use.ai) {
		return `used a cached transcript and a cached AI response (${REFRESH_TOGGLE} replaces the transcript)`;
	}
	if (use.transcript) return `used a cached transcript (${REFRESH_TOGGLE} replaces it)`;
	if (use.ai) return 'used a cached AI response';
	return null;
}

function plural(unit: string): string {
	return unit.endsWith('y') ? `${unit.slice(0, -1)}ies` : `${unit}s`;
}

/**
 * Finish message for an operation that produced one result per entry of `items`; unchanged when no
 * cache was used. `unit` (singular) names what each item is in the aggregate line, so the count is
 * never read against a different noun in `message`.
 */
export function withCacheReport(message: string, items: CacheUse[], unit?: string): string {
	const hits = items.filter(usedCache);
	if (hits.length === 0) return message;
	const note = items.length === 1
		? cacheNote(hits[0])
		: `${hits.length} of ${items.length} ${unit ? `${plural(unit)} ` : ''}served from cache`;
	return `${message} — ${note}`;
}
