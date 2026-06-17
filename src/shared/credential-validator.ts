// Live credential validation (#335). Makes a single minimal authenticated probe
// (see PROVIDER_METADATA.buildProbe) and reports whether the key works, with a
// REDACTED reason. All verifiable behavior lives here — NOT in a settings-UI
// callback — because the Obsidian test mock no-ops `Setting.addText`, so the
// only way to unit-test validation is to keep it in a pure module.

import { requestUrl } from 'obsidian';
import { isRecord } from './json-utils';
import { redactSecrets } from './redact';
import { describeNetworkError } from './api-utils';
import { PROVIDER_METADATA } from './provider-metadata';
import type { CredentialProvider } from './provider-metadata';

/**
 * Probe timeout. Much shorter than the AI client's 120s — a "Test" click should
 * feel snappy and a hung probe should fail fast rather than freeze the button.
 */
const VALIDATION_TIMEOUT_MS = 10_000;

/** Maximum length of an upstream error detail folded into a chip message. */
const MAX_DETAIL_LEN = 200;

export type ValidationStatus = 'valid' | 'invalid' | 'error' | 'skipped';

export interface ValidationResult {
	status: ValidationStatus;
	provider: CredentialProvider;
	/** User-ready, already-redacted message for the status chip. */
	message: string;
}

export interface ValidateOptions {
	/** Ollama only — the configured server endpoint. */
	endpoint?: string;
	/** Override the probe timeout (tests). */
	timeoutMs?: number;
}

/**
 * Validate a credential by firing the provider's minimal probe.
 *
 * Status mapping:
 *  - 2xx                    → `valid`   ("Connected to …" / "… is reachable")
 *  - 401 / 403              → `invalid` ("Invalid key — <redacted reason>")
 *  - 429                    → `error`   (rate-limited; the key may still be valid)
 *  - other 4xx/5xx          → `error`   ("Couldn’t verify (HTTP <status>): …")
 *  - network failure/timeout→ `error`   (via {@link describeNetworkError})
 *  - empty key / bad endpoint → `skipped` (no request made)
 *
 * Never throws — the result is always a {@link ValidationResult}. Every message
 * that can contain upstream text is passed through {@link redactSecrets}, so a
 * key echoed back in an error body (e.g. Gemini's "API key not valid: AIza…")
 * cannot leak to the chip. The probe is one-shot (no retry) so a wrong key
 * reports immediately.
 */
export async function validateCredentials(
	provider: CredentialProvider,
	key: string,
	opts: ValidateOptions = {},
): Promise<ValidationResult> {
	const meta = PROVIDER_METADATA[provider];
	const probe = meta.buildProbe({ key, endpoint: opts.endpoint });
	if (!probe) {
		return {
			status: 'skipped',
			provider,
			message: meta.requiresKey
				? 'Enter a key first.'
				: 'Enter a valid endpoint URL first (HTTPS required off-localhost).',
		};
	}

	const timeoutMs = opts.timeoutMs ?? VALIDATION_TIMEOUT_MS;
	try {
		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(
				() => reject(new Error(`${meta.label} validation timed out`)),
				timeoutMs,
			),
		);
		console.log('[synapse335] before requestUrl', probe.method, probe.url);
		const response = await Promise.race([
			requestUrl({
				url: probe.url,
				method: probe.method,
				headers: probe.headers,
				// Don't throw — Obsidian strips the body on error, and we need the
				// status code + body to tell "invalid key" apart from other failures.
				throw: false,
			}),
			timeout,
		]);
		console.log('[synapse335] after requestUrl, status =', response.status);

		const status = response.status;
		if (status >= 200 && status < 300) {
			console.log('[synapse335] valid path — returning');
			return {
				status: 'valid',
				provider,
				message: meta.requiresKey
					? `Connected to ${meta.label}`
					: `${meta.label} is reachable`,
			};
		}

		// Pull a redacted detail out of the (untrusted, any-typed) error body.
		console.log('[synapse335] reading error body, status =', status);
		let detail = '';
		try {
			const body: unknown = response.json;
			detail = redactSecrets(extractErrorDetail(body, response.text));
		} catch {
			detail = '';
		}
		console.log('[synapse335] error body read, detail length =', detail.length);

		if (status === 401 || status === 403) {
			return {
				status: 'invalid',
				provider,
				message: detail ? `Invalid key — ${detail}` : 'Invalid key',
			};
		}
		if (status === 429) {
			return {
				status: 'error',
				provider,
				message: 'Rate limited — the key may be valid; try again shortly.',
			};
		}
		return {
			status: 'error',
			provider,
			message: `Couldn’t verify (HTTP ${status})${detail ? `: ${detail}` : ''}`,
		};
	} catch (err) {
		console.log('[synapse335] catch:', err instanceof Error ? err.message : String(err));
		// describeNetworkError handles connection-refused/DNS/timeout/offline; the
		// timeout rejection message above ("… timed out") classifies as a timeout.
		const networkMsg = describeNetworkError(err, meta.label);
		const message =
			networkMsg ?? redactSecrets(err instanceof Error ? err.message : String(err));
		return { status: 'error', provider, message };
	}
}

/**
 * Pull a short, human-readable detail out of an error response of unknown shape.
 * Mirrors `extractErrorMessage` in ai-client.ts but tolerant of more envelopes
 * (Deepgram uses `err_msg`/`reason`) and never throws — returns '' when nothing
 * usable is found. The caller redacts the result.
 */
function extractErrorDetail(body: unknown, text: string): string {
	if (isRecord(body)) {
		if (isRecord(body.error) && typeof body.error.message === 'string') {
			return body.error.message;
		}
		if (typeof body.error === 'string') return body.error;
		if (typeof body.message === 'string') return body.message;
		if (typeof body.err_msg === 'string') return body.err_msg;
		if (typeof body.reason === 'string') return body.reason;
	}
	return typeof text === 'string' ? text.slice(0, MAX_DETAIL_LEN) : '';
}
