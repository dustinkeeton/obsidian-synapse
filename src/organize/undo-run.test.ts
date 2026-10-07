import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { OrganizeModule } from './index';
import { RUN_WINDOW_MS, buildUndoSummaryPath, generateUndoSummary, selectLastRun } from './undo-run';
import type { OrganizeSnapshot } from './types';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NoteOperationQueue } from '../shared';
import type { Checkpoint } from '../shared';
import { TFile, TFolder } from '../__mocks__/obsidian';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';

const { confirmResult } = vi.hoisted(() => ({ confirmResult: vi.fn<() => Promise<boolean>>() }));
vi.mock('../shared/confirm-modal', () => ({
	ConfirmModal: vi.fn(function (this: { openAndConfirm: () => Promise<boolean> }) {
		this.openAndConfirm = confirmResult;
	}),
}));

function snapshot(currentPath: string, originalPath: string, movedAt: string, runId?: string): OrganizeSnapshot {
	return { id: `snap-${currentPath}`, currentPath, originalPath, movedAt, ...(runId ? { runId } : {}) };
}

function checkpoint(overrides: Partial<Checkpoint>): Checkpoint {
	return {
		id: 'cp1',
		module: 'organize',
		operationLabel: 'Organize: directory scan',
		status: 'completed',
		createdAt: '2026-10-06T20:00:00.000Z',
		updatedAt: '2026-10-06T20:10:00.000Z',
		completedItems: [],
		remainingItems: [],
		deferredTasks: [],
		metadata: {},
		...overrides,
	};
}

describe('selectLastRun', () => {
	it('groups stamped snapshots by runId and returns the newest run, newest move first', () => {
		const run = selectLastRun([
			snapshot('a/1.md', 'inbox/1.md', '2026-10-06T10:00:00.000Z', 'old'),
			snapshot('b/2.md', 'inbox/2.md', '2026-10-06T11:00:00.000Z', 'new'),
			snapshot('b/3.md', 'inbox/3.md', '2026-10-06T11:00:05.000Z', 'new'),
		], []);

		expect(run?.snapshots.map((s) => s.currentPath)).toEqual(['b/3.md', 'b/2.md']);
		expect(run?.startedAt).toBe('2026-10-06T11:00:00.000Z');
	});

	it('falls back to the latest organize checkpoint window for snapshots without a runId', () => {
		const inside = snapshot('Media/x.md', 'x.md', '2026-10-06T20:05:00.000Z');
		const justBefore = snapshot('Media/y.md', 'y.md', `2026-10-06T19:59:${String(60 - RUN_WINDOW_MS / 1000).padStart(2, '0')}.000Z`);
		const outside = snapshot('Media/z.md', 'z.md', '2026-10-06T18:00:00.000Z');
		const run = selectLastRun([inside, justBefore, outside], [
			checkpoint({ id: 'older', createdAt: '2026-10-06T17:00:00.000Z', updatedAt: '2026-10-06T17:30:00.000Z' }),
			checkpoint({ id: 'cp1' }),
			checkpoint({ id: 'other', module: 'elaboration', createdAt: '2026-10-06T21:00:00.000Z', updatedAt: '2026-10-06T21:30:00.000Z' }),
		]);

		expect(run?.snapshots.map((s) => s.currentPath)).toEqual(['Media/x.md', 'Media/y.md']);
	});

	it('ignores active checkpoints and returns null when nothing matches', () => {
		const legacy = snapshot('Media/x.md', 'x.md', '2026-10-06T20:05:00.000Z');
		expect(selectLastRun([legacy], [checkpoint({ status: 'active' })])).toBeNull();
		expect(selectLastRun([legacy], [])).toBeNull();
		expect(selectLastRun([], [checkpoint({})])).toBeNull();
	});

	it('prefers whichever candidate moved a note most recently', () => {
		const legacy = snapshot('Media/x.md', 'x.md', '2026-10-06T20:05:00.000Z');
		const stamped = snapshot('b/2.md', 'inbox/2.md', '2026-10-06T09:00:00.000Z', 'run');
		expect(selectLastRun([legacy, stamped], [checkpoint({})])?.snapshots).toEqual([legacy]);
	});
});

