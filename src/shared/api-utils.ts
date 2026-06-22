import { Notice } from 'obsidian';
import { redactSecrets } from './redact';

export type NetworkErrorKind = 'connection-refused' | 'dns' | 'timeout' | 'offline' | null;

/** Classify an error/message into a network failure category (Electron net::, Node errno, common phrasings). */
export function classifyNetworkError(error: unknown): NetworkErrorKind {
	const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
	if (/econnrefused|err_connection_refused|connection refused/.test(msg)) return 'connection-refused';
	if (/enotfound|err_name_not_resolved|getaddrinfo|eai_again/.test(msg)) return 'dns';
	if (/etimedout|err_(connection_)?timed_out|timed out|timeout/.test(msg)) return 'timeout';
	if (/enetunreach|err_internet_disconnected|network is unreachable|offline/.test(msg)) return 'offline';
	return null;
}

export function isTransientNetworkError(error: unknown): boolean {
	return classifyNetworkError(error) !== null;
}

/** User-facing explanation for a network failure reaching `resource`. Null for non-network errors. */
export function describeNetworkError(error: unknown, resource: string): string | null {
	switch (classifyNetworkError(error)) {
		case 'connection-refused': return `Could not connect to ${resource} (connection refused). You may be offline, or a firewall/VPN/proxy is blocking the request.`;
		case 'dns':                return `Could not resolve the address for ${resource} (DNS lookup failed). Check your internet connection.`;
		case 'timeout':            return `Connection to ${resource} timed out — the service may be slow or unreachable.`;
		case 'offline':            return `No network connection while reaching ${resource}. Check that you are online.`;
		default:                   return null;
	}
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries = 3,
	delayMs = 1000,
	shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			if (attempt >= maxRetries - 1 || !shouldRetry(error)) break; // stop early on last attempt or non-retryable error
			await sleep(delayMs * Math.pow(2, attempt));
		}
	}
	throw lastError;
}

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

/**
 * Number of times {@link filterYielding} hands control back to the event loop
 * over a single pass. Bounds the added latency (each yield is one ~4ms
 * macrotask) to a few hundred ms even for very large vaults, while still giving
 * a running progress toast enough paints to animate smoothly (#354).
 */
const YIELD_FRAMES = 60;

/**
 * Filter `items` with a synchronous `keep` predicate, yielding to the event loop
 * periodically so a running operation toast can paint and animate (#354).
 *
 * A tight synchronous scan (e.g. enrichment/organize collecting eligible notes)
 * blocks the main thread from start to finish, so the toast's Cancel-button
 * progress border — which animates on the main thread — never renders before the
 * scan reaches `finish()`. Interleaving `await sleep(0)` lets the browser paint
 * between batches. Yields are capped at ~{@link YIELD_FRAMES} so large vaults add
 * only a few hundred ms regardless of size.
 */
export async function filterYielding<T>(
	items: T[],
	keep: (item: T) => boolean
): Promise<T[]> {
	const result: T[] = [];
	const yieldEvery = Math.max(1, Math.ceil(items.length / YIELD_FRAMES));
	for (let i = 0; i < items.length; i++) {
		if (keep(items[i])) result.push(items[i]);
		if ((i + 1) % yieldEvery === 0) await sleep(0);
	}
	return result;
}

export function notifyError(context: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	// Redact potential API keys/tokens before showing the error to the user or
	// logging it. Uses the shared canonical redactor (./redact) so this stays in
	// sync with the AI client — an earlier inline copy here omitted the Google
	// `AIza…` pattern and would have leaked Gemini keys.
	const redacted = redactSecrets(message);
	new Notice(`Synapse: ${context} - ${redacted}`);
	console.error(`[Synapse] ${context}:`, redacted);
}
