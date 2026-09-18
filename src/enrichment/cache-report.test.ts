import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnrichmentModule } from './index';
import { EnrichmentStore } from './enrichment-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import { NoteOperationQueue } from '../shared';
import type { AIRequestOptions } from '../shared';

describe('EnrichmentModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let files: TFile[];
	let finish: ReturnType<typeof vi.fn>;
	let mod: EnrichmentModule;
	let replayedPaths: Set<string>;
	let tagsFound: boolean;

	beforeEach(() => {
		replayedPaths = new Set();
		tagsFound = true;
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.exclusions = [];
		files = ['inbox/a.md', 'inbox/b.md', 'inbox/c.md'].map((p) => new TFile(p));
		const app = createMockApp();
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => files.find((f) => f.path === p) ?? null);
		app.vault.getMarkdownFiles.mockReturnValue(files);
		app.vault.read.mockResolvedValue('Some note body.');

		finish = vi.fn();
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};
		vi.spyOn(EnrichmentStore.prototype, 'save').mockResolvedValue(undefined);

		mod = new EnrichmentModule(
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
		Object.assign(mod as unknown as Record<string, unknown>, {
			analyzer: {
				getFileTags: () => [],
				getOutgoingLinks: () => new Set<string>(),
				buildTagIndex: vi.fn(),
				buildLinkGraph: vi.fn(),
			},
			classifier: { classify: () => Promise.resolve(tagsFound ? [{ tag: 'draft', confidence: 0.9 }] : []) },
			topicExtractor: {
				clearPending: vi.fn(),
				resolveNewNoteCandidates: () => new Map(),
				extractTopics: (_body: string, notePath: string, _links: string[], aiOpts?: AIRequestOptions) => {
					if (replayedPaths.has(notePath)) aiOpts?.onCacheHit?.();
					return Promise.resolve([]);
				},
			},
			linkResolver: { findInternalLinks: () => [], mergeTopicCandidates: () => [] },
			promptBuilder: {
				suggestExternalLinks: () => Promise.resolve([]),
				suggestFrontmatter: () => Promise.resolve([]),
			},
		});
	});

	afterEach(() => vi.restoreAllMocks());

	const lastFinish = (): unknown => finish.mock.calls.at(-1)?.[0];

	it('says a single enrichment replayed a cached AI response when any classifier call was a replay', async () => {
		replayedPaths.add('inbox/a.md');

		await mod.enrich('inbox/a.md', 'manual');

		expect(lastFinish()).toBe('Enrichment proposal created — used a cached AI response');
	});

	it('keeps the plain message for a fresh enrichment', async () => {
		await mod.enrich('inbox/a.md', 'manual');

		expect(lastFinish()).toBe('Enrichment proposal created');
	});

	it('reports a replay that produced no enrichments', async () => {
		tagsFound = false;
		replayedPaths.add('inbox/a.md');

		await mod.enrich('inbox/a.md', 'manual');

		expect(lastFinish()).toBe('No enrichments needed — used a cached AI response');
	});

	it('aggregates a vault scan into one line', async () => {
		replayedPaths.add('inbox/b.md');

		await mod.scanVault(undefined, true);

		expect(lastFinish()).toBe('Generated 3 proposals — 1 of 3 notes served from cache');
	});

	it('keeps the vault scan message unchanged when nothing was replayed', async () => {
		await mod.scanVault(undefined, true);

		expect(lastFinish()).toBe('Generated 3 proposals');
	});
});
