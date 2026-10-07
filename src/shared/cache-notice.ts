import type { DecisionRequestOptions } from './decision-client';

/** Which caches served any part of one result (#527), and whether the System 1 lane decided it (#558). */
export interface CacheUse {
	transcript?: boolean;
	ai?: boolean;
	systemOne?: boolean;
}

const REFRESH_TOGGLE = '"Fetch a fresh transcript" in Transcribe media';

export function usedCache(use: CacheUse): boolean {
	return use.transcript === true || use.ai === true;
}

function usedSystemOne(use: CacheUse): boolean {
	return use.systemOne === true;
}

function reportable(use: CacheUse): boolean {
	return usedCache(use) || usedSystemOne(use);
}

export function mergeCacheUse(uses: CacheUse[]): CacheUse {
	return {
		transcript: uses.some((u) => u.transcript === true),
		ai: uses.some((u) => u.ai === true),
		systemOne: uses.some((u) => u.systemOne === true),
	};
}

/** Cache use of a routed URL transcript: `cached` = transcript store hit, `aiCached` = replayed post-processing. */
export function transcriptCacheUse(result: { cached?: boolean; aiCached?: boolean }): CacheUse {
	return { transcript: result.cached === true, ai: result.aiCached === true };
}

/** Request options that record a response-cache replay and a System 1 decision on `use`. */
export function trackAiCache(use: CacheUse): DecisionRequestOptions {
	return {
		onCacheHit: () => { use.ai = true; },
		onSystemOne: () => { use.systemOne = true; },
	};
}

function cacheNote(use: CacheUse): string | null {
	if (use.transcript && use.ai) {
		return `used a cached transcript and a cached AI response (${REFRESH_TOGGLE} replaces the transcript)`;
	}
	if (use.transcript) return `used a cached transcript (${REFRESH_TOGGLE} replaces it)`;
	if (use.ai) return 'used a cached AI response';
	return null;
}

const LANE_NOTE = 'decided by the System 1 lane';

function singleNote(use: CacheUse): string | null {
	const parts = [cacheNote(use), usedSystemOne(use) ? LANE_NOTE : null].filter((p): p is string => p !== null);
	return parts.length > 0 ? parts.join('; ') : null;
}

function plural(unit: string): string {
	return unit.endsWith('y') ? `${unit.slice(0, -1)}ies` : `${unit}s`;
}

/**
 * Finish message for an operation that produced one result per entry of `items`; unchanged when no
 * cache or System 1 decision was used. `unit` (singular) names what each item is in the aggregate
 * line, so the count is never read against a different noun in `message`.
 */
export function withCacheReport(message: string, items: CacheUse[], unit?: string): string {
	const hits = items.filter(reportable);
	if (hits.length === 0) return message;
	if (items.length === 1) {
		const note = singleNote(hits[0]);
		return note ? `${message} — ${note}` : message;
	}
	const noun = unit ? `${plural(unit)} ` : '';
	const notes: string[] = [];
	const cacheHits = items.filter(usedCache).length;
	if (cacheHits > 0) notes.push(`${cacheHits} of ${items.length} ${noun}served from cache`);
	const laneHits = items.filter(usedSystemOne).length;
	if (laneHits > 0) notes.push(`${laneHits} of ${items.length} ${noun}${LANE_NOTE}`);
	return `${message} — ${notes.join('; ')}`;
}
