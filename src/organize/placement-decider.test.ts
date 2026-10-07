import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse, TFile, TFolder } from '../__mocks__/obsidian';
import {
	FIRST_ROUND_SUPPORT, KEEP_CURRENT_OPTION, NEW_DIRECTORY_OPTION, NONE_OPTION, PLACEMENT_MAJORITY, PlacementDecider,
	RUBRIC_MAX_CHARS, RUBRIC_TITLES, RUNOFF_SIZE, coalesceByBasename, folderRubric,
} from './placement-decider';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import type { App, TFolder as ObsidianTFolder } from 'obsidian';

const rubric = (folder?: TFolder): string | null => folderRubric(folder as unknown as ObsidianTFolder | undefined);

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;

const ESCAPES = [NEW_DIRECTORY_OPTION, KEEP_CURRENT_OPTION, NONE_OPTION];

/** Folder tree from directory paths; `notes` adds markdown basenames under a folder. */
function makeApp(directories: string[], notes: Record<string, string[]> = {}): App {
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
	for (const [dir, titles] of Object.entries(notes)) {
		const folder = byPath.get(dir);
		if (!folder) continue;
		for (const title of titles) folder.children.push(new TFile(`${dir}/${title}.md`));
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
	});

	it('returns null without calling the lane when filtering leaves no folders, the body is blank, or the vault is empty', async () => {
		stub(() => ({}));
		const hidden = new PlacementDecider(makeApp(['.synapse', '.trash']), makeSettings());
		expect(await hidden.decide('text', [], '')).toBeNull();
		expect(await new PlacementDecider(makeApp(['a']), makeSettings()).decide('   ', [], '')).toBeNull();
		expect(await new PlacementDecider(makeApp([]), makeSettings()).decide('text', [], '')).toBeNull();
		expect(await new PlacementDecider(makeApp(['inbox']), makeSettings()).decide('text', [], 'inbox')).toBeNull();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('offers the eligible folders minus the current one plus the three escape options, naming the current folder in the state', async () => {
		stub(() => ({ 'projects/ml': 0.7, projects: 0.2, [NEW_DIRECTORY_OPTION]: 0.05 }));
		const decider = new PlacementDecider(makeApp(['projects', 'projects/ml', 'journal']), makeSettings());

		const result = await decider.decide('Notes on gradient descent', ['#ml'], 'journal');

		expect(result).toEqual({ kind: 'existing', directoryPath: 'projects/ml', confidence: 0.7 });
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const [req] = requests();
		expect(Object.keys(req.questions)).toEqual(['p0']);
		expect(Object.keys(req.questions.p0.criteria)).toEqual(['projects', 'projects/ml', ...ESCAPES]);
		expect(req.questions.p0.criteria[KEEP_CURRENT_OPTION]).toBe('Leave the note in its current folder: journal.');
		expect(req.questions.p0.criteria[NONE_OPTION]).toBe('No listed folder fits; do not move the note.');
		expect(req.state).toContain('Notes on gradient descent');
		expect(req.state).toContain('Current folder: journal');
		expect(req.state).toContain('#ml');
	});

	it('names the vault root as the current folder for a root note', async () => {
		stub(() => ({ a: 1 }));
		await new PlacementDecider(makeApp(['a']), makeSettings()).decide('text', [], '');
		const [req] = requests();
		expect(req.state).toContain('Current folder: vault root');
		expect(req.questions.p0.criteria[KEEP_CURRENT_OPTION]).toBe('Leave the note in its current folder: vault root.');
	});

	describe('folder rubrics', () => {
		it('describes each folder by the notes it holds and leaves empty folders null', async () => {
			stub(() => ({ Media: 1 }));
			const app = makeApp(['Media', 'Empty', 'Health'], { Media: ['Dune', 'Blade Runner'], Health: ['Soluble Fiber'] });

			await new PlacementDecider(app, makeSettings()).decide('text', [], '');

			const { criteria } = requests()[0].questions.p0;
			expect(criteria.Media).toBe('Contains notes: "Dune", "Blade Runner"');
			expect(criteria.Health).toBe('Contains notes: "Soluble Fiber"');
			expect(criteria.Empty).toBeNull();
		});

		it(`quotes at most ${RUBRIC_TITLES} markdown titles, clips long titles, and stays under ${RUBRIC_MAX_CHARS} characters`, () => {
			const folder = new TFolder('Media');
			const long = 'A'.repeat(60);
			for (const name of [long, 'b', 'c', 'd', 'e', 'f']) folder.children.push(new TFile(`Media/${name}.md`));
			folder.children.push(new TFile('Media/picture.png'));

			const text = rubric(folder);

			expect(text).toBe(`Contains notes: "${'A'.repeat(39)}…", "b", "c", "d", "e"`);
			expect(text).not.toContain('picture');

			const wide = new TFolder('Wide');
			for (let i = 0; i < 5; i++) wide.children.push(new TFile(`Wide/${'x'.repeat(40)}${i}.md`));
			expect(rubric(wide)!.split('", "')).toHaveLength(5);
			expect(rubric(new TFolder('Nothing'))).toBeNull();
			expect(rubric(undefined)).toBeNull();
		});
	});

	describe('runoff', () => {
		const dirs = ['AI', 'artificial-intelligence', 'ai-agent', 'journalism', 'economics', 'cooking', 'travel', 'Projects', 'Project'];
		const firstRound: Record<string, number> = {
			AI: 0.3, 'artificial-intelligence': 0.2, 'ai-agent': 0.1, Projects: 0.09, Project: 0.08,
			journalism: 0.07, economics: 0.06, cooking: 0.05, travel: 0.03, [NEW_DIRECTORY_OPTION]: 0.02,
		};

		it(`carries the top ${RUNOFF_SIZE} folders into one runoff with the escape options, coalescing canonical basenames with summed mass`, async () => {
			stub((id) => (id === 'p0' ? firstRound : { AI: 0.6, 'artificial-intelligence': 0.3 }));
			const decider = new PlacementDecider(makeApp(dirs), makeSettings());

			const result = await decider.decide('text', [], '');

			expect(result).toEqual({ kind: 'existing', directoryPath: 'AI', confidence: 0.6 });
			const [, runoff] = requests();
			expect(Object.keys(runoff.questions)).toEqual(['runoff']);
			expect(Object.keys(runoff.questions.runoff.criteria)).toEqual(['AI', 'artificial-intelligence', 'ai-agent', 'Projects', ...ESCAPES]);
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

		it('sums probabilities across chunks past the option cap before the runoff', async () => {
			const many = Array.from({ length: 300 }, (_, i) => `folder-${i}`);
			const rounds: Record<string, Record<string, number>> = {
				p0: { 'folder-0': 0.7, 'folder-1': 0.3 },
				p1: { 'folder-260': 0.9, 'folder-261': 0.1 },
				runoff: { 'folder-260': 0.8, 'folder-0': 0.2 },
			};
			stub((id) => rounds[id]);
			const decider = new PlacementDecider(makeApp(many), makeSettings());

			const result = await decider.decide('text', [], '');

			expect(result).toEqual({ kind: 'existing', directoryPath: 'folder-260', confidence: 0.8 });
			const [first, runoff] = requests();
			expect(Object.keys(first.questions)).toEqual(['p0', 'p1']);
			expect(Object.keys(first.questions.p0.criteria)).toHaveLength(255);
			expect(Object.keys(first.questions.p1.criteria)).toEqual([...many.slice(252), ...ESCAPES]);
			expect(Object.keys(runoff.questions.runoff.criteria)).toEqual(['folder-260', 'folder-0', 'folder-1', 'folder-261', ...ESCAPES]);
		});
	});

	describe('decision rule', () => {
		const dirs = ['AI', 'artificial-intelligence', 'cooking', 'travel', 'journal', 'economics'];
		const firstRound = { AI: 0.3, 'artificial-intelligence': 0.25, cooking: 0.15, travel: 0.1, journal: 0.1, economics: 0.1 };

		function decideWith(runoff: Record<string, number>, threshold = 0.85) {
			stub((id) => (id === 'p0' ? firstRound : runoff));
			return new PlacementDecider(makeApp(dirs), makeSettings((s) => { s.organize.organizeConfidenceThreshold = threshold; })).decide('text', [], '');
		}

		it('<new-directory> at organize.organizeConfidenceThreshold wins even when an existing folder has a majority elsewhere', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.85, AI: 0.15 })).resolves.toEqual({ kind: 'new-directory', confidence: 0.85 });
		});

		it('<new-directory> just below the threshold yields to the leading existing folder', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.84, AI: 0.16 })).resolves.toEqual({ kind: 'undecided', leading: 'AI', confidence: 0.16 });
		});

		it(`an existing folder at PLACEMENT_MAJORITY (${PLACEMENT_MAJORITY}) with first-round support is accepted`, async () => {
			await expect(decideWith({ AI: 0.5, 'artificial-intelligence': 0.3, cooking: 0.2 })).resolves.toEqual({ kind: 'existing', directoryPath: 'AI', confidence: 0.5 });
		});

		it('an existing folder just below the majority is undecided with that folder leading', async () => {
			await expect(decideWith({ AI: 0.49, 'artificial-intelligence': 0.31, cooking: 0.2 })).resolves.toEqual({ kind: 'undecided', leading: 'AI', confidence: 0.49 });
		});

		it(`a runoff majority on a folder with first-round support below FIRST_ROUND_SUPPORT (${FIRST_ROUND_SUPPORT}) stays undecided`, async () => {
			await expect(decideWith({ cooking: 0.6, AI: 0.2, travel: 0.2 })).resolves.toEqual({ kind: 'undecided', leading: 'cooking', confidence: 0.6 });
		});

		it('<keep-current> beating every folder keeps the note in place', async () => {
			await expect(decideWith({ [KEEP_CURRENT_OPTION]: 0.45, AI: 0.4, cooking: 0.15 })).resolves.toEqual({ kind: 'keep', confidence: 0.45 });
		});

		it('<none> beating every folder keeps the note in place even when a folder would otherwise lead', async () => {
			await expect(decideWith({ [NONE_OPTION]: 0.5, AI: 0.3, [KEEP_CURRENT_OPTION]: 0.2 })).resolves.toEqual({ kind: 'keep', confidence: 0.5 });
		});

		it('a tie between an escape option and the leading folder goes to the folder', async () => {
			await expect(decideWith({ [NONE_OPTION]: 0.3, AI: 0.3, cooking: 0.4 })).resolves.toEqual({ kind: 'undecided', leading: 'cooking', confidence: 0.4 });
		});

		it('reads the threshold live from settings', async () => {
			await expect(decideWith({ [NEW_DIRECTORY_OPTION]: 0.6, AI: 0.4 }, 0.6)).resolves.toEqual({ kind: 'new-directory', confidence: 0.6 });
		});
	});

	it('propagates lane errors to the caller', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401, json: { error: { message: 'bad key' } }, text: '', headers: {} });
		const decider = new PlacementDecider(makeApp(['a']), makeSettings());
		await expect(decider.decide('text', [], '')).rejects.toMatchObject({ reason: 'unauthorized' });
	});
});
