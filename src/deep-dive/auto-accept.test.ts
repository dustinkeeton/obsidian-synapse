import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepDiveModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { DeepDiveProposal } from './types';

vi.mock('./topic-analyzer', () => ({
	TopicAnalyzer: class MockTopicAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		extractTopics = vi.fn().mockResolvedValue([]);
	},
}));
vi.mock('./note-generator', () => ({
	NoteGenerator: class MockNoteGenerator {
		constructor(_getSettings: unknown) {}
		generateContent = vi.fn().mockResolvedValue('# Generated\n\nbody');
	},
}));

/** In-memory adapter so DeepDiveStore round-trips proposals/runs via JSON. */
function createMemoryAdapter() {
	const files = new Map<string, string>();
	return {
		_files: files,
		read: vi.fn(async (path: string) => {
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path)!;
		}),
		write: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
		}),
		exists: vi.fn(async (path: string) => {
			if (files.has(path)) return true;
			for (const key of files.keys()) if (key.startsWith(path + '/')) return true;
			return false;
		}),
		remove: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		list: vi.fn(async (folder: string) => {
			const out: string[] = [];
			for (const key of files.keys()) if (key.startsWith(folder + '/')) out.push(key);
			return { files: out, folders: [] };
		}),
	};
}

function makeProposal(id: string): DeepDiveProposal {
	return {
		id,
		runId: 'run-1',
		sourceNotePath: 'notes/root.md',
		topic: { title: 'Backpropagation', existsInVault: false, reason: 'new concept' } as never,
		proposedPath: 'Deep Dives/Root/Backpropagation.md',
		proposedContent: '# Backpropagation\n\nGenerated content.',
		depth: 0,
		qualityScore: { score: 0.9 } as never,
		childProposalIds: [],
		createdAt: new Date().toISOString(),
		status: 'pending',
	};
}

describe('DeepDiveModule auto-accept guard (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: Record<string, unknown>; addCommand: ReturnType<typeof vi.fn>; registerEvent: ReturnType<typeof vi.fn> };
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let createSpy: ReturnType<typeof vi.fn>;
	let modifySpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		createSpy = vi.fn().mockResolvedValue(undefined);
		modifySpy = vi.fn().mockResolvedValue(undefined);

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Root\n\nroot content'),
					create: createSpy,
					modify: modifySpy,
					createFolder: vi.fn().mockResolvedValue(undefined),
					// No run is stored, so updateRunNavigation returns early and
					// the accept reduces to a status flip — keeps the test focused
					// on the double-accept guard.
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					adapter,
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(): DeepDiveModule {
		return new DeepDiveModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			() => settings.autoAccept['deep-dive']
		);
	}

	it('marks a proposal accepted on first accept and is idempotent on a second (cascade guard)', async () => {
		const mod = build();
		await mod.onload();

		// Seed one pending proposal directly in the store, under the exact file
		// name the store derives (topic-slug + depth + shortId) so that the
		// status-update re-save overwrites the SAME file rather than leaving a
		// stale pending copy.
		const proposal = makeProposal('p1');
		adapter._files.set(
			`${settings.deepDive.proposalFolderPath}/proposals/backpropagation-d0-p1.json`,
			JSON.stringify(proposal)
		);

		// Proves the proposal was actually found & pending before accept.
		expect(await mod.getPendingProposals()).toHaveLength(1);

		// First accept flips status to accepted, firing the chain hook once.
		const onNoteAccepted = vi.fn();
		mod.onNoteAccepted = onNoteAccepted;
		await mod.acceptProposal('p1');
		expect(await mod.getPendingProposals()).toHaveLength(0);
		expect(onNoteAccepted).toHaveBeenCalledTimes(1);

		// Second accept is a no-op (cascade guard): no throw, no second
		// note-accepted hook, still nothing pending.
		await mod.acceptProposal('p1');
		expect(await mod.getPendingProposals()).toHaveLength(0);
		expect(onNoteAccepted).toHaveBeenCalledTimes(1);
	});

	it('fires the enrichment chain hook (onNoteAccepted) on accept', async () => {
		settings.autoAccept['deep-dive'] = true;
		const mod = build();
		await mod.onload();
		const onNoteAccepted = vi.fn();
		mod.onNoteAccepted = onNoteAccepted;

		const proposal = makeProposal('p2');
		adapter._files.set(
			`${settings.deepDive.proposalFolderPath}/proposals/backpropagation-d0-p2.json`,
			JSON.stringify(proposal)
		);

		await mod.acceptProposal('p2');

		expect(onNoteAccepted).toHaveBeenCalledWith('Deep Dives/Root/Backpropagation.md');
	});
});
