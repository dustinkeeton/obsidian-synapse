import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';
import { NO_ANCHOR, RELEVANCE_LEVELS, RemLaneError, SemanticMatcher, anchorSentences, relevanceFromScore } from './semantic-matcher';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile } from '../__test-utils__/mock-factories';
import type { App, TFile } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

interface LaneQuestion { type: 'score' | 'choice'; instructions: string; criteria: string[] | Record<string, string | null> }
interface LaneRequest { state: string; questions: Record<string, LaneQuestion> }

function laneRequests(): LaneRequest[] {
	return mockRequestUrl.mock.calls.map(([p]) => JSON.parse(p.body as string) as LaneRequest);
}

/** Score questions get `relevance(title)` as the strongly-related mass; choice questions pick `anchor(title, criteria)`. */
function stubLane(relevance: (title: string) => number, anchor: (title: string, criteria: Record<string, string | null>) => string): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as LaneRequest;
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			const title = /titled "(.+?)"/.exec(q.instructions)?.[1] ?? '';
			if (q.type === 'choice') {
				const picked = anchor(title, q.criteria as Record<string, string | null>);
				answers[id] = { type: 'choice', choice: picked, probabilities: { [picked]: 0.9 }, confidence: 0.9 };
				continue;
			}
			const r = relevance(title);
			answers[id] = {
				type: 'score',
				score: 3 * r,
				legend: {},
				probabilities: { '0': (1 - r) / 2, '1': 0, '2': (1 - r) / 2, '3': r },
				confidence: Math.abs(r - 0.5) * 2,
			};
		}
		return Promise.resolve({ status: 200, json: { answers, usage: { input_tokens: 1, output_tokens: 1 } }, text: '', headers: {} });
	});
}

/** Pick the sentence option whose text contains `needle`, else `<none>`. */
function sentenceWith(needle: string, criteria: Record<string, string | null>): string {
	return Object.entries(criteria).find(([, text]) => text?.includes(needle))?.[0] ?? NO_ANCHOR;
}

describe('relevanceFromScore', () => {
	it('counts only the strongly-related probability', () => {
		expect(relevanceFromScore({ type: 'score', score: 2, legend: {}, probabilities: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.4 }, confidence: 0.4 })).toBeCloseTo(0.4);
		expect(relevanceFromScore({ type: 'score', score: 2, legend: {}, probabilities: { '2': 1 }, confidence: 1 })).toBe(0);
		expect(relevanceFromScore({ type: 'score', score: 0, legend: {}, probabilities: { '0': 1 }, confidence: 1 })).toBe(0);
	});

	it('rubric: the strongly-related level means the text discusses the note\'s own subject', () => {
		expect(RELEVANCE_LEVELS).toHaveLength(4);
		expect(RELEVANCE_LEVELS[3]).toMatch(/discusses the note's own subject/);
		expect(RELEVANCE_LEVELS[1]).toMatch(/only in passing/);
	});
});

describe('anchorSentences', () => {
	it('splits lines into sentences with line offsets, skipping frontmatter, code fences, list markers, and linked text', () => {
		const content = '---\ntags: [x]\n---\n# Heading here\n- First point. Second point!\n```\ncode line.\n```\nSee [[Other]] now.';
		const sentences = anchorSentences(content);
		expect(sentences.map((s) => s.text)).toEqual(['Heading here', 'First point.', 'Second point!']);
		const second = sentences[2];
		expect(second.lineNumber).toBe(4);
		expect(second.lineText.slice(second.startOffset, second.endOffset)).toBe('Second point!');
	});

	it('deduplicates repeated sentences and caps the count', () => {
		expect(anchorSentences('Same one.\nSame one.\nAnother.').map((s) => s.text)).toEqual(['Same one.', 'Another.']);
		expect(anchorSentences('A one. B two. C three.', 2)).toHaveLength(2);
	});
});

