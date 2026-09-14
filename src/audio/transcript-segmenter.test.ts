import { describe, it, expect } from 'vitest';
import { segmentTranscript, trimRepeatedContext } from './transcript-segmenter';

describe('segmentTranscript', () => {
	it('returns a single segment with no context when the text fits', () => {
		const segments = segmentTranscript('short text', 100, 10);

		expect(segments).toEqual([{ body: 'short text', context: '' }]);
	});

	it('splits at paragraph boundaries and packs paragraphs greedily', () => {
		const text = 'para one.\n\npara two.\n\npara three.\n\npara four.';

		const segments = segmentTranscript(text, 22, 0);

		expect(segments.map((s) => s.body)).toEqual([
			'para one.\n\npara two.\n\n',
			'para three.\n\n',
			'para four.',
		]);
	});

	it('never splits a speaker line or heading when a paragraph is too long', () => {
		const text = ['## Chapter', 'Alice: hello there', 'Bob: hi again', 'Alice: bye now'].join('\n');

		const segments = segmentTranscript(text, 32, 0);

		for (const { body } of segments) {
			for (const line of body.split('\n').filter((l) => l.length > 0)) {
				expect(text.split('\n')).toContain(line);
			}
		}
		expect(segments.length).toBeGreaterThan(1);
	});

	it('falls back to sentence boundaries inside an over-long line', () => {
		const text = 'First sentence here. Second sentence here! Third one? Fourth sentence here.';

		const segments = segmentTranscript(text, 45, 0);

		expect(segments.map((s) => s.body)).toEqual([
			'First sentence here. Second sentence here! ',
			'Third one? Fourth sentence here.',
		]);
	});

	it('falls back to word boundaries for an unpunctuated run', () => {
		const text = 'one two three four five six seven eight';

		const segments = segmentTranscript(text, 15, 0);

		for (const { body } of segments) {
			expect(body.length).toBeLessThanOrEqual(15);
			expect(body.trim().split(' ').every((w) => text.includes(w))).toBe(true);
		}
	});

	it('hard-cuts a token with no whitespace so every body respects the budget', () => {
		const text = 'a'.repeat(50);

		const segments = segmentTranscript(text, 20, 0);

		expect(segments.map((s) => s.body)).toEqual(['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(10)]);
	});

	it('bodies concatenate back to the original text exactly', () => {
		const text = 'Intro line\n\nAlice: one. Two! Three?\nBob: four\n\n\nfive six seven eight nine ten';

		const segments = segmentTranscript(text, 18, 4);

		expect(segments.map((s) => s.body).join('')).toBe(text);
		expect(segments.every((s) => s.body.length <= 18)).toBe(true);
	});

	it('gives each segment the word-aligned tail of the previous body as context', () => {
		const text = 'alpha beta gamma.\n\ndelta epsilon zeta.\n\neta theta iota.';

		const segments = segmentTranscript(text, 22, 8);

		expect(segments[0].context).toBe('');
		expect(segments[1].context).toBe('gamma.');
		expect(segments[2].context).toBe('zeta.');
	});

	it('returns no segments for empty text', () => {
		expect(segmentTranscript('', 10, 2)).toEqual([]);
	});
});

describe('trimRepeatedContext', () => {
	it('strips a verbatim repeat of the context from the start of the output', () => {
		expect(trimRepeatedContext('gamma. Delta epsilon.', 'gamma.')).toBe('Delta epsilon.');
	});

	it('leaves output alone when the context is not repeated', () => {
		expect(trimRepeatedContext('Delta epsilon.', 'gamma.')).toBe('Delta epsilon.');
	});

	it('leaves output alone when there is no context', () => {
		expect(trimRepeatedContext('Delta epsilon.', '')).toBe('Delta epsilon.');
	});

	it('does not strip when the output is only the context', () => {
		expect(trimRepeatedContext('gamma.', 'gamma.')).toBe('gamma.');
	});
});
