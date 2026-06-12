/**
 * Shared binary→text encoding helpers.
 *
 * Moved here from `image/preprocess.ts` (#251) so non-image modules can reuse
 * them — Gemini audio transcription needs base64-encoded audio in its JSON
 * request body, and feature modules must not import from each other. `shared/`
 * is the bottom of the dependency graph, so this is the canonical home;
 * `image/preprocess.ts` re-exports for back-compat.
 */

/**
 * Encode an ArrayBuffer to a base64 string.
 * Single source of truth — previously duplicated in extractor.ts and image-analyzer.ts.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	// Chunk to avoid call-stack limits on very large buffers with String.fromCharCode(...spread).
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary);
}

/**
 * The size of a base64-encoded payload for `byteLength` raw bytes.
 * Base64 inflates by ~4/3 and pads to a multiple of 4.
 */
export function base64EncodedLength(byteLength: number): number {
	return Math.ceil(byteLength / 3) * 4;
}
