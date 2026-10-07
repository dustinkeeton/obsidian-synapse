import { describe, it, expect, vi, afterEach } from 'vitest';
import { partitionByConfidence, routeByConfidence } from './confidence-router';

interface Answer { pick: string; confidence: number }

function route(overrides: Partial<Parameters<typeof routeByConfidence<Answer, string>>[0]> = {}) {
	const fallback = vi.fn().mockResolvedValue('generative');
	const opts = {
		systemOne: async () => ({ pick: 'folder', confidence: 0.9 }),
		floor: 0.6,
		confidenceOf: (a: Answer) => a.confidence,
		accept: (a: Answer) => a.pick,
		fallback,
		...overrides,
	};
	return { fallback, run: () => routeByConfidence<Answer, string>(opts) };
}

describe('routeByConfidence', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('accepts the System 1 answer at or above the floor without touching the fallback', async () => {
		const { fallback, run } = route();
		const result = await run();
		expect(result).toEqual({ value: 'folder', lane: 'system-one', confidence: 0.9 });
		expect(fallback).not.toHaveBeenCalled();
	});

	it('treats the floor as inclusive', async () => {
		const { fallback, run } = route({ systemOne: async () => ({ pick: 'x', confidence: 0.6 }) });
		expect((await run()).lane).toBe('system-one');
		expect(fallback).not.toHaveBeenCalled();
	});

	it('falls back exactly once below the floor', async () => {
		const { fallback, run } = route({ systemOne: async () => ({ pick: 'x', confidence: 0.59 }) });
		const result = await run();
		expect(result).toEqual({ value: 'generative', lane: 'system-two' });
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('falls back exactly once when the lane is disabled', async () => {
		const { fallback, run } = route({ systemOne: null });
		expect((await run()).lane).toBe('system-two');
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('falls back exactly once when the lane returns null', async () => {
		const { fallback, run } = route({ systemOne: async () => null });
		expect((await run()).lane).toBe('system-two');
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('falls back exactly once and logs a redacted warning when the lane throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { fallback, run } = route({
			systemOne: async () => { throw new Error('API error (500): Bearer tsk-secret-1234567890'); },
			label: 'placement',
		});
		expect((await run()).lane).toBe('system-two');
		expect(fallback).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
		const logged = warn.mock.calls[0].join(' ');
		expect(logged).toContain('placement');
		expect(logged).not.toContain('tsk-secret-1234567890');
	});

	it('propagates a fallback rejection', async () => {
		const { run } = route({ systemOne: null, fallback: vi.fn().mockRejectedValue(new Error('boom')) });
		await expect(run()).rejects.toThrow('boom');
	});
});

describe('partitionByConfidence', () => {
	it('splits answers by the floor and keeps uncertain ids in order', () => {
		const answers = { a: { c: 0.9 }, b: { c: 0.2 }, c: { c: 0.6 }, d: { c: 0.59 } };
		const result = partitionByConfidence(answers, 0.6, (x) => x.c);
		expect(Object.keys(result.confident)).toEqual(['a', 'c']);
		expect(result.uncertain).toEqual(['b', 'd']);
	});

	it('handles an empty map', () => {
		expect(partitionByConfidence({}, 0.6, () => 1)).toEqual({ confident: {}, uncertain: [] });
	});
});
