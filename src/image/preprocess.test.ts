import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { arrayBufferToBase64, base64EncodedLength, preprocessImage } from './preprocess';

/**
 * Vitest runs in a node env with no DOM/Canvas. We mock document.createElement('canvas'),
 * the canvas 2d context, and createImageBitmap so the downscale path is exercisable.
 */

interface CanvasMock {
	width: number;
	height: number;
	getContext: ReturnType<typeof vi.fn>;
	toBlob: ReturnType<typeof vi.fn>;
}

let createdCanvases: CanvasMock[] = [];
let drawImageCalls = 0;
/** Bytes the mocked encoder returns; tests tune this to simulate over/under limit. */
let encodedByteLength = 1024;

function installCanvasMocks(): void {
	createdCanvases = [];
	drawImageCalls = 0;

	const makeCanvas = (): CanvasMock => {
		const canvas: CanvasMock = {
			width: 0,
			height: 0,
			getContext: vi.fn(() => ({
				drawImage: vi.fn(() => {
					drawImageCalls++;
				}),
			})),
			toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
				// Encode to a buffer of the currently-configured size.
				const buf = new Uint8Array(encodedByteLength).buffer;
				cb({
					arrayBuffer: () => Promise.resolve(buf),
				} as unknown as Blob);
			}),
		};
		return canvas;
	};

	vi.stubGlobal('document', {
		createElement: vi.fn((tag: string) => {
			if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
			const c = makeCanvas();
			createdCanvases.push(c);
			return c;
		}),
	});

	// Prefer the createImageBitmap path (simpler, no object URLs).
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(() =>
			Promise.resolve({
				width: 4000,
				height: 3000,
				close: vi.fn(),
			})
		)
	);

	// Blob is available in node 18+, but stub a minimal version for determinism.
	if (typeof globalThis.Blob === 'undefined') {
		vi.stubGlobal('Blob', class {});
	}
}

describe('arrayBufferToBase64', () => {
	it('encodes bytes to base64', () => {
		const bytes = new Uint8Array([72, 105]); // "Hi"
		expect(arrayBufferToBase64(bytes.buffer)).toBe('SGk=');
	});

	it('handles large buffers without stack overflow', () => {
		const big = new Uint8Array(100_000).fill(65); // 'A'
		const encoded = arrayBufferToBase64(big.buffer);
		expect(typeof encoded).toBe('string');
		expect(encoded.length).toBeGreaterThan(0);
	});
});

describe('base64EncodedLength', () => {
	it('computes the inflated (~4/3, padded) length', () => {
		expect(base64EncodedLength(3)).toBe(4);
		expect(base64EncodedLength(1)).toBe(4);
		expect(base64EncodedLength(6)).toBe(8);
	});
});

describe('preprocessImage', () => {
	beforeEach(() => {
		encodedByteLength = 1024;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('passes through small images without touching the canvas', async () => {
		installCanvasMocks();
		const small = new Uint8Array(1000).buffer; // base64 ~1336 bytes, well under limit
		const result = await preprocessImage(small, 'image/png', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(false);
		expect(result.data).toBe(small);
		expect(result.mediaType).toBe('image/png');
		expect(createdCanvases.length).toBe(0);
		expect(drawImageCalls).toBe(0);
	});

	it('downscales oversized images and returns a smaller payload', async () => {
		installCanvasMocks();
		// 8 MB raw → way over a 5 MB limit → triggers downscale.
		const big = new Uint8Array(8 * 1024 * 1024).buffer;
		// Mocked encoder yields a tiny payload that fits the limit.
		encodedByteLength = 50_000;

		const result = await preprocessImage(big, 'image/jpeg', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(true);
		expect(result.data.byteLength).toBe(50_000);
		expect(result.data.byteLength).toBeLessThan(big.byteLength);
		expect(drawImageCalls).toBeGreaterThan(0);
	});

	it('re-encodes lossless PNG sources to JPEG when downscaling', async () => {
		installCanvasMocks();
		const big = new Uint8Array(8 * 1024 * 1024).buffer;
		encodedByteLength = 40_000;

		const result = await preprocessImage(big, 'image/png', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(true);
		expect(result.mediaType).toBe('image/jpeg');
		// toBlob should have been asked for image/jpeg output.
		const lastCanvas = createdCanvases[createdCanvases.length - 1];
		expect(lastCanvas.toBlob).toHaveBeenCalled();
		expect(lastCanvas.toBlob.mock.calls[0][1]).toBe('image/jpeg');
	});

	it('returns best-effort downscaled result when it still cannot fit', async () => {
		installCanvasMocks();
		const big = new Uint8Array(40 * 1024 * 1024).buffer;
		// Encoder never gets under the limit, but produces a smaller buffer than input.
		encodedByteLength = 9 * 1024 * 1024;

		const result = await preprocessImage(big, 'image/jpeg', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(true);
		expect(result.data.byteLength).toBeLessThan(big.byteLength);
	});

	it('passes oversized GIFs through unchanged (not rasterizable)', async () => {
		installCanvasMocks();
		const big = new Uint8Array(8 * 1024 * 1024).buffer;
		const result = await preprocessImage(big, 'image/gif', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(false);
		expect(result.data).toBe(big);
		expect(createdCanvases.length).toBe(0);
	});

	it('degrades gracefully when canvas APIs are unavailable', async () => {
		// No mocks installed → no document/createImageBitmap globals.
		vi.stubGlobal('document', undefined);
		vi.stubGlobal('createImageBitmap', undefined);
		const big = new Uint8Array(8 * 1024 * 1024).buffer;
		const result = await preprocessImage(big, 'image/png', 5 * 1024 * 1024);

		expect(result.downscaled).toBe(false);
		expect(result.data).toBe(big);
	});
});
