import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';
import {
	DecisionClient,
	DecisionLaneError,
	SYSTEM_ONE_ENDPOINT,
	answerConfidence,
	choice,
	chunkQuestions,
	noul,
	score,
} from './decision-client';
import { ApiRequestError } from './safe-request';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	s.ai.systemOne.enabled = true;
	s.ai.systemOne.apiKey = 'tsk-secret-key-1234567890';
	mutate?.(s);
	return s;
}

function ok(json: unknown) {
	return { status: 200, json, text: '', headers: {} };
}

function resp(status: number, json: unknown = {}) {
	return { status, json, text: '', headers: {} };
}

function choiceResponse(id: string, pick: string, confidence = 0.9) {
	return ok({
		model: 'jev-1.13.0',
		answers: { [id]: { type: 'choice', choice: pick, probabilities: { [pick]: confidence, other: 1 - confidence }, confidence } },
		usage: { input_tokens: 100, output_tokens: 10 },
	});
}

function requestBody(call = 0): { state: string; model: string; questions: Record<string, unknown> } {
	const param = mockRequestUrl.mock.calls[call][0];
	return JSON.parse(param.body as string) as { state: string; model: string; questions: Record<string, unknown> };
}

describe('question builders', () => {
	it('build the documented Jev shapes', () => {
		expect(choice('Pick', { a: 'A', b: null })).toEqual({ type: 'choice', instructions: 'Pick', criteria: { a: 'A', b: null } });
		expect(score('Rate', ['low', 'high'])).toEqual({ type: 'score', instructions: 'Rate', criteria: ['low', 'high'] });
		expect(noul('Yes?')).toEqual({ type: 'noul', instructions: 'Yes?' });
		expect(noul('Yes?', { true: 'y' })).toEqual({ type: 'noul', instructions: 'Yes?', criteria: { true: 'y' } });
	});

	it('derives routing confidence for a noul from its distance to 0.5', () => {
		expect(answerConfidence({ type: 'noul', noul: 0.1 })).toBeCloseTo(0.9);
		expect(answerConfidence({ type: 'noul', noul: 0.8 })).toBeCloseTo(0.8);
		expect(answerConfidence({ type: 'choice', choice: 'a', probabilities: {}, confidence: 0.42 })).toBe(0.42);
	});
});

describe('chunkQuestions', () => {
	it('keeps a small map in one chunk', () => {
		const chunks = chunkQuestions('state', { a: noul('a'), b: noul('b') });
		expect(chunks).toHaveLength(1);
		expect(Object.keys(chunks[0])).toEqual(['a', 'b']);
	});

	it('splits a large map across requests under the 64k budget and preserves every id', () => {
		const questions: Record<string, ReturnType<typeof score>> = {};
		for (let i = 0; i < 300; i++) {
			questions[`t${i}`] = score(`Title ${i} ${'x'.repeat(1200)}`, ['unrelated', 'related']);
		}
		const chunks = chunkQuestions('state', questions);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.flatMap((c) => Object.keys(c))).toEqual(Object.keys(questions));
	});

	it('throws a budget error when the state plus one question cannot fit', () => {
		const state = 'y'.repeat(32_000 * 4);
		expect(() => chunkQuestions(state, { a: noul('a') })).toThrow(DecisionLaneError);
		try {
			chunkQuestions(state, { a: noul('a') });
		} catch (err) {
			expect((err as DecisionLaneError).reason).toBe('budget');
		}
	});
});

