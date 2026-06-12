/**
 * Shared image preprocessing utilities.
 *
 * The Anthropic API rejects base64 image payloads above a hard limit (5 MB by
 * default) with a 400 error. Both the OCR extractor and the elaboration image
 * analyzer send raw base64 to the API, so this module provides a single place to
 * (a) encode buffers to base64 and (b) downscale/re-encode oversized images so
 * they fit under the limit before they ever reach the API.
 */

import { base64EncodedLength } from '../shared/encoding';

// Canonical home of the encoding helpers is now shared/encoding.ts (#251) so
// the audio module can reuse them; re-exported here for back-compat.
export { arrayBufferToBase64, base64EncodedLength } from '../shared/encoding';

/** Lossless source formats that benefit from JPEG re-encoding when downscaling. */
const LOSSLESS_MEDIA_TYPES = new Set(['image/png', 'image/bmp', 'image/tiff']);

/** Formats the canvas re-encode path cannot safely rasterize/re-encode. */
const NON_RASTERIZABLE_MEDIA_TYPES = new Set(['image/gif']);

export interface PreprocessResult {
	/** The (possibly re-encoded) image bytes to send to the API. */
	data: ArrayBuffer;
	/** The media type of `data` (may differ from input if converted to JPEG). */
	mediaType: string;
	/** True when the image was downscaled/re-encoded from its original form. */
	downscaled: boolean;
}

/**
 * Ensure an image's base64 payload fits within `maxBytes`.
 *
 * If the encoded payload is already within the limit, the input is passed
 * through unchanged. Otherwise the image is rasterized to a `<canvas>`,
 * downscaled (preserving aspect ratio) and — for lossless sources — re-encoded
 * to JPEG, iterating scale/quality down until it fits. If it still cannot fit,
 * the best-effort result is returned with `downscaled: true` so the caller can
 * surface a Notice.
 *
 * Runs in Obsidian's Electron renderer, which has a full DOM. In non-DOM
 * environments (e.g. unit tests without canvas mocks) it degrades gracefully by
 * passing the original bytes through.
 *
 * @param data       Raw image bytes.
 * @param mediaType  MIME type of `data` (e.g. "image/png").
 * @param maxBytes   Maximum allowed base64 payload size in bytes.
 */
export async function preprocessImage(
	data: ArrayBuffer,
	mediaType: string,
	maxBytes: number
): Promise<PreprocessResult> {
	// Already within limit → pass through untouched.
	if (base64EncodedLength(data.byteLength) <= maxBytes) {
		return { data, mediaType, downscaled: false };
	}

	// Can't safely rasterize this format (e.g. animated GIF) — pass through and
	// let the caller/API decide. Signal downscaled:true is NOT appropriate here
	// since we didn't change anything; surface as a best-effort passthrough.
	if (NON_RASTERIZABLE_MEDIA_TYPES.has(mediaType)) {
		return { data, mediaType, downscaled: false };
	}

	// If the DOM/canvas APIs aren't available (non-Electron test env without
	// mocks), degrade gracefully rather than throwing.
	if (!canUseCanvas()) {
		return { data, mediaType, downscaled: false };
	}

	try {
		return await downscaleToFit(data, mediaType, maxBytes);
	} catch (error) {
		console.warn('[Synapse] Image downscale failed; sending original bytes:', error);
		return { data, mediaType, downscaled: false };
	}
}

function canUseCanvas(): boolean {
	return (
		typeof document !== 'undefined' &&
		typeof document.createElement === 'function' &&
		(typeof createImageBitmap === 'function' || typeof Image !== 'undefined')
	);
}

/**
 * Rasterize the image and iteratively reduce scale/quality until the encoded
 * payload fits within `maxBytes`. Returns best-effort output if it can't fit.
 */
