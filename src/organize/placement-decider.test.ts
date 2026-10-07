import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse, TFolder } from '../__mocks__/obsidian';
import { NEW_DIRECTORY_OPTION, PlacementDecider } from './placement-decider';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import type { App } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;

function makeApp(directories: string[]): App {
	const root = new TFolder('/');
	root.isRoot = () => true;
	const byPath = new Map<string, TFolder>([['/', root]]);
	for (const dirPath of directories) {
		let current = root;
		let acc = '';
		for (const part of dirPath.split('/')) {
			acc = acc ? `${acc}/${part}` : part;
			if (!byPath.has(acc)) {
				const folder = new TFolder(acc);
				folder.parent = current;
				byPath.set(acc, folder);
				current.children.push(folder);
			}
			current = byPath.get(acc) as TFolder;
		}
	}
	return { vault: { getRoot: () => root } } as unknown as App;
}

function makeSettings(): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	s.ai.systemOne.enabled = true;
	s.ai.systemOne.apiKey = 'tsk-test';
	return s;
}

interface Question { instructions: string; criteria: Record<string, unknown> }

function requests(): Array<{ state: string; questions: Record<string, Question> }> {
	return mockRequestUrl.mock.calls.map(([p]) => JSON.parse(p.body as string) as { state: string; questions: Record<string, Question> });
}

/** Answer each choice question by picking `pick(id, options)`. */
function stub(pick: (id: string, options: string[]) => { choice: string; confidence: number }): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as { questions: Record<string, Question> };
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			const options = Object.keys(q.criteria);
			const { choice, confidence } = pick(id, options);
			answers[id] = { type: 'choice', choice, confidence, probabilities: Object.fromEntries(options.map((o) => [o, o === choice ? confidence : 0])) };
		}
		return Promise.resolve({ status: 200, json: { answers, usage: { input_tokens: 1, output_tokens: 1 } }, text: '', headers: {} });
	});
}

describe('PlacementDecider (#558)', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('asks one choice over every existing folder plus <new-directory> and returns the chosen folder', async () => {
		stub(() => ({ choice: 'projects/ml', confidence: 0.93 }));
		const decider = new PlacementDecider(makeApp(['projects', 'projects/ml', 'journal']), makeSettings);

		const result = await decider.decide('Notes on gradient descent', ['#ml']);

		expect(result).toEqual({ directoryPath: 'projects/ml', confidence: 0.93 });
		const [req] = requests();
		expect(Object.keys(req.questions)).toEqual(['p0']);
		expect(Object.keys(req.questions.p0.criteria)).toEqual(['projects', 'projects/ml', 'journal', NEW_DIRECTORY_OPTION]);
		expect(req.state).toContain('Notes on gradient descent');
		expect(req.state).toContain('#ml');
	});

	it('returns null when the lane picks <new-directory>', async () => {
		stub(() => ({ choice: NEW_DIRECTORY_OPTION, confidence: 0.9 }));
		const decider = new PlacementDecider(makeApp(['a', 'b']), makeSettings);
		expect(await decider.decide('text', [])).toBeNull();
	});

	it('returns null for an unknown folder, an empty body, or a vault with no folders without calling the lane', async () => {
		stub(() => ({ choice: 'nope', confidence: 0.9 }));
		expect(await new PlacementDecider(makeApp(['a']), makeSettings).decide('text', [])).toBeNull();
		mockRequestUrl.mockClear();
		expect(await new PlacementDecider(makeApp(['a']), makeSettings).decide('   ', [])).toBeNull();
		expect(await new PlacementDecider(makeApp([]), makeSettings).decide('text', [])).toBeNull();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('splits more than 254 folders across questions and settles competing winners in a second round', async () => {
		const dirs = Array.from({ length: 300 }, (_, i) => `folder-${i}`);
		stub((id, options) => {
			if (id === 'final') return { choice: 'folder-260', confidence: 0.88 };
			return { choice: options[0], confidence: 0.7 };
		});
		const decider = new PlacementDecider(makeApp(dirs), makeSettings);

		const result = await decider.decide('text', []);

		expect(result).toEqual({ directoryPath: 'folder-260', confidence: 0.88 });
		const [first, second] = requests();
		expect(Object.keys(first.questions)).toEqual(['p0', 'p1']);
		expect(Object.keys(first.questions.p0.criteria)).toHaveLength(255);
		expect(Object.keys(first.questions.p1.criteria)).toEqual([...dirs.slice(254), NEW_DIRECTORY_OPTION]);
		expect(Object.keys(second.questions.final.criteria)).toEqual(['folder-0', 'folder-254', NEW_DIRECTORY_OPTION]);
	});

	it('skips the second round when only one chunk picks an existing folder', async () => {
		const dirs = Array.from({ length: 300 }, (_, i) => `folder-${i}`);
		stub((id) => (id === 'p1' ? { choice: 'folder-299', confidence: 0.9 } : { choice: NEW_DIRECTORY_OPTION, confidence: 0.9 }));
		const decider = new PlacementDecider(makeApp(dirs), makeSettings);

		expect(await decider.decide('text', [])).toEqual({ directoryPath: 'folder-299', confidence: 0.9 });
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('propagates lane errors to the caller', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401, json: { error: { message: 'bad key' } }, text: '', headers: {} });
		const decider = new PlacementDecider(makeApp(['a']), makeSettings);
		await expect(decider.decide('text', [])).rejects.toMatchObject({ reason: 'unauthorized' });
	});
});
