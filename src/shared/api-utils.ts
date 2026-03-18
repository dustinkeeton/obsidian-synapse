import { Notice } from 'obsidian';

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries = 3,
	delayMs = 1000
): Promise<T> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;
			if (attempt < maxRetries - 1) {
				await sleep(delayMs * Math.pow(2, attempt));
			}
		}
	}
	throw lastError;
}

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function notifyError(context: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	// Redact potential API keys/tokens from error messages shown to users
	const redacted = message.replace(
		/(?:sk-|key-|dg-|anthropic-|Bearer\s+|Token\s+)[A-Za-z0-9_-]{8,}/g,
		'[REDACTED]'
	);
	new Notice(`Synapse: ${context} - ${redacted}`);
	console.error(`[Synapse] ${context}:`, redacted);
}
