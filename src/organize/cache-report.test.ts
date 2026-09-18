import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrganizeModule } from './index';
import { OrganizeStore } from './organize-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile } from 'obsidian';
import { TFolder, TFile as MockTFile } from '../__mocks__/obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { AIRequestOptions } from '../shared';

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const TOPICS = JSON.stringify([{ label: 'machine learning', confidence: 0.95 }]);

describe('OrganizeModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let finish: ReturnType<typeof vi.fn>;
	let mod: OrganizeModule;
	let replayedPaths: Set<string>;
	let aiResponse: string;
	let notes: TFile[];

	beforeEach(async () => {
		replayedPaths = new Set();
		aiResponse = TOPICS;
		settings = structuredClone(DEFAULT_SETTINGS);

		notes = [mockFile('inbox/a.md'), mockFile('inbox/b.md'), mockFile('inbox/c.md')];
		const app = createMockApp();
		// Empty vault tree: no existing directory scores, so every note yields a new-directory proposal.
		const root = new TFolder('/');
		root.isRoot = () => true;
		(app.vault as unknown as { getRoot: () => TFolder }).getRoot = () => root;
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		app.vault.getMarkdownFiles.mockReturnValue(notes);
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => notes.find((f) => f.path === p) ?? null);
		// Per-note marker so the AI mock can tell which note's request it is serving.
		app.vault.read.mockImplementation(async (f: MockTFile) => `Notes on training. source=${f.path}`);

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
		vi.spyOn(OrganizeStore.prototype, 'loadPendingProposals').mockResolvedValue([]);

		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(
			async (userPrompt: string, _system?: string, aiOpts?: AIRequestOptions) => {
				const source = notes.find((f) => userPrompt.includes(`source=${f.path}`))?.path;
				if (source && replayedPaths.has(source)) aiOpts?.onCacheHit?.();
				return aiResponse;
			}
		);

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

	const lastFinish = (): unknown => finish.mock.calls.at(-1)?.[0];

	it('says a single-note organize replayed a cached AI response', async () => {
		replayedPaths.add('inbox/a.md');

		await mod.organizeNote(notes[0]);

		expect(lastFinish()).toBe('Proposal created for new directory — used a cached AI response');
	});

	it('keeps the plain message for a fresh single-note organize', async () => {
		await mod.organizeNote(notes[0]);

		expect(lastFinish()).toBe('Proposal created for new directory');
	});

	it('reports a replay that produced no organization', async () => {
		aiResponse = '[]';
		replayedPaths.add('inbox/a.md');

		await mod.organizeNote(notes[0]);

		expect(lastFinish()).toBe('No organization needed — used a cached AI response');
	});

	it('aggregates a directory scan into one line', async () => {
		replayedPaths.add('inbox/b.md');

		await mod.scanDirectory('inbox', true);

		expect(lastFinish()).toBe('3 proposals — 1 of 3 notes served from cache');
	});

	it('keeps the directory scan message unchanged when nothing was replayed', async () => {
		await mod.scanDirectory('inbox', true);

		expect(lastFinish()).toBe('3 proposals');
	});
});
