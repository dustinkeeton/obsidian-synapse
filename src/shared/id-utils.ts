/**
 * Shared ID generation utility.
 *
 * Produces a compact, collision-resistant identifier by combining
 * the current timestamp (base-36) with random alphanumeric characters.
 * The result matches /^[a-z0-9]+$/.
 */
export function generateId(): string {
	return (
		Date.now().toString(36) +
		Math.random().toString(36).slice(2, 10)
	);
}

/** Unguessable hex suffix for temp file names in the shared OS temp dir (CSPRNG, unlike {@link generateId}). */
export function randomToken(bytes = 8): string {
	const buffer = new Uint8Array(bytes);
	window.crypto.getRandomValues(buffer);
	return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate that a checkpoint ID is safe for use in file paths.
 * Rejects IDs containing path traversal characters or anything
 * outside the expected base-36 charset.
 */
export function isValidCheckpointId(id: string): boolean {
	return /^[a-z0-9]+$/.test(id);
}
