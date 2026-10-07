import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse, TFolder, TFile as MockTFile } from '../__mocks__/obsidian';
import { OrganizeModule } from './index';
import { OrganizeStore } from './organize-store';
import { ContentAnalyzer } from './content-analyzer';
import { DirectoryMatcher } from './directory-matcher';
import { NEW_DIRECTORY_OPTION } from './placement-decider';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import { AIClient, NoteOperationQueue } from '../shared';
import type { App, Plugin, TFile } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam) => Promise<Partial<RequestUrlResponse>>
>;
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;
const TOPICS = JSON.stringify([{ label: 'machine learning', confidence: 0.95 }]);

function laneOn(s: SynapseSettings): void {
	s.ai.systemOne.enabled = true;
	s.ai.systemOne.apiKey = 'tsk-test';
}

function buildTree(directories: string[]): TFolder {
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
	return root;
}

/** Answer every choice question with `pick` at `probability` (default 0.95); the rest of the mass is spread evenly over the other options. */
function stubLane(pick: string, probability = 0.95): void {
	mockRequestUrl.mockImplementation((param) => {
		const body = JSON.parse(param.body as string) as { questions: Record<string, { criteria: Record<string, unknown> }> };
		const answers: Record<string, unknown> = {};
		for (const [id, q] of Object.entries(body.questions)) {
			const options = Object.keys(q.criteria);
			const rest = (1 - probability) / Math.max(1, options.length - 1);
			const probabilities = Object.fromEntries(options.map((o) => [o, o === pick ? probability : rest]));
			const [choice, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
			answers[id] = { type: 'choice', choice, confidence, probabilities };
		}
		return Promise.resolve({ status: 200, json: { answers, usage: { input_tokens: 1, output_tokens: 1 } }, text: '', headers: {} });
	});
}

describe('DirectoryMatcher.determineAction with a placement (#558)', () => {
	const matcher = () => new DirectoryMatcher({ vault: { getRoot: () => buildTree(['a', 'b']) } } as unknown as App);

	it('moves to an existing placement without scoring', () => {
		const action = matcher().determineAction({ notePath: 'inbox/n.md', topics: [], tags: [], links: [], placement: { kind: 'existing', directoryPath: 'b', confidence: 0.9 } });
		expect(action).toEqual({ type: 'move', targetDirectory: 'b' });
	});

	it('a new-directory placement names the lane in the proposal reasoning', () => {
		const action = matcher().determineAction({ notePath: 'inbox/n.md', topics: [{ label: 'cooking', confidence: 0.95 }], tags: [], links: [], placement: { kind: 'new-directory', confidence: 0.9 } });
		expect(action).toMatchObject({ type: 'propose-new-directory', targetDirectory: 'cooking' });
		expect((action as { reasoning: string }).reasoning).toContain('System 1 lane found no existing folder fits (90%)');
	});

	it('an undecided placement never yields a new-directory proposal when the caller forbids one', () => {
		const action = matcher().determineAction(
			{ notePath: 'inbox/n.md', topics: [{ label: 'cooking', confidence: 0.95 }], tags: [], links: [], placement: { kind: 'undecided', leading: 'a', confidence: 0.4 } },
			undefined,
			undefined,
			{ allowNewDirectory: false },
		);
		expect(action).toEqual({ type: 'move', targetDirectory: 'inbox' });
	});
});

describe('ContentAnalyzer.resolvePlacement two-lane behaviour (#558)', () => {
	let complete: MockInstance<typeof AIClient.prototype.complete>;
	let settings: SynapseSettings;

	function makeAnalyzer(dirs: string[]): ContentAnalyzer {
		const app = createMockApp();
		(app.vault as unknown as { getRoot: () => TFolder }).getRoot = () => buildTree(dirs);
		return new ContentAnalyzer(app as unknown as App, () => settings);
	}

	beforeEach(() => {
		mockRequestUrl.mockReset();
		settings = structuredClone(DEFAULT_SETTINGS);
		complete = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue(TOPICS);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('toggle off: zero lane calls and the generative topics, unchanged', async () => {
		const result = await makeAnalyzer(['a']).resolvePlacement('body', []);
		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ topics: [{ label: 'machine learning', confidence: 0.95 }], lane: 'system-two' });
	});

	it('toggle on, majority on an existing folder: placement with no complete() call and the lane reported', async () => {
		laneOn(settings);
		stubLane('projects/ml');
		const onSystemOne = vi.fn();

		const result = await makeAnalyzer(['projects', 'projects/ml']).resolvePlacement('body', ['#ml'], { onSystemOne });

		expect(complete).not.toHaveBeenCalled();
		expect(result).toEqual({ topics: [], placement: { kind: 'existing', directoryPath: 'projects/ml', confidence: 0.95 }, lane: 'system-one' });
		expect(onSystemOne).toHaveBeenCalledTimes(1);
	});

	it('a leading folder without a majority is undecided: topics extracted, the lane answer carried, no lane credit', async () => {
		laneOn(settings);
		stubLane('projects', 0.49);
		const onSystemOne = vi.fn();

		const result = await makeAnalyzer(['projects', 'inbox']).resolvePlacement('body', [], { onSystemOne });

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			topics: [{ label: 'machine learning', confidence: 0.95 }],
			placement: { kind: 'undecided', leading: 'projects', confidence: 0.49 },
			lane: 'system-two',
		});
		expect(onSystemOne).not.toHaveBeenCalled();
	});

	it('<new-directory> at the organize threshold escalates to topic extraction with the request recorded', async () => {
		laneOn(settings);
		settings.organize.organizeConfidenceThreshold = 0.9;
		stubLane(NEW_DIRECTORY_OPTION, 0.9);

		const result = await makeAnalyzer(['projects']).resolvePlacement('body', []);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			topics: [{ label: 'machine learning', confidence: 0.95 }],
			placement: { kind: 'new-directory', confidence: 0.9 },
			lane: 'system-two',
		});
	});

	it('<new-directory> below the organize threshold is not a new-folder request; the leading folder is undecided', async () => {
		laneOn(settings);
		settings.organize.organizeConfidenceThreshold = 0.9;
		stubLane(NEW_DIRECTORY_OPTION, 0.6);

		const result = await makeAnalyzer(['projects']).resolvePlacement('body', []);

		expect(result.placement).toEqual({ kind: 'undecided', leading: 'projects', confidence: 0.4 });
		expect(result.lane).toBe('system-two');
	});

	it('transport error: falls back to the generative path exactly once', async () => {
		laneOn(settings);
		mockRequestUrl.mockResolvedValue({ status: 500, json: { error: { message: 'boom' } }, text: '', headers: {} });

		const result = await makeAnalyzer(['projects']).resolvePlacement('body', []);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result.lane).toBe('system-two');
	});
});

