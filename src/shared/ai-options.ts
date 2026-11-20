import type { AIRequestOptions } from './ai-client';

/**
 * A public-API job refused a model call (#626): its call cap was reached, it was cancelled, or an external
 * request expired. Callers that fall back on an ordinary AI failure must rethrow this, so the job stops
 * instead of silently producing less.
 */
export class JobCallRefusedError extends Error {
	readonly name = 'JobCallRefusedError';
}

export function isJobCallRefused(error: unknown): error is JobCallRefusedError {
	return error instanceof JobCallRefusedError;
}

/** Per-call options combined left to right: callbacks all run, in order; later scalar fields win; `bypassCache` is set when any sets it. */
export function combineAIOptions(...list: (AIRequestOptions | undefined)[]): AIRequestOptions {
	const opts = list.filter((o): o is AIRequestOptions => o !== undefined);
	const combined: AIRequestOptions = Object.assign({}, ...opts) as AIRequestOptions;
	if (opts.some((o) => o.bypassCache)) combined.bypassCache = true;
	const chain = <K extends 'onCacheHit' | 'onResponse' | 'beforeCall'>(key: K): void => {
		const fns = opts.map((o) => o[key]).filter((fn): fn is NonNullable<AIRequestOptions[K]> => fn !== undefined);
		if (fns.length === 0) return;
		combined[key] = (...args: unknown[]) => {
			for (const fn of fns) (fn as (...a: unknown[]) => void)(...args);
		};
	};
	chain('onCacheHit');
	chain('onResponse');
	chain('beforeCall');
	return combined;
}
