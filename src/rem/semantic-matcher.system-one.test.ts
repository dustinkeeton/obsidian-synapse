import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';
import { RELEVANCE_LEVELS, SemanticMatcher, relevanceFromScore } from './semantic-matcher';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile } from '../__test-utils__/mock-factories';
import type { App, TFile } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

interface ScoreQuestionBody { instructions: string; criteria: string[] }

function laneRequests(): Array<{ state: string; questions: Record<string, ScoreQuestionBody> }> {
	return mockRequestUrl.mock.calls.map(([p]) => JSON.parse(p.body as string) as { state: string; questions: Record<string, ScoreQuestionBody> });
}

/** Answer every score question with the probability of "related or stronger" taken from `relevance(title)`. */
function stubLane(relevance: (title: string) => number): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as { questions: Record<string, ScoreQuestionBody> };
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			const title = /titled "(.+?)"/.exec(q.instructions)?.[1] ?? '';
			const r = relevance(title);
			answers[id] = {
				type: 'score',
				score: 3 * r,
				legend: {},
				probabilities: { '0': 1 - r, '1': 0, '2': r / 2, '3': r / 2 },
				confidence: Math.abs(r - 0.5) * 2,
			};
		}
		return Promise.resolve({ status: 200, json: { answers, usage: { input_tokens: 1, output_tokens: 1 } }, text: '', headers: {} });
	});
}

describe('relevanceFromScore', () => {
	it('sums the related and strongly-related probabilities', () => {
		expect(relevanceFromScore({ type: 'score', score: 2, legend: {}, probabilities: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.4 }, confidence: 0.4 })).toBeCloseTo(0.7);
		expect(relevanceFromScore({ type: 'score', score: 0, legend: {}, probabilities: { '0': 1 }, confidence: 1 })).toBe(0);
	});
});

describe('SemanticMatcher two-lane behaviour (#558)', () => {
	let app: ReturnType<typeof createMockApp>;
	let settings: SynapseSettings;
	let complete: MockInstance<typeof AIClient.prototype.complete>;
	let source: TFile;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		app = createMockApp();
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.rem.confidenceThreshold = 0.5;
		source = mockFile('notes/Source.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, mockFile('notes/ML Fundamentals.md'), mockFile('notes/Gardening.md'), mockFile('notes/Deep Learning.md')]);
		complete = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue(JSON.stringify([
			{ title: 'ML Fundamentals', matchedConcept: 'machine learning', confidence: 0.6 },
			{ title: 'Gardening', matchedConcept: 'soil', confidence: 0.9 },
			{ title: 'Deep Learning', matchedConcept: 'neural nets', confidence: 0.6 },
		]));
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const content = 'This note covers machine learning and neural nets.';
	const makeMatcher = () => new SemanticMatcher(app as unknown as App, () => settings);

	it('toggle off: zero lane calls, the full title list in the prompt, and the model\'s confidences', async () => {
		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('ML Fundamentals\nGardening\nDeep Learning');
		expect(result.map((r) => [r.targetDisplayName, r.confidence])).toEqual([['Gardening', 0.9], ['ML Fundamentals', 0.6], ['Deep Learning', 0.6]]);
	});

	it('toggle on: one score per title over the four levels, prompt restricted to cleared titles, lane relevance as confidence', async () => {
		settings.ai.systemOne.enabled = true;
		settings.ai.systemOne.apiKey = 'tsk-test';
		stubLane((title) => (title === 'ML Fundamentals' ? 0.9 : title === 'Deep Learning' ? 0.7 : 0.1));
		const onSystemOne = vi.fn();

		const result = await makeMatcher().match(source, content, new Set(), 10, { onSystemOne });

		const [req] = laneRequests();
		expect(req.state).toBe(content);
		expect(Object.keys(req.questions)).toEqual(['t0', 't1', 't2']);
		expect(req.questions.t0.criteria).toEqual(RELEVANCE_LEVELS);
		expect(req.questions.t0.instructions).toContain('"ML Fundamentals"');
		expect(complete).toHaveBeenCalledTimes(1);
		const prompt = complete.mock.calls[0][0];
		expect(prompt).toContain('ML Fundamentals');
		expect(prompt).toContain('Deep Learning');
		expect(prompt).not.toContain('Gardening');
		expect(result.map((r) => [r.targetDisplayName, r.confidence])).toEqual([['ML Fundamentals', 0.9], ['Deep Learning', 0.7]]);
		expect(result[0].matchedText).toBe('machine learning');
		expect(onSystemOne).toHaveBeenCalledTimes(1);
	});

	it('returns nothing and skips the prompt when no title clears rem.confidenceThreshold', async () => {
		settings.ai.systemOne.enabled = true;
		settings.ai.systemOne.apiKey = 'tsk-test';
		stubLane(() => 0.2);
		const onSystemOne = vi.fn();

		const result = await makeMatcher().match(source, content, new Set(), 10, { onSystemOne });

		expect(result).toEqual([]);
		expect(complete).not.toHaveBeenCalled();
		expect(onSystemOne).toHaveBeenCalledTimes(1);
	});

	it('drops a cleared title the concept-location prompt leaves out', async () => {
		settings.ai.systemOne.enabled = true;
		settings.ai.systemOne.apiKey = 'tsk-test';
		stubLane(() => 0.9);
		complete.mockResolvedValue(JSON.stringify([{ title: 'Gardening', matchedConcept: 'soil', confidence: 0.9 }]));

		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(result.map((r) => r.targetDisplayName)).toEqual(['Gardening']);
	});

	it('transport error: runs the full generative path and does not claim the lane', async () => {
		settings.ai.systemOne.enabled = true;
		settings.ai.systemOne.apiKey = 'tsk-test';
		mockRequestUrl.mockResolvedValue({ status: 529, json: { error: { message: 'overloaded' } }, text: '', headers: {} });
		vi.useFakeTimers();
		const onSystemOne = vi.fn();

		const pending = makeMatcher().match(source, content, new Set(), 10, { onSystemOne });
		await vi.runAllTimersAsync();
		const result = await pending;
		vi.useRealTimers();

		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('Gardening');
		expect(result).toHaveLength(3);
		expect(onSystemOne).not.toHaveBeenCalled();
	});
});
