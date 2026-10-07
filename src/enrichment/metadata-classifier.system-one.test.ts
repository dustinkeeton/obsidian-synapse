import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';
import { MetadataClassifier } from './metadata-classifier';
import { AIClient } from '../shared';
import type { DecisionRequestOptions } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;

const GENERATIVE = '[{"tag": "draft", "confidence": 0.9}, {"tag": "meeting", "confidence": 0.7}]';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

function laneOn(s: SynapseSettings): void {
	s.ai.systemOne.enabled = true;
	s.ai.systemOne.apiKey = 'tsk-test';
}

interface ChoiceReply { choice: string; probabilities: Record<string, number>; confidence: number }

/** Answer every choice question in the request with `reply(id, criteria)`. */
function stubLane(reply: (id: string, options: string[]) => ChoiceReply): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as { questions: Record<string, { criteria: Record<string, unknown> }> };
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			answers[id] = { type: 'choice', ...reply(id, Object.keys(q.criteria)) };
		}
		return Promise.resolve({ status: 200, json: { answers, usage: { input_tokens: 1, output_tokens: 1 } }, text: '', headers: {} });
	});
}

function laneRequests(): Array<{ state: string; questions: Record<string, { instructions: string; criteria: Record<string, unknown> }> }> {
	return mockRequestUrl.mock.calls
		.filter(([p]) => p.url.includes('/v1/systemone'))
		.map(([p]) => JSON.parse(p.body as string) as { state: string; questions: Record<string, { instructions: string; criteria: Record<string, unknown> }> });
}

describe('MetadataClassifier two-lane behaviour (#558)', () => {
	let complete: MockInstance<typeof AIClient.prototype.complete>;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		complete = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue(GENERATIVE);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('toggle off: never calls /v1/systemone and returns exactly the generative result', async () => {
		const classifier = new MetadataClassifier(() => makeSettings());
		const use: { systemOne?: boolean } = {};
		const opts: DecisionRequestOptions = { onSystemOne: () => { use.systemOne = true; } };

		const results = await classifier.classify('Some note content', [], opts);

		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(results.map((r) => r.tag)).toEqual(['#draft', '#meeting']);
		expect(use.systemOne).toBeUndefined();
	});

	it('toggle on: asks one choice per category over its tags plus <none> and skips complete() when every answer is confident', async () => {
		stubLane((id, options) => {
			const pick = id === 'c0' ? 'draft' : '<none>';
			const probabilities = Object.fromEntries(options.map((o) => [o, o === pick ? 0.9 : 0.1 / (options.length - 1)]));
			return { choice: pick, probabilities, confidence: 0.9 };
		});
		const classifier = new MetadataClassifier(() => makeSettings(laneOn));
		const use: { systemOne?: boolean } = {};

		const results = await classifier.classify('Rough first pass at the plan', ['#existing'], { onSystemOne: () => { use.systemOne = true; } });

		expect(complete).not.toHaveBeenCalled();
		const [request] = laneRequests();
		expect(Object.keys(request.questions)).toEqual(['c0', 'c1', 'c2']);
		expect(Object.keys(request.questions.c0.criteria)).toEqual([...DEFAULT_SETTINGS.enrichment.tagVocabulary[0].tags, '<none>']);
		expect(request.questions.c0.instructions).toContain('Status');
		expect(request.state).toContain('Rough first pass at the plan');
		expect(request.state).toContain('#existing');
		expect(results).toEqual([
			expect.objectContaining({ tag: '#draft', category: 'Status', confidence: 0.9 }),
		]);
		expect(use.systemOne).toBe(true);
	});

	it('routes only uncertain categories to the generative prompt, restricted to those categories', async () => {
		stubLane((id, options) => {
			if (id === 'c0') {
				return { choice: 'draft', probabilities: { draft: 0.95, '<none>': 0.05 }, confidence: 0.95 };
			}
			const flat = 1 / options.length;
			return { choice: options[0], probabilities: Object.fromEntries(options.map((o) => [o, flat])), confidence: 0.1 };
		});
		complete.mockResolvedValue('[{"tag": "meeting", "confidence": 0.8}]');
		const classifier = new MetadataClassifier(() => makeSettings(laneOn));

		const results = await classifier.classify('Weekly sync notes', []);

		expect(complete).toHaveBeenCalledTimes(1);
		const prompt = complete.mock.calls[0][0];
		expect(prompt).toContain('Type:');
		expect(prompt).toContain('Source:');
		expect(prompt).not.toContain('Status:');
		expect(results.map((r) => r.tag)).toEqual(['#draft', '#meeting']);
	});

	it('keeps the vocabulary guard: an option outside the vocabulary is dropped even when confident', async () => {
		stubLane(() => ({ choice: 'invented', probabilities: { invented: 1 }, confidence: 1 }));
		const classifier = new MetadataClassifier(() => makeSettings(laneOn));

		const results = await classifier.classify('text', []);

		expect(results).toEqual([]);
		expect(complete).not.toHaveBeenCalled();
	});

	it('surfaces a second tag from probabilities only at or above the floor', async () => {
		stubLane((id): ChoiceReply => id === 'c0'
			? { choice: 'draft', probabilities: { draft: 0.5, todo: 0.5 }, confidence: 0.5 }
			: { choice: '<none>', probabilities: { '<none>': 1 }, confidence: 1 });
		const classifier = new MetadataClassifier(() => makeSettings((s) => { laneOn(s); s.ai.systemOne.confidenceFloor = 0.5; }));

		const results = await classifier.classify('text', []);

		expect(results.map((r) => r.tag).sort()).toEqual(['#draft', '#todo']);
	});

	it('transport error: falls back to the generative path for every category and does not claim the lane', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, json: { error: { message: 'boom' } }, text: '', headers: {} });
		const classifier = new MetadataClassifier(() => makeSettings(laneOn));
		const use: { systemOne?: boolean } = {};

		const results = await classifier.classify('Some note content', [], { onSystemOne: () => { use.systemOne = true; } });

		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('Status:');
		expect(results.map((r) => r.tag)).toEqual(['#draft', '#meeting']);
		expect(use.systemOne).toBeUndefined();
	});

	it('401 is a lane-unavailable error and still falls back', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401, json: { error: { message: 'Missing or invalid API key' } }, text: '', headers: {} });
		const classifier = new MetadataClassifier(() => makeSettings(laneOn));

		const results = await classifier.classify('Some note content', []);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(results).toHaveLength(2);
	});
});
