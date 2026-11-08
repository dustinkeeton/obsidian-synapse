import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { redactSecrets } from './redact';
import { isRecord } from './json-utils';

/** Default timeout for outbound API requests (2 minutes). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Backoff before each retry of a dropped connection; its length bounds the retries. */
export const NETWORK_RETRY_DELAYS_MS = [1_000, 3_000];

/** A non-2xx upstream response; the message is already redacted. */
export class ApiRequestError extends Error {
	constructor(readonly status: number, detail: string) {
		super(`API error (${status}): ${redactSecrets(detail)}`);
		this.name = 'ApiRequestError';
	}
}

/** The request outlived its timeout. */
export class RequestTimeoutError extends Error {
	constructor() {
		super('AI request timed out');
		this.name = 'RequestTimeoutError';
	}
}

/**
 * `requestUrl` with `throw:false` (Obsidian strips the body in throw mode), a timeout, and a redacted typed error on >= 400.
 * A transport failure (the connection dropped, e.g. iOS suspending the app) is retried after the app is foregrounded again;
 * a timeout is retried only when the app was backgrounded during the attempt. HTTP errors are never retried here.
 */
export async function safeRequest(
	options: RequestUrlParam,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<RequestUrlResponse> {
	for (let attempt = 0; ; attempt++) {
		const background = watchBackgrounding();
		let response: RequestUrlResponse;
		try {
			response = await requestWithTimeout(options, timeoutMs);
		} catch (error) {
			const retryable = !(error instanceof RequestTimeoutError) || background.happened();
			if (!retryable || attempt >= NETWORK_RETRY_DELAYS_MS.length) throw error;
			await waitForForeground();
			await sleep(NETWORK_RETRY_DELAYS_MS[attempt]);
			continue;
		} finally {
			background.stop();
		}
		if (response.status >= 400) {
			let detail: string;
			try {
				const body: unknown = response.json;
				detail = extractErrorMessage(body) ?? JSON.stringify(body);
			} catch {
				detail = response.text || `status ${response.status}`;
			}
			throw new ApiRequestError(response.status, detail);
		}
		return response;
	}
}

async function requestWithTimeout(options: RequestUrlParam, timeoutMs: number): Promise<RequestUrlResponse> {
	let timer: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new RequestTimeoutError()), timeoutMs);
	});
	try {
		return await Promise.race([requestUrl({ ...options, throw: false }), timeout]);
	} finally {
		window.clearTimeout(timer);
	}
}

function currentDocument(): Document | undefined {
	return typeof activeDocument === 'undefined' ? undefined : activeDocument;
}

function isHidden(): boolean {
	return currentDocument()?.visibilityState === 'hidden';
}

function watchBackgrounding(): { happened: () => boolean; stop: () => void } {
	const doc = currentDocument();
	let hidden = isHidden();
	const onChange = () => { if (isHidden()) hidden = true; };
	doc?.addEventListener('visibilitychange', onChange);
	return {
		happened: () => hidden || isHidden(),
		stop: () => doc?.removeEventListener('visibilitychange', onChange),
	};
}

function waitForForeground(): Promise<void> {
	const doc = currentDocument();
	if (!doc || !isHidden()) return Promise.resolve();
	return new Promise((resolve) => {
		const onChange = () => {
			if (isHidden()) return;
			doc.removeEventListener('visibilitychange', onChange);
			resolve();
		};
		doc.addEventListener('visibilitychange', onChange);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** `{ error: { message } }` is the envelope OpenAI, Anthropic, and Gemini share; anything else yields `null`. */
export function extractErrorMessage(body: unknown): string | null {
	if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
		return body.error.message;
	}
	return null;
}
