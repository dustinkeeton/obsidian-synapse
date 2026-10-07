import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';
import { PromptBuilder } from './prompt-builder';
import { AIClient } from '../shared';
import type { DecisionRequestOptions } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import type { FrontmatterValueIndex } from './types';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;

const GENERATIVE = '[{"key": "category", "value": "reference", "action": "add"}, {"key": "created", "value": "2026", "action": "add"}]';

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

function confidentPick(pick: string): (id: string, options: string[]) => ChoiceReply {
	return (_id, options) => {
		const choice = options.includes(pick) ? pick : options[0];
		return { choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 };
	};
}

const VALUES: FrontmatterValueIndex = new Map([
	['category', ['reference', 'journal']],
	['type', ['project']],
	['status', ['draft']],
	['topics', ['ml', 'web']],
	['related-projects', ['synapse']],
]);

const vaultValues = (index: FrontmatterValueIndex) => (keys: readonly string[]): FrontmatterValueIndex =>
	new Map(keys.map((key) => [key, index.get(key) ?? []]));

describe('PromptBuilder.suggestFrontmatter two-lane behaviour (#563)', () => {
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
		const builder = new PromptBuilder(() => makeSettings());
		const use: { systemOne?: boolean } = {};
		const opts: DecisionRequestOptions = { onSystemOne: () => { use.systemOne = true; } };
		const collect = vi.fn(vaultValues(VALUES));

		const withLane = await builder.suggestFrontmatter('Note body', {}, opts, collect);
		const baseline = await builder.suggestFrontmatter('Note body', {});

		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(collect).not.toHaveBeenCalled();
		expect(withLane).toEqual(baseline);
		expect(complete.mock.calls[0][0]).toBe(complete.mock.calls[1][0]);
		expect(use.systemOne).toBeUndefined();
	});

	it('asks one choice per key over its collected values plus <new-value>', async () => {
		stubLane(confidentPick('reference'));
		const builder = new PromptBuilder(() => makeSettings(laneOn));

		await builder.suggestFrontmatter('Weekly sync', { status: 'done' }, undefined, vaultValues(VALUES));

		const [request] = laneRequests();
		expect(Object.keys(request.questions)).toEqual(['category', 'type', 'topics', 'related-projects']);
		expect(Object.keys(request.questions.category.criteria)).toEqual(['reference', 'journal', '<new-value>']);
		expect(Object.keys(request.questions.type.criteria)).toEqual(['project', '<new-value>']);
		expect(request.state).toContain('Weekly sync');
		expect(request.state).toContain('"status":"done"');
	});

	it('caps options at 254 existing values plus <new-value>', async () => {
		stubLane(confidentPick('v0'));
		const many = Array.from({ length: 300 }, (_, i) => `v${i}`);
		const builder = new PromptBuilder(() => makeSettings(laneOn));

		await builder.suggestFrontmatter('text', {}, undefined, vaultValues(new Map([['category', many]])));

		const criteria = Object.keys(laneRequests()[0].questions.category.criteria);
		expect(criteria).toHaveLength(255);
		expect(criteria[253]).toBe('v253');
		expect(criteria[254]).toBe('<new-value>');
	});

	it('confident existing values become suggestions with no complete() call', async () => {
		stubLane((id) => {
			const pick = { category: 'journal', type: 'project', status: 'draft', topics: 'ml', 'related-projects': 'synapse' }[id]!;
			return { choice: pick, probabilities: { [pick]: 0.9 }, confidence: 0.9 };
		});
		const builder = new PromptBuilder(() => makeSettings(laneOn));
		const use: { systemOne?: boolean } = {};

		const result = await builder.suggestFrontmatter('text', {}, { onSystemOne: () => { use.systemOne = true; } }, vaultValues(VALUES));

		expect(complete).not.toHaveBeenCalled();
		expect(result).toEqual([
			{ key: 'category', value: 'journal', action: 'add' },
			{ key: 'type', value: 'project', action: 'add' },
			{ key: 'status', value: 'draft', action: 'add' },
			{ key: 'topics', value: ['ml'], action: 'merge' },
			{ key: 'related-projects', value: ['synapse'], action: 'merge' },
		]);
		expect(use.systemOne).toBe(true);
	});

	it('<new-value> and keys without vault values reach a prompt restricted to those keys', async () => {
		stubLane((id, options) => id === 'category'
			? { choice: '<new-value>', probabilities: { '<new-value>': 0.9 }, confidence: 0.9 }
			: { choice: options[0], probabilities: { [options[0]]: 0.9 }, confidence: 0.9 });
		complete.mockResolvedValue('[{"key": "category", "value": "howto", "action": "add"}, {"key": "type", "value": "invented", "action": "add"}]');
		const values = new Map(VALUES);
		values.delete('status');
		const builder = new PromptBuilder(() => makeSettings(laneOn));

		const result = await builder.suggestFrontmatter('text', {}, undefined, vaultValues(values));

		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('Suggest values ONLY for these keys: category, status.');
		expect(result.map((r) => [r.key, r.value])).toEqual([
			['type', 'project'],
			['topics', ['ml']],
			['related-projects', ['synapse']],
			['category', 'howto'],
		]);
	});

	it('sub-floor answers go to the generative prompt and do not claim the lane', async () => {
		stubLane((_id, options) => ({ choice: options[0], probabilities: { [options[0]]: 0.3 }, confidence: 0.3 }));
		const builder = new PromptBuilder(() => makeSettings(laneOn));
		const use: { systemOne?: boolean } = {};

		const result = await builder.suggestFrontmatter('text', {}, { onSystemOne: () => { use.systemOne = true; } }, vaultValues(VALUES));

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toEqual([{ key: 'category', value: 'reference', action: 'add' }]);
		expect(use.systemOne).toBeUndefined();
	});

	it('list keys merge secondary options at or above the floor', async () => {
		stubLane((id, options) => id === 'topics'
			? { choice: 'ml', probabilities: { ml: 0.6, web: 0.6, '<new-value>': 0 }, confidence: 0.6 }
			: { choice: options[0], probabilities: { [options[0]]: 1 }, confidence: 1 });
		const builder = new PromptBuilder(() => makeSettings((s) => { laneOn(s); s.ai.systemOne.confidenceFloor = 0.6; }));

		const result = await builder.suggestFrontmatter('text', {}, undefined, vaultValues(VALUES));

		expect(result.find((r) => r.key === 'topics')).toEqual({ key: 'topics', value: ['ml', 'web'], action: 'merge' });
	});

	it('never suggests a value the vault does not already hold', async () => {
		stubLane(() => ({ choice: 'invented', probabilities: { invented: 1 }, confidence: 1 }));
		complete.mockResolvedValue('[]');
		const builder = new PromptBuilder(() => makeSettings(laneOn));

		const result = await builder.suggestFrontmatter('text', {}, undefined, vaultValues(VALUES));

		expect(result).toEqual([]);
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('keys the note already has are neither asked nor suggested', async () => {
		stubLane(confidentPick('reference'));
		const builder = new PromptBuilder(() => makeSettings(laneOn));

		const result = await builder.suggestFrontmatter(
			'text',
			{ category: 'x', type: 'x', status: 'x', topics: [], 'related-projects': [] },
			undefined,
			vaultValues(VALUES)
		);

		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toEqual([{ key: 'created', value: '2026', action: 'add' }]);
	});

	it('transport error: runs the full generative prompt and does not claim the lane', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, json: { error: { message: 'boom' } }, text: '', headers: {} });
		const builder = new PromptBuilder(() => makeSettings(laneOn));
		const use: { systemOne?: boolean } = {};

		const result = await builder.suggestFrontmatter('text', {}, { onSystemOne: () => { use.systemOne = true; } }, vaultValues(VALUES));

		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('Suggest useful metadata fields like');
		expect(result.map((r) => r.key)).toEqual(['category', 'created']);
		expect(use.systemOne).toBeUndefined();
	});
});
