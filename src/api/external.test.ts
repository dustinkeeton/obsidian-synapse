import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExternalRequests, JobGeneration } from './external';
import { JobCallRefusedError } from '../shared';

const REQUEST = { feature: 'elaboration' as const, messages: [{ role: 'user' as const, content: 'Hi' }] };

describe('ExternalRequests (#626)', () => {
	afterEach(() => vi.useRealTimers());

	it('fails a request nobody answers by its expiry', async () => {
		vi.useFakeTimers();
		const requests = new ExternalRequests(() => 0, 60_000);
		const reply = requests.generate(REQUEST);
		expect(requests.list()[0]).toMatchObject({ createdAt: new Date(0).toISOString(), expiresAt: new Date(60_000).toISOString() });
		vi.advanceTimersByTime(60_000);
		await expect(reply).rejects.toThrow('within 1 minutes');
		await expect(reply).rejects.toBeInstanceOf(JobCallRefusedError);
		expect(requests.list()).toEqual([]);
	});

	it('close fails pending requests and refuses new ones and commits', async () => {
		const requests = new ExternalRequests();
		const pending = requests.generate(REQUEST);
		requests.close('Job cancelled');
		await expect(pending).rejects.toThrow('Job cancelled');
		await expect(pending).rejects.toBeInstanceOf(JobCallRefusedError);
		await expect(requests.generate(REQUEST)).rejects.toThrow('Job cancelled');
		expect(requests.commit([{ requestId: 'x', text: 'y' }])).toBe('Job cancelled');
	});

	it('whenAwaiting resolves at once with a pending request, or when one arrives', async () => {
		const requests = new ExternalRequests();
		const later = requests.whenAwaiting();
		let resolved = false;
		void later.promise.then(() => { resolved = true; });
		await Promise.resolve();
		expect(resolved).toBe(false);
		void requests.generate(REQUEST).catch(() => undefined);
		await later.promise;
		await expect(requests.whenAwaiting().promise).resolves.toBeUndefined();
		requests.close('done');
	});
});

describe('JobGeneration (#626)', () => {
	it('counts calls and usage, skipping cache replays and joined calls', () => {
		const generation = new JobGeneration('plugin-key', null);
		const opts = generation.aiOptions();
		opts.beforeCall?.();
		opts.onResponse?.({ provider: 'anthropic', model: 'm', usage: { inputTokens: 10, outputTokens: 4 } });
		opts.onResponse?.({ provider: 'anthropic', model: 'm', usage: { inputTokens: 10, outputTokens: 4 }, cached: true });
		opts.onResponse?.({ provider: 'anthropic', model: 'm', usage: { inputTokens: 10, outputTokens: 4 }, joined: true });
		expect(generation.usage()).toEqual({ billing: 'plugin-key', calls: 1, maxCalls: null, inputTokens: 10, outputTokens: 4 });
		expect(opts.external).toBeUndefined();
		expect(generation.external).toBeNull();
	});

	it('refuses the call past maxCalls', () => {
		const opts = new JobGeneration('external', 2).aiOptions();
		opts.beforeCall?.();
		opts.beforeCall?.();
		expect(() => opts.beforeCall?.()).toThrow(new JobCallRefusedError('This job reached its limit of 2 model calls'));
		expect(() => opts.beforeCall?.()).toThrow(JobCallRefusedError);
		expect(opts.external).toBeTypeOf('function');
	});
});
