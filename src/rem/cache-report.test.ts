import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemModule } from './index';
import { RemStore } from './rem-store';
import { MentionScanner } from './mention-scanner';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile } from 'obsidian';
import type { TFile as MockTFile } from '../__mocks__/obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { AIRequestOptions } from '../shared';

const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

const MATCHES = JSON.stringify([
	{ title: 'Neural Networks', matchedConcept: 'neural networks', confidence: 0.9 },
]);

describe('RemModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let finish: ReturnType<typeof vi.fn>;
	let info: ReturnType<typeof vi.fn>;
	let success: ReturnType<typeof vi.fn>;
	let mod: RemModule;
	let replayedPaths: Set<string>;
	let aiResponse: string;
	let notes: TFile[];

	beforeEach(async () => {
		replayedPaths = new Set();
		aiResponse = MATCHES;
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.rem.confidenceThreshold = 0.5;

		const target = mockFile('notes/Neural Networks.md');
		notes = [mockFile('inbox/a.md'), mockFile('inbox/b.md'), mockFile('inbox/c.md')];
		const app = createMockApp();
		app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
		app.vault.getMarkdownFiles.mockReturnValue([...notes, target]);
		app.vault.getAbstractFileByPath.mockImplementation(
			(p: string) => [...notes, target].find((f) => f.path === p) ?? null
		);
		// Per-note marker so the AI mock can tell which note's request it is serving.
		app.vault.read.mockImplementation(async (f: MockTFile) => `A note about neural networks. source=${f.path}`);

		finish = vi.fn();
		info = vi.fn();
		success = vi.fn();
		const notifications = {
			info,
			success,
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};

		vi.spyOn(RemStore.prototype, 'init').mockResolvedValue(undefined);
		vi.spyOn(RemStore.prototype, 'save').mockResolvedValue(undefined);
		vi.spyOn(RemStore.prototype, 'loadPending').mockResolvedValue([]);
		// Literal matching off so the assertions count only the semantic candidate.
		vi.spyOn(MentionScanner.prototype, 'scan').mockReturnValue([]);

		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(
			async (userPrompt: string, _system?: string, aiOpts?: AIRequestOptions) => {
				const source = notes.find((f) => userPrompt.includes(`source=${f.path}`))?.path;
				if (source && replayedPaths.has(source)) aiOpts?.onCacheHit?.();
				return aiResponse;
			}
		);

		mod = new RemModule(
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

	it('says a single-note scan replayed a cached AI response', async () => {
		replayedPaths.add('inbox/a.md');

		await mod.remScanNote('inbox/a.md');

		expect(success.mock.calls.at(-1)?.[0]).toBe('Found 1 linkable mention — used a cached AI response');
	});

	it('keeps the plain message for a fresh single-note scan', async () => {
		await mod.remScanNote('inbox/a.md');

		expect(success.mock.calls.at(-1)?.[0]).toBe('Found 1 linkable mention');
	});

	it('reports a replay that found no linkable mentions', async () => {
		aiResponse = '[]';
		replayedPaths.add('inbox/a.md');

		await mod.remScanNote('inbox/a.md');

		expect(info.mock.calls.at(-1)?.[0]).toBe('No linkable mentions found — used a cached AI response');
	});

	it('aggregates a directory scan into one line', async () => {
		replayedPaths.add('inbox/b.md');

		await mod.remScanDirectory('inbox');

		expect(finish.mock.calls.at(-1)?.[0]).toBe('REM scan complete -- 3 notes with linkable mentions — 1 of 3 served from cache');
	});

	it('keeps the directory scan message unchanged when nothing was replayed', async () => {
		await mod.remScanDirectory('inbox');

		expect(finish.mock.calls.at(-1)?.[0]).toBe('REM scan complete -- 3 notes with linkable mentions');
	});
});