async function downscaleToFit(
	data: ArrayBuffer,
	mediaType: string,
	maxBytes: number
): Promise<PreprocessResult> {
	const source = await loadImageSource(data, mediaType);
	const { width: srcWidth, height: srcHeight } = source;

	if (!srcWidth || !srcHeight) {
		// Couldn't determine dimensions — nothing reliable to do.
		releaseImageSource(source);
		return { data, mediaType, downscaled: false };
	}

	// Lossless sources re-encode to JPEG for much better compression; otherwise
	// keep JPEG/WebP as JPEG (canvas re-encodes consistently).
	const outputType =
		LOSSLESS_MEDIA_TYPES.has(mediaType) || mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/jpeg';

	// Scale/quality ladder. Each pass shrinks dimensions and/or JPEG quality.
	const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12];
	const qualities = [0.85, 0.75, 0.6, 0.45];

	let best: { data: ArrayBuffer; mediaType: string } | null = null;

	for (const scale of scales) {
		const width = Math.max(1, Math.round(srcWidth * scale));
		const height = Math.max(1, Math.round(srcHeight * scale));

		for (const quality of qualities) {
			const encoded = await rasterizeToBuffer(source, width, height, outputType, quality);
			if (!encoded) continue;

			// Track the smallest payload seen as best-effort fallback.
			if (!best || encoded.byteLength < best.data.byteLength) {
				best = { data: encoded, mediaType: outputType };
			}

			if (base64EncodedLength(encoded.byteLength) <= maxBytes) {
				releaseImageSource(source);
				return { data: encoded, mediaType: outputType, downscaled: true };
			}
		}
	}

	releaseImageSource(source);

	// Couldn't get under the limit — return the smallest we produced (best effort).
	if (best) {
		return { data: best.data, mediaType: best.mediaType, downscaled: true };
	}
	return { data, mediaType, downscaled: false };
}

interface ImageSource {
	width: number;
	height: number;
	bitmap?: ImageBitmap;
	element?: HTMLImageElement;
}

/** Load image bytes into a drawable source (ImageBitmap preferred, else <img>). */
async function loadImageSource(data: ArrayBuffer, mediaType: string): Promise<ImageSource> {
	const blob = new Blob([data], { type: mediaType });

	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(blob);
		return { width: bitmap.width, height: bitmap.height, bitmap };
	}

	// Fallback: load via <img> + object URL.
	const url = URL.createObjectURL(blob);
	try {
		const element = await loadImageElement(url);
		return { width: element.naturalWidth, height: element.naturalHeight, element };
	} finally {
		URL.revokeObjectURL(url);
	}
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image for downscaling'));
		img.src = url;
	});
}

function releaseImageSource(source: ImageSource): void {
	if (source.bitmap && typeof source.bitmap.close === 'function') {
		source.bitmap.close();
	}
}

/** Draw the source onto a canvas at the given size and encode to a buffer. */
async function rasterizeToBuffer(
	source: ImageSource,
	width: number,
	height: number,
	outputType: string,
	quality: number
): Promise<ArrayBuffer | null> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	const drawable = (source.bitmap ?? source.element) as CanvasImageSource;
	ctx.drawImage(drawable, 0, 0, width, height);

	return canvasToBuffer(canvas, outputType, quality);
}

/** Encode a canvas to an ArrayBuffer, preferring toBlob and falling back to toDataURL. */
function canvasToBuffer(
	canvas: HTMLCanvasElement,
	outputType: string,
	quality: number
): Promise<ArrayBuffer | null> {
	return new Promise((resolve) => {
		if (typeof canvas.toBlob === 'function') {
			canvas.toBlob(
				(blob) => {
					if (!blob) {
						resolve(dataUrlFallback(canvas, outputType, quality));
						return;
					}
					blob
						.arrayBuffer()
						.then((buf) => resolve(buf))
						.catch(() => resolve(dataUrlFallback(canvas, outputType, quality)));
				},
				outputType,
				quality
			);
		} else {
			resolve(dataUrlFallback(canvas, outputType, quality));
		}
	});
}

function dataUrlFallback(
	canvas: HTMLCanvasElement,
	outputType: string,
	quality: number
): ArrayBuffer | null {
	if (typeof canvas.toDataURL !== 'function') return null;
	const dataUrl = canvas.toDataURL(outputType, quality);
	const commaIdx = dataUrl.indexOf(',');
	if (commaIdx === -1) return null;
	const base64 = dataUrl.slice(commaIdx + 1);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}
