import { describe, it, expect } from 'vitest';
import { arrayBufferToBase64, base64EncodedLength } from './encoding';

describe('arrayBufferToBase64', () => {
	it('encodes bytes to base64', () => {
		const bytes = new TextEncoder().encode('Hi');
		expect(arrayBufferToBase64(bytes.buffer as ArrayBuffer)).toBe('SGk=');
	});

	it('encodes an empty buffer to an empty string', () => {
		expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
	});

	it('handles buffers larger than one encoding chunk', () => {
		const big = new Uint8Array(0x8000 + 16).fill(65); // 'A' × (chunk + 16)
		const encoded = arrayBufferToBase64(big.buffer as ArrayBuffer);
		expect(atob(encoded)).toBe('A'.repeat(0x8000 + 16));
	});
});

describe('base64EncodedLength', () => {
	it('computes the padded base64 length for raw byte counts', () => {
		expect(base64EncodedLength(0)).toBe(0);
		expect(base64EncodedLength(1)).toBe(4);
		expect(base64EncodedLength(3)).toBe(4);
		expect(base64EncodedLength(4)).toBe(8);
		expect(base64EncodedLength(6)).toBe(8);
	});

	it('matches the actual encoded length', () => {
		for (const n of [1, 2, 3, 100, 1000]) {
			const encoded = arrayBufferToBase64(new Uint8Array(n).buffer as ArrayBuffer);
			expect(base64EncodedLength(n)).toBe(encoded.length);
		}
	});
});
