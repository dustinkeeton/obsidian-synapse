import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse, TFolder } from '../__mocks__/obsidian';
import { NEW_DIRECTORY_OPTION, PLACEMENT_MAJORITY, PlacementDecider, RUNOFF_SIZE, coalesceByBasename } from './placement-decider';
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

function makeSettings(mutate?: (s: SynapseSettings) => void): () => SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	s.ai.systemOne.enabled = true;
	s.ai.systemOne.apiKey = 'tsk-test';
	s.organize.organizeConfidenceThreshold = 0.85;
	mutate?.(s);
	return () => s;
}

interface Question { instructions: string; criteria: Record<string, unknown> }

function requests(): Array<{ state: string; questions: Record<string, Question> }> {
	return mockRequestUrl.mock.calls.map(([p]) => JSON.parse(p.body as string) as { state: string; questions: Record<string, Question> });
}

/** Answer each choice question with the probabilities `pick(id, options)` returns (unlisted options get 0). */
function stub(pick: (id: string, options: string[]) => Record<string, number>): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as { questions: Record<string, Question> };
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			const options = Object.keys(q.criteria);
			const given = pick(id, options);
			const probabilities = Object.fromEntries(options.map((o) => [o, given[o] ?? 0]));
			const [choice, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
			answers[id] = { type: 'choice', choice, confidence, probabilities };
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

	describe('candidateDirectories', () => {
		it('drops hidden folders and folders covered by organize exclusions, keeping the rest in vault order', () => {
			const decider = new PlacementDecider(
				makeApp(['.synapse', '.synapse/organize', 'AI/.meta', 'templates', 'templates/daily', 'attachments', 'Excluded/old', 'inbox', 'AI']),
				makeSettings((s) => {
					s.exclusions = [
						{ pattern: 'templates/**', features: 'all' },
						{ pattern: 'attachments', features: ['organize'] },
						{ pattern: 'Excluded/**', features: ['enrichment'] },
					];
				}),
			);

			expect(decider.candidateDirectories()).toEqual(['AI', 'Excluded', 'Excluded/old', 'inbox']);
		});

		it('keeps the note\'s own folder as an option', () => {
			const decider = new PlacementDecider(makeApp(['inbox', 'projects']), makeSettings());
			expect(decider.candidateDirectories()).toContain('inbox');
		});
	});

	it('returns null without calling the lane when filtering leaves no folders, the body is blank, or the vault is empty', async () => {
		stub(() => ({}));
		const hidden = new PlacementDecider(makeApp(['.synapse', '.trash']), makeSettings());
		expect(await hidden.decide('text', [])).toBeNull();
		expect(await new PlacementDecider(makeApp(['a']), makeSettings()).decide('   ', [])).toBeNull();
		expect(await new PlacementDecider(makeApp([]), makeSettings()).decide('text', [])).toBeNull();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('asks one choice over the eligible folders plus <new-directory> and settles a small vault in that round', async () => {
		stub(() => ({ 'projects/ml': 0.7, projects: 0.2, journal: 0.05, [NEW_DIRECTORY_OPTION]: 0.05 }));
		const decider = new PlacementDecider(makeApp(['projects', 'projects/ml', 'journal']), makeSettings());

		const result = await decider.decide('Notes on gradient descent', ['#ml']);

		expect(result).toEqual({ kind: 'existing', directoryPath: 'projects/ml', confidence: 0.7 });
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const [req] = requests();
		expect(Object.keys(req.questions)).toEqual(['p0']);
		expect(Object.keys(req.questions.p0.criteria)).toEqual(['projects', 'projects/ml', 'journal', NEW_DIRECTORY_OPTION]);
		expect(req.state).toContain('Notes on gradient descent');
		expect(req.state).toContain('#ml');
	});

	describe('runoff', () => {
		const dirs = ['AI', 'artificial-intelligence', 'ai-agent', 'journalism', 'economics', 'cooking', 'travel', 'Projects', 'Project'];
		const firstRound: Record<string, number> = {
			AI: 0.3, 'artificial-intelligence': 0.2, 'ai-agent': 0.1, Projects: 0.09, Project: 0.08,
			journalism: 0.07, economics: 0.06, cooking: 0.05, travel: 0.03, [NEW_DIRECTORY_OPTION]: 0.02,
		};

		it(`carries the top ${RUNOFF_SIZE} folders into one runoff, coalescing canonical basenames with summed mass`, async () => {
			stub((id) => (id === 'p0' ? firstRound : { AI: 0.6, 'artificial-intelligence': 0.3 }));
			const decider = new PlacementDecider(makeApp(dirs), makeSettings());

			const result = await decider.decide('text', []);

			expect(result).toEqual({ kind: 'existing', directoryPath: 'AI', confidence: 0.6 });
			const [, runoff] = requests();
			expect(Object.keys(runoff.questions)).toEqual(['runoff']);
			expect(Object.keys(runoff.questions.runoff.criteria)).toEqual(['AI', 'artificial-intelligence', 'ai-agent', 'Projects', NEW_DIRECTORY_OPTION]);
		});

		it('coalesceByBasename sums probabilities and keeps the first path as representative', () => {
			const merged = coalesceByBasename([
				{ directoryPath: 'Projects', probability: 0.09 },
				{ directoryPath: 'AI', probability: 0.3 },
				{ directoryPath: 'archive/project', probability: 0.08 },
				{ directoryPath: 'ai', probability: 0.1 },
			]);

			expect(merged.map((o) => o.directoryPath)).toEqual(['Projects', 'AI']);
			expect(merged[0].probability).toBeCloseTo(0.17, 10);
			expect(merged[1].probability).toBeCloseTo(0.4, 10);
		});

		it('sums probabilities across chunks past the 255-option cap before the runoff', async () => {
			const many = Array.from({ length: 300 }, (_, i) => `folder-${i}`);
			const rounds: Record<string, Record<string, number>> = {
				p0: { 'folder-0': 0.7, 'folder-1': 0.3 },
				p1: { 'folder-260': 0.9, 'folder-261': 0.1 },
				runoff: { 'folder-260': 0.8, 'folder-0': 0.2 },
			};
			stub((id) => rounds[id]);
			const decider = new PlacementDecider(makeApp(many), makeSettings());

			const result = await decider.decide('text', []);

			expect(result).toEqual({ kind: 'existing', directoryPath: 'folder-260', confidence: 0.8 });
			const [first, runoff] = requests();
			expect(Object.keys(first.questions)).toEqual(['p0', 'p1']);
			expect(Object.keys(first.questions.p0.criteria)).toHaveLength(255);
			expect(Object.keys(first.questions.p1.criteria)).toEqual([...many.slice(254), NEW_DIRECTORY_OPTION]);
			expect(Object.keys(runoff.questions.runoff.criteria)).toEqual(['folder-260', 'folder-0', 'folder-1', 'folder-261', NEW_DIRECTORY_OPTION]);
		});
	});

	describe('decision rule', () => {
		const dirs = ['AI', 'artificial-intelligence', 'cooking', 'travel', 'journal', 'economics'];
		const firstRound = { AI: 0.3, 'artificial-intelligence': 0.25, cooking: 0.15, travel: 0.1, journal: 0.1, economics: 0.1 };

		function decideWith(runoff: Record<string, number>, threshold = 0.85) {
			stub((id) => (id === 'p0' ? firstRound : runoff));
			return new PlacementDecider(makeApp(dirs), makeSettings((s) => { s.organize.organizeConfidenceThreshold = threshold; })).decide('text', []);
		}

		it('<new-directory> at organize.organizeConfidenceThreshold wins even when an existing folder has a majority elsewhere', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.85, AI: 0.15 })).resolves.toEqual({ kind: 'new-directory', confidence: 0.85 });
		});

		it('<new-directory> just below the threshold yields to the leading existing folder', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.84, AI: 0.16 })).resolves.toEqual({ kind: 'undecided', leading: 'AI', confidence: 0.16 });
		});

		it(`an existing folder at PLACEMENT_MAJORITY (${PLACEMENT_MAJORITY}) is accepted`, async () => {
			await expect(decideWith({ AI: 0.5, 'artificial-intelligence': 0.3, cooking: 0.2 })).resolves.toEqual({ kind: 'existing', directoryPath: 'AI', confidence: 0.5 });
		});

		it('an existing folder just below the majority is undecided with that folder leading', async () => {
			await expect(decideWith({ AI: 0.49, 'artificial-intelligence': 0.31, cooking: 0.2 })).resolves.toEqual({ kind: 'undecided', leading: 'AI', confidence: 0.49 });
		});

		it('reads the threshold live from settings', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.6, AI: 0.4 }, 0.6)).resolves.toEqual({ kind: 'new-directory', confidence: 0.6 });
		});
	});

	it('propagates lane errors to the caller', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401, json: { error: { message: 'bad key' } }, text: '', headers: {} });
		const decider = new PlacementDecider(makeApp(['a']), makeSettings());
		await expect(decider.decide('text', [])).rejects.toMatchObject({ reason: 'unauthorized' });
	});
});