describe('OrganizeModule with the System 1 lane (#558)', () => {
	let settings: SynapseSettings;
	let finish: ReturnType<typeof vi.fn>;
	let mod: OrganizeModule;
	let app: ReturnType<typeof createMockApp>;
	let complete: MockInstance<typeof AIClient.prototype.complete>;
	let note: TFile;
	let rename: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		mockRequestUrl.mockReset();
		settings = structuredClone(DEFAULT_SETTINGS);
		laneOn(settings);
		note = mockFile('inbox/a.md');
		app = createMockApp();
		rename = vi.fn().mockResolvedValue(undefined);
		(app.vault as unknown as { getRoot: () => TFolder; rename: typeof rename }).getRoot = () => buildTree(['inbox', 'projects', 'projects/ml']);
		(app.vault as unknown as { rename: typeof rename }).rename = rename;
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		app.vault.getMarkdownFiles.mockReturnValue([note]);
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === note.path ? note : null));
		app.vault.read.mockImplementation(async (_f: MockTFile) => 'Notes on training a model');
		finish = vi.fn();
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};
		vi.spyOn(OrganizeStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'saveProposal').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'saveSnapshot').mockResolvedValue(undefined);
		vi.spyOn(OrganizeStore.prototype, 'loadPendingProposals').mockResolvedValue([]);
		complete = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue(TOPICS);
		mod = new OrganizeModule(
			makeModuleDeps({
				plugin: { app } as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: createMockCheckpointManager() as never,
				registrar: { register: vi.fn() } as never,
				noteQueue: new NoteOperationQueue(),
			}),
			() => false
		);
		await mod.onload();
	});
	afterEach(() => vi.restoreAllMocks());

	it('proposes a move into a confident existing folder, never renaming, and names the lane in the finish notice', async () => {
		stubLane('projects/ml');

		const result = await mod.organizeNote(note);

		expect(complete).not.toHaveBeenCalled();
		expect(result?.proposalCreated).toBe(true);
		expect(result?.movedDirectly).toBe(false);
		expect(result?.placement).toBe('existing');
		expect(rename).not.toHaveBeenCalled();
		expect(OrganizeStore.prototype.saveProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposedDirectory: 'projects/ml',
			proposalKind: 'move',
			lane: 'system-one',
			reasoning: 'The System 1 lane placed this note in "projects/ml" with 95% of the runoff.',
		}));
		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposed move to projects/ml — decided by the System 1 lane');
	});

	it('treats a confident pick of the current folder as already placed', async () => {
		stubLane('inbox');

		const result = await mod.organizeNote(note);

		expect(result).toBeNull();
		expect(rename).not.toHaveBeenCalled();
		expect(finish.mock.calls.at(-1)?.[0]).toBe('No organization needed — decided by the System 1 lane');
	});

	it('<new-directory> at the threshold keeps the propose-new-folder path and does not claim the lane', async () => {
		stubLane(NEW_DIRECTORY_OPTION);

		const result = await mod.organizeNote(note);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result?.proposalCreated).toBe(true);
		expect(result?.placement).toBe('new-directory');
		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposal created for new directory');
	});

	it('an existing folder leading without a majority never produces a new-folder proposal', async () => {
		stubLane('projects', 0.4);

		const result = await mod.organizeNote(note);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result).toBeNull();
		expect(rename).not.toHaveBeenCalled();
		expect(OrganizeStore.prototype.saveProposal).not.toHaveBeenCalled();
		expect(finish.mock.calls.at(-1)?.[0]).toBe('No organization needed');
	});

	it('an undecided lane still lets System 2 propose a move into a folder that scores above the move threshold', async () => {
		stubLane('projects', 0.4);
		complete.mockResolvedValue(JSON.stringify([{ label: 'projects', confidence: 0.8 }]));

		const result = await mod.organizeNote(note);

		expect(result?.proposalCreated).toBe(true);
		expect(result?.movedDirectly).toBe(false);
		expect(result?.placement).toBe('undecided');
		expect(rename).not.toHaveBeenCalled();
		expect(OrganizeStore.prototype.saveProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposedDirectory: 'projects',
			proposalKind: 'move',
			lane: 'system-two',
		}));
		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposed move to projects');
	});

	it('suggestDirectory returns the placed folder for deep-dive auto-organize', async () => {
		stubLane('projects');
		expect(await mod.suggestDirectory('A new deep dive about projects')).toBe('projects');
		expect(complete).not.toHaveBeenCalled();
	});
});
