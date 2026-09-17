import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElaborationModule } from './index';
import { ProposalStore } from './proposal-store';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp, createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin } from 'obsidian';
import { NoteOperationQueue } from '../shared';
import type { AIRequestOptions, NoticeAction } from '../shared';
import type { DetectionResult, Proposal } from './types';

const replayedPaths = vi.hoisted(() => new Set<string>());

vi.mock('./detector', () => ({
	PlaceholderDetector: class MockPlaceholderDetector {
		detect = vi.fn(
			async (file: TFile): Promise<DetectionResult> => ({
				notePath: file.path,
				reasons: [{ type: 'short-note', wordCount: 3 }],
			})
		);
	},
}));

vi.mock('./proposer', () => ({
	ProposalGenerator: class MockProposalGenerator {
		generate = vi.fn(
			async (result: DetectionResult, key?: string, aiOpts?: AIRequestOptions): Promise<Proposal> => {
				if (replayedPaths.has(result.notePath)) aiOpts?.onCacheHit?.();
				return {
					id: `prop-${result.notePath}`,
					contentKey: key,
					sourceNotePath: result.notePath,
					createdAt: '2026-06-26T00:00:00.000Z',
					detectionReasons: result.reasons,
					originalContent: 'stub',
					proposedAdditions: 'Generated elaboration body.',
					insertionPoint: 'append',
					status: 'pending',
				};
			}
		);
	},
	proposalContentKey: vi.fn((path: string) => `key-${path}`),
}));

describe('ElaborationModule cache reporting (#527)', () => {
	let settings: SynapseSettings;
	let files: TFile[];
	let finish: ReturnType<typeof vi.fn<(message?: string, action?: NoticeAction) => void>>;
	let mod: ElaborationModule;

	beforeEach(() => {
		replayedPaths.clear();
		settings = structuredClone(DEFAULT_SETTINGS);
		files = ['inbox/a.md', 'inbox/b.md', 'inbox/c.md'].map((p) => new TFile(p));
		const app = createMockApp();
		app.vault.getAbstractFileByPath.mockImplementation((p: string) => files.find((f) => f.path === p) ?? null);
		app.vault.getMarkdownFiles.mockReturnValue(files);

		finish = vi.fn<(message?: string, action?: NoticeAction) => void>();
		const notifications = {
			info: vi.fn(),
			success: vi.fn(),
			notifyError: vi.fn(),
			startOperation: vi.fn(() => ({ progress: vi.fn(), update: vi.fn(), finish, error: vi.fn(), cancelled: false })),
		};

		vi.spyOn(ProposalStore.prototype, 'save').mockResolvedValue(undefined);
		vi.spyOn(ProposalStore.prototype, 'loadByNote').mockResolvedValue([]);

		mod = new ElaborationModule(
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
	});

	afterEach(() => vi.restoreAllMocks());

	it('says a single proposal replayed a cached AI response', async () => {
		replayedPaths.add('inbox/a.md');

		await mod.scanNote(files[0] as never);

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposal generated — used a cached AI response');
	});

	it('keeps the plain message for a fresh proposal', async () => {
		await mod.scanNote(files[0] as never);

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Proposal generated');
	});

	it('aggregates a vault scan into one line', async () => {
		replayedPaths.add('inbox/a.md');
		replayedPaths.add('inbox/c.md');

		await mod.scanVault(undefined, true);

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Generated 3 proposals — 2 of 3 served from cache');
	});

	it('keeps the vault scan message unchanged when nothing was replayed', async () => {
		await mod.scanVault(undefined, true);

		expect(finish.mock.calls.at(-1)?.[0]).toBe('Generated 3 proposals');
	});
});
