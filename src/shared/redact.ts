/**
 * Redaction of API keys / auth tokens before they can reach a user-facing
 * Notice, an error message, an API error body echoed back to us, or the
 * console.
 *
 * This is the SINGLE SOURCE OF TRUTH for secret redaction. It is consumed by
 * both the AI client (redacting upstream error bodies) and `notifyError`
 * (redacting any error surfaced to the user/console). Previously each kept its
 * own inline copy of the pattern and they drifted — the `notifyError` copy was
 * missing the Google `AIza…` pattern, so a leaked Gemini key would have been
 * shown to the user verbatim. Keep all redaction going through here.
 *
 * Covered shapes:
 *  - OpenAI / Anthropic `sk-…` (and `sk-ant-…`) keys
 *  - Generic `key-…` and Deepgram `dg-…` prefixed keys
 *  - `Bearer …` and `Token …` Authorization header values
 *  - `anthropic-…` prefixed identifiers
 *  - Google `AIza…` API keys (x-goog-api-key)
 */
const SECRET_PATTERN =
	/(?:sk-|key-|dg-|Bearer\s+|Token\s+|anthropic-|AIza)[A-Za-z0-9_-]{8,}/g;

/**
 * Replace any recognized secret in `text` with `[REDACTED]`.
 * Safe to call on arbitrary strings; non-secret text is returned unchanged.
 */
export function redactSecrets(text: string): string {
	return text.replace(SECRET_PATTERN, '[REDACTED]');
}

/**
 * Convert an arbitrary caught value into a redacted, log-safe string.
 *
 * {@link redactSecrets} only operates on strings, so a console sink that logs an
 * Error object directly (`console.error(label, err)`) bypasses redaction — a
 * secret echoed into the error's `message` (or its `stack`, which embeds the
 * message) would reach the console verbatim. This is the single sanctioned way
 * to render a caught error for a log sink: it prefers the stack (already
 * includes the message and call frames), falls back to `name: message`, and
 * runs the result through {@link redactSecrets}. Route every raw-error console
 * sink through here so redact.ts stays the one place secrets are stripped.
 */
export function redactError(value: unknown): string {
	if (value instanceof Error) {
		return redactSecrets(value.stack ?? `${value.name}: ${value.message}`);
	}
	return redactSecrets(typeof value === 'string' ? value : String(value));
}
