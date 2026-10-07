import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { OrganizeModule } from './index';
import { describeRun, emptyTally, tallyResult } from './run-summary';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NoteOperationQueue } from '../shared';
import { TFile as MockTFile, TFolder } from '../__mocks__/obsidian';
import type { TFile } from 'obsidian';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';

vi.mock('./content-analyzer', () => ({
	ContentAnalyzer: class MockContentAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		analyze = vi.fn(async (file: MockTFile) => ({
			notePath: file.path,
			topics: [{ label: 'media', confidence: 0.8 }],
			tags: [],
			links: [],
			lane: 'system-two',
		}));
	},
}));

vi.mock('./directory-matcher', () => ({
	DirectoryMatcher: class MockDirectoryMatcher {
		constructor(_app: unknown) {}
		scoreDirectories = vi.fn().mockReturnValue([]);
		determineAction = vi.fn().mockReturnValue({ type: 'move', targetDirectory: 'Media' });
	},
}));

describe('run summary', () => {
	it('describes proposals by kind and reports failures', () => {
		const tally = emptyTally();
		tallyResult(tally, { notePath: 'a.md', action: { type: 'move', targetDirectory: 'Media' }, proposalCreated: true, movedDirectly: false }, 'a.md');
		tallyResult(tally, { notePath: 'b.md', action: { type: 'move', targetDirectory: 'Media' }, proposalCreated: true, movedDirectly: false }, 'b.md');
		tallyResult(tally, { notePath: 'c.md', action: { type: 'propose-new-directory', targetDirectory: 'cooking', reasoning: '' }, proposalCreated: true, movedDirectly: false }, 'c.md');
		tallyResult(tally, null, 'd.md');
		tally.errors = 1;

		expect(describeRun(tally)).toBe('3 proposals (2 to existing folders, 1 new folder), 1 failed');
		expect(tally.moveRecords).toEqual([]);
		expect(describeRun(emptyTally())).toBe('No changes needed');
	});

	it('records a move only for auto-accepted proposals', () => {
		const tally = emptyTally();
		tallyResult(tally, { notePath: 'inbox/a.md', action: { type: 'move', targetDirectory: 'Media' }, proposalCreated: true, movedDirectly: true, autoAccepted: true }, 'inbox/a.md');
		expect(tally.autoAccepted).toBe(1);
		expect(tally.moveRecords).toEqual([{ originalPath: 'inbox/a.md', newPath: 'Media/a.md' }]);
		expect(describeRun(tally)).toBe('1 proposal (1 to existing folder)');
	});
});