describe('DecisionClient', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is disabled without the toggle or without a key', () => {
		expect(new DecisionClient(() => makeSettings((s) => { s.ai.systemOne.enabled = false; })).isEnabled()).toBe(false);
		expect(new DecisionClient(() => makeSettings((s) => { s.ai.systemOne.apiKey = '   '; })).isEnabled()).toBe(false);
		expect(new DecisionClient(() => makeSettings()).isEnabled()).toBe(true);
	});

	it('posts the documented request shape with a Bearer header and throw:false', async () => {
		mockRequestUrl.mockResolvedValue(choiceResponse('q', 'a'));
		const client = new DecisionClient(() => makeSettings());

		const result = await client.decide('note text', { q: choice('Pick', { a: null, b: null }) });

		const param = mockRequestUrl.mock.calls[0][0];
		expect(param.url).toBe(SYSTEM_ONE_ENDPOINT);
		expect(param.method).toBe('POST');
		expect(param.throw).toBe(false);
		expect(param.headers?.Authorization).toBe('Bearer tsk-secret-key-1234567890');
		expect(requestBody()).toEqual({
			state: 'note text',
			model: 'jev-latest',
			questions: { q: { type: 'choice', instructions: 'Pick', criteria: { a: null, b: null } } },
		});
		expect(result.answers.q.choice).toBe('a');
		expect(result.answers.q.confidence).toBe(0.9);
		expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
		expect(result.requests).toBe(1);
	});

	it('throws a disabled lane error instead of calling the network when off', async () => {
		const client = new DecisionClient(() => makeSettings((s) => { s.ai.systemOne.enabled = false; }));
		await expect(client.decide('s', { q: noul('q') })).rejects.toMatchObject({ reason: 'disabled' });
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('chunks a large question map across requests and merges the answers and usage', async () => {
		const questions: Record<string, ReturnType<typeof score>> = {};
		for (let i = 0; i < 300; i++) {
			questions[`t${i}`] = score(`Title ${i} ${'x'.repeat(1200)}`, ['unrelated', 'related']);
		}
		mockRequestUrl.mockImplementation((param) => {
			const body = JSON.parse(param.body as string) as { questions: Record<string, unknown> };
			const answers: Record<string, unknown> = {};
			for (const id of Object.keys(body.questions)) {
				answers[id] = { type: 'score', score: 1, legend: { '0': 'unrelated', '1': 'related' }, probabilities: { '0': 0, '1': 1 }, confidence: 1 };
			}
			return Promise.resolve(ok({ model: 'jev-1.13.0', answers, usage: { input_tokens: 10, output_tokens: 1 } }));
		});
		const client = new DecisionClient(() => makeSettings());

		const result = await client.decide('state', questions);

		expect(mockRequestUrl.mock.calls.length).toBeGreaterThan(1);
		expect(result.requests).toBe(mockRequestUrl.mock.calls.length);
		expect(Object.keys(result.answers)).toHaveLength(300);
		expect(result.answers.t299.score).toBe(1);
		expect(result.usage.inputTokens).toBe(10 * mockRequestUrl.mock.calls.length);
	});

	it.each([
		[401, 'unauthorized'],
		[422, 'invalid-request'],
	] as const)('maps HTTP %s to a typed lane error without retrying', async (status, reason) => {
		mockRequestUrl.mockResolvedValue(resp(status, { error: { message: `bad request for Bearer tsk-secret-key-1234567890` } }));
		const client = new DecisionClient(() => makeSettings());

		const err = await client.decide('s', { q: noul('q') }).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(DecisionLaneError);
		expect((err as DecisionLaneError).reason).toBe(reason);
		expect((err as Error).message).not.toContain('tsk-secret-key-1234567890');
		expect((err as Error).message).toContain('[REDACTED]');
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it.each([429, 529])('retries HTTP %s with backoff and succeeds', async (status) => {
		vi.useFakeTimers();
		mockRequestUrl
			.mockResolvedValueOnce(resp(status, { error: { message: 'slow down' } }))
			.mockResolvedValueOnce(choiceResponse('q', 'a'));
		const client = new DecisionClient(() => makeSettings());

		const pending = client.decide('s', { q: choice('Pick', { a: null }) });
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(result.answers.q.choice).toBe('a');
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('gives up on persistent 429 after the bounded retries with the status error', async () => {
		vi.useFakeTimers();
		mockRequestUrl.mockResolvedValue(resp(429, { error: { message: 'rate limited' } }));
		const client = new DecisionClient(() => makeSettings());

		const pending = client.decide('s', { q: noul('q') }).catch((e: unknown) => e);
		await vi.runAllTimersAsync();
		const err = await pending;

		expect(err).toBeInstanceOf(ApiRequestError);
		expect((err as ApiRequestError).status).toBe(429);
		expect(mockRequestUrl).toHaveBeenCalledTimes(3);
		vi.useRealTimers();
	});

	it('rejects with a timeout error when the request never settles', async () => {
		vi.useFakeTimers();
		mockRequestUrl.mockReturnValue(new Promise(() => undefined));
		const client = new DecisionClient(() => makeSettings());

		const pending = client.decide('s', { q: noul('q') }).catch((e: unknown) => e);
		await vi.advanceTimersByTimeAsync(130_000);
		const err = await pending;

		expect((err as Error).message).toContain('timed out');
		vi.useRealTimers();
	});

	it('rejects a malformed answer with a typed lane error', async () => {
		mockRequestUrl.mockResolvedValue(ok({ answers: { q: { type: 'choice', choice: 7 } } }));
		const client = new DecisionClient(() => makeSettings());

		await expect(client.decide('s', { q: choice('Pick', { a: null }) })).rejects.toMatchObject({ reason: 'malformed-response' });
	});

	it('parses score and noul answers', async () => {
		mockRequestUrl.mockResolvedValue(ok({
			answers: {
				s: { type: 'score', score: 1.43, legend: { '0': 'a', '1': 'b', '2': 'c' }, probabilities: { '0': 0, '1': 0.57, '2': 0.43 }, confidence: 0.35 },
				n: { type: 'noul', noul: 0.9 },
			},
			usage: { input_tokens: 5, output_tokens: 1 },
		}));
		const client = new DecisionClient(() => makeSettings());

		const result = await client.decide('s', { s: score('Rate', ['a', 'b', 'c']), n: noul('Yes?') });

		expect(result.answers.s.score).toBeCloseTo(1.43);
		expect(result.answers.s.probabilities['2']).toBeCloseTo(0.43);
		expect(result.answers.n.noul).toBe(0.9);
	});

	describe('response cache', () => {
		it('does not cache by default (temperature 0.7, cacheResponses off)', async () => {
			mockRequestUrl.mockResolvedValue(choiceResponse('q', 'a'));
			const client = new DecisionClient(() => makeSettings());
			const onCacheHit = vi.fn();

			await client.decide('s', { q: choice('Pick', { a: null }) }, { onCacheHit });
			await client.decide('s', { q: choice('Pick', { a: null }) }, { onCacheHit });

			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			expect(onCacheHit).not.toHaveBeenCalled();
		});

		it('replays an identical request when cacheResponses is on and reports the hit', async () => {
			mockRequestUrl.mockResolvedValue(choiceResponse('q', 'a'));
			const client = new DecisionClient(() => makeSettings((s) => { s.ai.cacheResponses = true; }));
			const onCacheHit = vi.fn();

			await client.decide('s', { q: choice('Pick', { a: null }) }, { onCacheHit });
			const second = await client.decide('s', { q: choice('Pick', { a: null }) }, { onCacheHit });

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
			expect(onCacheHit).toHaveBeenCalledTimes(1);
			expect(second.requests).toBe(0);
			expect(second.answers.q.choice).toBe('a');
		});

		it('caches at temperature 0 and keys on state, questions, and model', async () => {
			mockRequestUrl.mockResolvedValue(choiceResponse('q', 'a'));
			const client = new DecisionClient(() => makeSettings((s) => { s.ai.temperature = 0; }));

			await client.decide('s', { q: choice('Pick', { a: null }) });
			await client.decide('s', { q: choice('Pick', { a: null }) });
			await client.decide('other', { q: choice('Pick', { a: null }) });

			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		it('bypassCache re-dispatches and refreshes the cache without reporting a hit', async () => {
			mockRequestUrl.mockResolvedValue(choiceResponse('q', 'a'));
			const client = new DecisionClient(() => makeSettings((s) => { s.ai.cacheResponses = true; }));
			const onCacheHit = vi.fn();

			await client.decide('s', { q: choice('Pick', { a: null }) });
			await client.decide('s', { q: choice('Pick', { a: null }) }, { bypassCache: true, onCacheHit });

			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			expect(onCacheHit).not.toHaveBeenCalled();
		});

		it('never caches a failed dispatch', async () => {
			mockRequestUrl
				.mockResolvedValueOnce(resp(422, { error: { message: 'bad' } }))
				.mockResolvedValueOnce(choiceResponse('q', 'a'));
			const client = new DecisionClient(() => makeSettings((s) => { s.ai.cacheResponses = true; }));

			await expect(client.decide('s', { q: noul('q') })).rejects.toBeInstanceOf(DecisionLaneError);
			await client.decide('s', { q: noul('q') }).catch(() => undefined);

			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});
	});
});