describe('SemanticMatcher two-lane behaviour (#558, #566)', () => {
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
		app.vault.getMarkdownFiles.mockReturnValue([source, mockFile('notes/ML Fundamentals.md'), mockFile('Gardening.md'), mockFile('notes/Deep Learning.md')]);
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

	const content = 'This note covers machine learning. It also trains neural nets.';
	const makeMatcher = () => new SemanticMatcher(app as unknown as App, () => settings);
	const laneOn = () => {
		settings.ai.systemOne.enabled = true;
		settings.ai.systemOne.apiKey = 'tsk-test';
	};

	it('lane off: zero lane calls, the full title list in the prompt, anchored model confidences', async () => {
		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[0][0]).toContain('ML Fundamentals\nGardening\nDeep Learning');
		expect(result.map((r) => [r.targetDisplayName, r.confidence, r.lane])).toEqual([['ML Fundamentals', 0.6, 'system-two'], ['Deep Learning', 0.6, 'system-two']]);
	});

	it('lane off: drops a match whose concept has no occurrence in the note', async () => {
		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(result.map((r) => r.targetDisplayName)).not.toContain('Gardening');
	});

	it('lane on: scores every title with its folder, anchors survivors on a sentence, and never calls complete()', async () => {
		laneOn();
		stubLane(
			(title) => (title === 'ML Fundamentals' ? 0.9 : title === 'Deep Learning' ? 0.7 : 0.1),
			(title, criteria) => sentenceWith(title === 'ML Fundamentals' ? 'machine learning' : 'neural nets', criteria),
		);
		const onSystemOne = vi.fn();

		const result = await makeMatcher().match(source, content, new Set(), 10, { onSystemOne });

		expect(complete).not.toHaveBeenCalled();
		const [scoreReq, anchorReq] = laneRequests();
		expect(scoreReq.state).toBe(content);
		expect(Object.keys(scoreReq.questions)).toEqual(['t0', 't1', 't2']);
		expect(scoreReq.questions.t0.criteria).toEqual(RELEVANCE_LEVELS);
		expect(scoreReq.questions.t0.instructions).toContain('"ML Fundamentals" (folder: "notes")');
		expect(scoreReq.questions.t1.instructions).toContain('(folder: vault root)');
		expect(Object.keys(anchorReq.questions)).toEqual(['a0', 'a1']);
		expect(anchorReq.questions.a0.type).toBe('choice');
		const criteria = anchorReq.questions.a0.criteria as Record<string, string | null>;
		expect(Object.keys(criteria)).toEqual(['s0', 's1', NO_ANCHOR]);
		expect([criteria.s0, criteria.s1]).toEqual(['This note covers machine learning.', 'It also trains neural nets.']);
		expect(result.map((r) => [r.targetDisplayName, r.confidence, r.matchedText, r.lane])).toEqual([
			['ML Fundamentals', 0.9, 'This note covers machine learning.', 'system-one'],
			['Deep Learning', 0.7, 'It also trains neural nets.', 'system-one'],
		]);
		expect(result[1].occurrences).toEqual([{ lineNumber: 0, lineText: content, startOffset: 35, endOffset: content.length }]);
		expect(onSystemOne).toHaveBeenCalledTimes(1);
	});

	it('lane on: drops a survivor whose anchor choice is <none>', async () => {
		laneOn();
		stubLane(() => 0.9, (title, criteria) => (title === 'Gardening' ? NO_ANCHOR : sentenceWith('machine', criteria)));

		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(result.map((r) => r.targetDisplayName)).toEqual(['ML Fundamentals', 'Deep Learning']);
	});

	it('lane on: related-but-not-strongly-related mass does not clear the threshold', async () => {
		laneOn();
		mockRequestUrl.mockImplementation((param) => {
			const body = JSON.parse(param.body as string) as LaneRequest;
			const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, {
				type: 'score', score: 2.4, legend: {}, probabilities: { '2': 0.6, '3': 0.4 }, confidence: 0.6,
			}]));
			return Promise.resolve({ status: 200, json: { answers, usage: {} }, text: '', headers: {} });
		});
		const onSystemOne = vi.fn();

		const result = await makeMatcher().match(source, content, new Set(), 10, { onSystemOne });

		expect(result).toEqual([]);
		expect(laneRequests()).toHaveLength(1);
		expect(complete).not.toHaveBeenCalled();
		expect(onSystemOne).toHaveBeenCalledTimes(1);
	});

	it('lane on: a transport error throws RemLaneError and makes no generative call', async () => {
		laneOn();
		mockRequestUrl.mockResolvedValue({ status: 529, json: { error: { message: 'overloaded' } }, text: '', headers: {} });
		vi.useFakeTimers();
		const onSystemOne = vi.fn();

		const pending = makeMatcher().match(source, content, new Set(), 10, { onSystemOne });
		const assertion = expect(pending).rejects.toBeInstanceOf(RemLaneError);
		await vi.runAllTimersAsync();
		await assertion;
		vi.useRealTimers();

		expect(complete).not.toHaveBeenCalled();
		expect(onSystemOne).not.toHaveBeenCalled();
	});

	it('excludes targets the note already links to before scoring', async () => {
		laneOn();
		stubLane(() => 0.9, (_title, criteria) => sentenceWith('machine', criteria));
		const linked = 'Already see [[ML Fundamentals]] and [[notes/Deep Learning|DL]].\nThis covers machine learning.';

		await makeMatcher().match(source, linked, new Set(), 10);

		const [scoreReq] = laneRequests();
		const asked = Object.values(scoreReq.questions).map((q) => /titled "(.+?)"/.exec(q.instructions)?.[1]);
		expect(asked).toEqual(['Gardening']);
	});

	it('excludes a resolved link target on the generative path', async () => {
		app.metadataCache.getFirstLinkpathDest.mockImplementation((p: string) => (p === 'ml' ? mockFile('notes/ML Fundamentals.md') : null));

		await makeMatcher().match(source, 'See [[ml]]. ' + content, new Set(), 10);

		expect(complete.mock.calls[0][0]).toContain('Vault note titles:\nGardening\nDeep Learning\n');
	});
});