describe('relocations into existing folders are proposals', () => {
	let adapterFiles: Map<string, string>;
	let settings: SynapseSettings;
	let renameSpy: Mock<(file: TFile, newPath: string) => Promise<void>>;
	let createFolderSpy: Mock<(path: string) => Promise<void>>;
	let finish: Mock<(message?: string, action?: unknown) => void>;
	let notifications: Record<string, Mock>;
	let note: TFile;
	let mod: OrganizeModule;
	let autoAccept: boolean;

	function build(): OrganizeModule {
		const adapter = {
			read: vi.fn(async (path: string) => {
				if (!adapterFiles.has(path)) throw new Error(`ENOENT: ${path}`);
				return adapterFiles.get(path)!;
			}),
			write: vi.fn(async (path: string, content: string) => { adapterFiles.set(path, content); }),
			exists: vi.fn(async (path: string) => {
				if (adapterFiles.has(path)) return true;
				for (const key of adapterFiles.keys()) if (key.startsWith(path + '/')) return true;
				return false;
			}),
			remove: vi.fn(async (path: string) => { adapterFiles.delete(path); }),
			list: vi.fn(async (folder: string) => {
				const out: string[] = [];
				for (const key of adapterFiles.keys()) if (key.startsWith(folder + '/')) out.push(key);
				return { files: out, folders: [] };
			}),
		};
		renameSpy = vi.fn(async (file: TFile, newPath: string) => { file.path = newPath; });
		createFolderSpy = vi.fn(async () => undefined);
		const plugin = {
			app: {
				vault: {
					adapter,
					rename: renameSpy,
					createFolder: createFolderSpy,
					getMarkdownFiles: vi.fn(() => [note]),
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path === note.path) return note;
						if (path === 'Media' || path.startsWith('.synapse')) return new TFolder(path);
						return null;
					}),
					read: vi.fn(async () => 'A note about films'),
					create: vi.fn(async (path: string, content: string) => { adapterFiles.set(path, content); return new MockTFile(path); }),
					process: vi.fn(async () => undefined),
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
		return new OrganizeModule(
			makeModuleDeps({
				plugin: plugin as never,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: createMockCheckpointManager() as never,
				registrar: { register: vi.fn() } as never,
				noteQueue: new NoteOperationQueue(),
			}),
			() => autoAccept
		);
	}

	function savedProposals(): Array<Record<string, unknown>> {
		return [...adapterFiles.entries()]
			.filter(([k]) => k.startsWith('.synapse/organize/proposals/'))
			.map(([, v]) => JSON.parse(v) as Record<string, unknown>);
	}

	function savedSnapshots(): Array<Record<string, unknown>> {
		return [...adapterFiles.entries()]
			.filter(([k]) => k.startsWith('.synapse/organize/snapshots/'))
			.map(([, v]) => JSON.parse(v) as Record<string, unknown>);
	}

	beforeEach(async () => {
		adapterFiles = new Map();
		settings = structuredClone(DEFAULT_SETTINGS);
		autoAccept = false;
		note = new MockTFile('inbox/film.md') as unknown as TFile;
		finish = vi.fn();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};
		mod = build();
		await mod.onload();
	});

	afterEach(() => vi.restoreAllMocks());

	it('a scan with auto-accept off leaves move proposals pending and never renames', async () => {
		const count = await mod.scanDirectory(undefined, true);

		expect(count).toBe(1);
		expect(renameSpy).not.toHaveBeenCalled();
		expect(savedSnapshots()).toEqual([]);
		expect(savedProposals()).toEqual([expect.objectContaining({
			sourceNotePath: 'inbox/film.md',
			proposedDirectory: 'Media',
			proposalKind: 'move',
			lane: 'system-two',
			status: 'pending',
			reasoning: 'Existing folder "Media" best matches this note\'s topics: "media".',
		})]);
		expect(finish.mock.calls.at(-1)?.[0]).toBe('1 proposal (1 to existing folder)');
	});

	it('a scan with auto-accept on moves the note, stamps the snapshot with the checkpoint id, and writes one summary', async () => {
		autoAccept = true;

		await mod.scanDirectory(undefined, true);

		expect(renameSpy).toHaveBeenCalledTimes(1);
		expect(renameSpy.mock.calls[0][1]).toBe('Media/film.md');
		expect(savedProposals()[0].status).toBe('accepted');
		expect(savedSnapshots()).toEqual([expect.objectContaining({ currentPath: 'Media/film.md', originalPath: 'inbox/film.md', runId: 'mockcheckpoint' })]);
		expect(notifications.info).toHaveBeenCalledWith('Auto-accepted 1 organize proposal (notes moved)');
		const summaries = [...adapterFiles.keys()].filter((k) => k.endsWith('-organize-summary.md'));
		expect(summaries).toHaveLength(1);
	});

	it('the single-note command proposes instead of moving and says so', async () => {
		const result = await mod.organizeNote(note);

		expect(result?.proposalCreated).toBe(true);
		expect(result?.movedDirectly).toBe(false);
		expect(renameSpy).not.toHaveBeenCalled();
		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposed move to Media');
	});

	it('accepting a move proposal renames into the existing folder without creating it', async () => {
		await mod.organizeNote(note);
		const [proposal] = savedProposals();

		await mod.acceptProposal(proposal.id as string);

		expect(createFolderSpy).not.toHaveBeenCalledWith('Media');
		expect(renameSpy).toHaveBeenCalledWith(note, 'Media/film.md');
		expect(savedSnapshots()[0]).toMatchObject({ originalPath: 'inbox/film.md', currentPath: 'Media/film.md' });
		expect(typeof savedSnapshots()[0].runId).toBe('string');
		expect(notifications.success).toHaveBeenCalledWith('Moved to Media');
	});
});