describe('undo summary', () => {
	it('builds a dated undo summary path', () => {
		expect(buildUndoSummaryPath('2026-10-06T22:13:00.000Z')).toBe('.synapse/organize/summaries/2026-10-06-undo-summary.md');
	});

	it('lists moved-back and needs-attention paths', () => {
		const text = generateUndoSummary(
			[{ originalPath: 'Media/x.md', newPath: 'x.md' }],
			[{ path: 'Journal/y.md', reason: 'original path y.md is occupied' }],
			'2026-10-06T22:13:00.000Z',
		);
		expect(text).toContain('**Files moved back:** 1');
		expect(text).toContain('**Need attention:** 1');
		expect(text).toContain('- `Media/x.md` -> `x.md`');
		expect(text).toContain('- `Journal/y.md` — original path y.md is occupied');
	});
});

describe('OrganizeModule.undoOrganizeRun', () => {
	let files: Map<string, TFile>;
	let folders: Set<string>;
	let adapterFiles: Map<string, string>;
	let renameSpy: Mock<(file: TFile, newPath: string) => Promise<void>>;
	let createFolderSpy: Mock<(path: string) => Promise<void>>;
	let notifications: { info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; notifyError: ReturnType<typeof vi.fn>; startOperation: ReturnType<typeof vi.fn> };
	let finish: ReturnType<typeof vi.fn>;
	let progress: ReturnType<typeof vi.fn>;
	let checkpoints: Checkpoint[];
	let settings: SynapseSettings;

	function seedSnapshot(s: OrganizeSnapshot): void {
		const safe = s.currentPath.replace(/[/\\]/g, '__').replace(/\.md$/, '');
		adapterFiles.set(`.synapse/organize/snapshots/${safe}.json`, JSON.stringify(s));
	}

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
		renameSpy = vi.fn(async (file: TFile, newPath: string) => {
			files.delete(file.path);
			file.path = newPath;
			files.set(newPath, file);
		});
		createFolderSpy = vi.fn(async (path: string) => { folders.add(path); });
		const plugin = {
			app: {
				vault: {
					adapter,
					rename: renameSpy,
					createFolder: createFolderSpy,
					getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? (folders.has(path) ? new TFolder(path) : null)),
					create: vi.fn(async (path: string, content: string) => { adapterFiles.set(path, content); return new TFile(path); }),
					modify: vi.fn(async () => undefined),
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
		const checkpointManager = createMockCheckpointManager();
		checkpointManager.listAll.mockImplementation(async () => checkpoints);
		return new OrganizeModule(
			makeModuleDeps({
				plugin: plugin as never,
				getSettings: () => settings,
				notifications: notifications as never,
				checkpointManager: checkpointManager as never,
				registrar: { register: vi.fn() } as never,
				noteQueue: new NoteOperationQueue(),
			}),
			() => false
		);
	}

	beforeEach(() => {
		files = new Map();
		folders = new Set(['Media', 'Journal', '.synapse', '.synapse/organize', '.synapse/organize/snapshots', '.synapse/organize/summaries']);
		adapterFiles = new Map();
		settings = structuredClone(DEFAULT_SETTINGS);
		finish = vi.fn();
		progress = vi.fn();
		notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress, update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};
		checkpoints = [checkpoint({})];
		confirmResult.mockReset();
		confirmResult.mockResolvedValue(true);
	});

	afterEach(() => vi.restoreAllMocks());

	it('moves the run back in reverse movedAt order, recreating missing folders and deleting snapshots', async () => {
		files.set('Media/Soluble Fiber.md', new TFile('Media/Soluble Fiber.md'));
		files.set('Journal/Expensify.md', new TFile('Journal/Expensify.md'));
		seedSnapshot(snapshot('Media/Soluble Fiber.md', 'Health/Soluble Fiber.md', '2026-10-06T20:01:00.000Z'));
		seedSnapshot(snapshot('Journal/Expensify.md', 'Expensify.md', '2026-10-06T20:02:00.000Z'));
		const mod = build();

		await mod.undoOrganizeRun();

		expect(renameSpy.mock.calls.map((c) => c[1])).toEqual(['Expensify.md', 'Health/Soluble Fiber.md']);
		expect(createFolderSpy).toHaveBeenCalledWith('Health');
		expect(createFolderSpy).not.toHaveBeenCalledWith('');
		expect([...adapterFiles.keys()].filter((k) => k.startsWith('.synapse/organize/snapshots/'))).toEqual([]);
		expect(finish).toHaveBeenCalledWith('Moved 2 notes back — 0 need attention');
		expect(progress).toHaveBeenCalledTimes(2);
		const summary = adapterFiles.get('.synapse/organize/summaries/' + new Date().toISOString().split('T')[0] + '-undo-summary.md');
		expect(summary).toContain('- `Journal/Expensify.md` -> `Expensify.md`');
	});

	it('skips missing notes and occupied original paths, keeping their snapshots and reporting them', async () => {
		files.set('Media/Rebuttle.md', new TFile('Media/Rebuttle.md'));
		files.set('Debate/Rebuttle.md', new TFile('Debate/Rebuttle.md'));
		seedSnapshot(snapshot('Media/Rebuttle.md', 'Debate/Rebuttle.md', '2026-10-06T20:01:00.000Z'));
		seedSnapshot(snapshot('Media/Gone.md', 'Notes/Gone.md', '2026-10-06T20:02:00.000Z'));
		const mod = build();

		await mod.undoOrganizeRun();

		expect(renameSpy).not.toHaveBeenCalled();
		expect([...adapterFiles.keys()].filter((k) => k.startsWith('.synapse/organize/snapshots/'))).toHaveLength(2);
		expect(finish).toHaveBeenCalledWith('Moved 0 notes back — 2 need attention');
		const summary = [...adapterFiles.entries()].find(([k]) => k.endsWith('-undo-summary.md'))?.[1];
		expect(summary).toContain('`Media/Rebuttle.md` — original path Debate/Rebuttle.md is occupied');
		expect(summary).toContain('`Media/Gone.md` — note not found; it belonged at Notes/Gone.md');
	});

	it('selects a stamped run over older legacy snapshots', async () => {
		files.set('Media/Old.md', new TFile('Media/Old.md'));
		files.set('AI/New.md', new TFile('AI/New.md'));
		seedSnapshot(snapshot('Media/Old.md', 'Old.md', '2026-10-06T20:01:00.000Z'));
		seedSnapshot(snapshot('AI/New.md', 'New.md', '2026-10-06T22:00:00.000Z', 'run2'));
		const mod = build();

		await mod.undoOrganizeRun();

		expect(renameSpy).toHaveBeenCalledTimes(1);
		expect(renameSpy.mock.calls[0][1]).toBe('New.md');
	});

	it('does nothing when the confirmation is dismissed', async () => {
		files.set('Media/Soluble Fiber.md', new TFile('Media/Soluble Fiber.md'));
		seedSnapshot(snapshot('Media/Soluble Fiber.md', 'Health/Soluble Fiber.md', '2026-10-06T20:01:00.000Z'));
		confirmResult.mockResolvedValue(false);
		const mod = build();

		await mod.undoOrganizeRun();

		expect(renameSpy).not.toHaveBeenCalled();
		expect(notifications.startOperation).not.toHaveBeenCalled();
		expect(adapterFiles.size).toBe(1);
	});

	it('notices when there is no run to undo', async () => {
		checkpoints = [];
		const mod = build();

		await mod.undoOrganizeRun();

		expect(confirmResult).not.toHaveBeenCalled();
		expect(notifications.info).toHaveBeenCalledWith('No organize run to undo');
	});
});
