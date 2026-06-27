import { describe, it, expect } from 'vitest';
import { hashString, contentKey } from './hash-utils';

describe('hashString', () => {
	it('is deterministic — the same input yields an identical digest across calls', () => {
		const input = 'The quick brown fox jumps over the lazy dog';
		expect(hashString(input)).toBe(hashString(input));
	});

	it('always returns a 16-character lowercase hex digest', () => {
		for (const input of ['', 'a', 'hello world', '🦊 unicode ☃', 'x'.repeat(1000)]) {
			const digest = hashString(input);
			expect(digest).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it('produces different digests for different inputs', () => {
		expect(hashString('alpha')).not.toBe(hashString('beta'));
		// A single-character change must diverge.
		expect(hashString('note-v1')).not.toBe(hashString('note-v2'));
	});

	it('is order-sensitive', () => {
		expect(hashString('ab')).not.toBe(hashString('ba'));
	});
});

describe('contentKey', () => {
	it('is deterministic for the same ordered parts', () => {
		const parts = ['notes/a.md', 'deadbeefdeadbeef', 'openai', 'gpt-4o'];
		expect(contentKey(parts)).toBe(contentKey(parts));
	});

	it('length-prefixing prevents boundary collisions between part lists', () => {
		// Without length-prefixing both lists join to "abc" and would collide.
		expect(contentKey(['a', 'bc'])).not.toBe(contentKey(['ab', 'c']));
	});

	it('distinguishes an empty trailing part from a missing one', () => {
		expect(contentKey(['a', ''])).not.toBe(contentKey(['a']));
	});

	it('returns a 16-character hex digest', () => {
		expect(contentKey(['x', 'y', 'z'])).toMatch(/^[0-9a-f]{16}$/);
	});
});
