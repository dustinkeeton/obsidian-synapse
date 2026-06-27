import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElaborationModule } from './index';
import { ProposalStore } from './proposal-store';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { mockFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { Proposal } from './types';

// The proposer uses AIClient under the hood; stub it so no network is hit and
// we can count how many times the model is actually invoked.
const sharedCompleteMock = vi.fn().mockResolvedValue('AI-generated elaboration content');
vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		constructor(_getSettings: unknown) {}
		complete(...args: unknown[]) {
			return sharedCompleteMock(...args);
		}
	},
}));

/**
 * In-memory vault adapter so ProposalStore.save -> load round-trips through real
 * JSON, letting us assert how many proposal files exist after repeated scans.
 */
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
			for (const key of files.keys()) {
				if (key.startsWith(path + '/')) return true;
			}
			return false;
		}),
		remove: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		list: vi.fn(async (folder: string) => {
			const out: string[] = [];
			for (const key of files.keys()) {
				if (key.startsWith(folder + '/')) out.push(key);
			}
			return { files: out, folders: [] };
		}),
		mkdir: vi.fn(async () => undefined),
	};
}

function createMockPlugin(noteContent: string, adapter: ReturnType<typeof createMemoryAdapter>) {
	const noteFile = mockFile('notes/topic.md');
	const vault: any = {
		read: vi.fn().mockResolvedValue(noteContent),
		cachedRead: vi.fn().mockResolvedValue(noteContent),
		modify: vi.fn().mockResolvedValue(undefined),
		process: vi.fn(async (file: any, fn: (data: string) => string) => fn(await vault.read(file))),
		create: vi.fn(),
		createFolder: vi.fn().mockResolvedValue(undefined),
		getAbstractFileByPath: vi.fn((path: string) => (path === 'notes/topic.md' ? noteFile : null)),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		adapter,
	};
	const metadataCache = {
		getFileCache: vi.fn().mockReturnValue(null),
		getCache: vi.fn().mockReturnValue(null),
		getFirstLinkpathDest: vi.fn().mockReturnValue(null),
	};
	const workspace = {
		getLeavesOfType: vi.fn().mockReturnValue([]),
		getRightLeaf: vi.fn().mockReturnValue(null),
		revealLeaf: vi.fn(),
		getActiveFile: vi.fn().mockReturnValue(null),
	};
	return {
		app: { vault, metadataCache, workspace },
		addCommand: vi.fn(),
		addRibbonIcon: vi.fn(),
		addSettingTab: vi.fn(),
		registerView: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn().mockResolvedValue(null),
		saveData: vi.fn().mockResolvedValue(undefined),
	};
}

function seedProposal(overrides: Partial<Proposal>): Proposal {
	return {
		id: 'seed-0000',
		contentKey: 'not-a-real-hash-key',
		sourceNotePath: 'notes/topic.md',
		createdAt: '2026-01-01T00:00:00.000Z',
		detectionReasons: [{ type: 'user-requested' }],
		originalContent: 'old content',
		proposedAdditions: 'old additions',
		insertionPoint: 'append',
		status: 'pending',
		...overrides,
	};
}

describe('ElaborationModule proposal idempotency (#395)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let settings: SynapseSettings;
	let notifications: NotificationManager;

	// Long enough that the detector does not flag it as a stub, so scanNote takes
	// the synthetic user-requested path (stable detection reasons across scans).
	const longContent = '# Topic\n\n' + 'A fully written note with plenty of content. '.repeat(20);

	beforeEach(() => {
		sharedCompleteMock.mockClear();
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		// Auto-accept off: the generated proposal stays pending so the dedup guard
		// has a pending proposal to match on the second scan.
		settings.autoAccept.elaboration = false;
		mockPlugin = createMockPlugin(longContent, adapter);
		notifications = new NotificationManager();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(): ElaborationModule {
		return new ElaborationModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			() => settings.autoAccept.elaboration
		);
	}

	it('a second scan of an unchanged note makes no new AI call and creates no new proposal', async () => {
		const mod = build();
		const file = mockFile('notes/topic.md');

		await mod.scanNote(file as never);
		expect(sharedCompleteMock).toHaveBeenCalledTimes(1);
		const firstPending = await mod.getPendingProposals();
		expect(firstPending).toHaveLength(1);
		const fileCountAfterFirst = adapter._files.size;

		// Re-scan the same, unchanged note.
		await mod.scanNote(file as never);

		// The dedup guard short-circuited before generate(): no second AI call...
		expect(sharedCompleteMock).toHaveBeenCalledTimes(1);
		// ...no new proposal file, and the single proposal is byte-for-byte the same.
		expect(adapter._files.size).toBe(fileCountAfterFirst);
		const secondPending = await mod.getPendingProposals();
		expect(secondPending).toHaveLength(1);
		expect(secondPending[0].id).toBe(firstPending[0].id);
	});

	it('stops generating once maxProposalsPerNote pending proposals exist for a note', async () => {
		settings.elaboration.proposal.maxProposalsPerNote = 1;
		// Pre-seed one pending proposal with a DIFFERENT content key so the dedup
		// short-circuit cannot fire — the cap is what must stop generation.
		const seedStore = new ProposalStore(mockPlugin.app as never, () => settings);
		await seedStore.save(seedProposal({ id: 'seed-cap', contentKey: 'different-key' }));

		const mod = build();
		await mod.scanNote(mockFile('notes/topic.md') as never);

		// Cap reached -> no AI call, and no new proposal beyond the seed.
		expect(sharedCompleteMock).not.toHaveBeenCalled();
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].id).toBe('seed-cap');
	});

	it('a rejected proposal with the same key does NOT block re-generation', async () => {
		const mod = build();
		const file = mockFile('notes/topic.md');

		await mod.scanNote(file as never);
		expect(sharedCompleteMock).toHaveBeenCalledTimes(1);
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);

		// Reject it: the proposal keeps its (deterministic) key but its status
		// becomes 'rejected', which the dedup predicate must ignore.
		await mod.rejectProposal(pending[0].id);
		expect(await mod.getPendingProposals()).toHaveLength(0);

		// Re-scan: dedup must NOT fire (only the rejected proposal shares the key),
		// so the model is invoked again and a fresh pending proposal is produced.
		await mod.scanNote(file as never);
		expect(sharedCompleteMock).toHaveBeenCalledTimes(2);
		expect(await mod.getPendingProposals()).toHaveLength(1);
	});
});
