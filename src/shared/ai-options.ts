import type { AIRequestOptions } from './ai-client';

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
