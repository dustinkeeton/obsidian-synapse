import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { redactSecrets } from './redact';
import { isRecord } from './json-utils';

/** Default timeout for outbound API requests (2 minutes). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** A non-2xx upstream response; the message is already redacted. */
export class ApiRequestError extends Error {
	constructor(readonly status: number, detail: string) {
		super(`API error (${status}): ${redactSecrets(detail)}`);
		this.name = 'ApiRequestError';
	}
}

/** `requestUrl` with `throw:false` (Obsidian strips the body in throw mode), a timeout, and a redacted typed error on >= 400. */
export async function safeRequest(
	options: RequestUrlParam,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<RequestUrlResponse> {
	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('AI request timed out')), timeoutMs)
	);

	const response = await Promise.race([
		requestUrl({ ...options, throw: false }),
		timeout,
	]);
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

/** `{ error: { message } }` is the envelope OpenAI, Anthropic, and Gemini share; anything else yields `null`. */
export function extractErrorMessage(body: unknown): string | null {
	if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
		return body.error.message;
	}
	return null;
}
