import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElaborationModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { mockFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';

// The proposer uses AIClient under the hood; stub it so no network is hit.
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
 * A minimal in-memory vault adapter so ProposalStore.save → load/loadPending
 * round-trips through real JSON, letting us assert the persisted status of a
 * proposal after a scan (pending vs accepted).
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
			// Folder exists if any file lives under it, plus the note itself.
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
	const vault = {
		read: vi.fn().mockResolvedValue(noteContent),
		modify: vi.fn().mockResolvedValue(undefined),
		create: vi.fn(),
		createFolder: vi.fn().mockResolvedValue(undefined),
		getAbstractFileByPath: vi.fn((path: string) =>
			path === 'notes/topic.md' ? noteFile : null
		),
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

describe('ElaborationModule auto-accept (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let settings: SynapseSettings;
	let notifications: NotificationManager;

	const longContent = '# Topic\n\n' + 'A fully written note with plenty of content. '.repeat(20);

	beforeEach(() => {
		sharedCompleteMock.mockClear();
		adapter = createMemoryAdapter();
		// The proposer reads the source note via adapter.read(notePath), so the
		// note content must live in the in-memory adapter, not just vault.read.
		adapter._files.set('notes/topic.md', longContent);
		settings = structuredClone(DEFAULT_SETTINGS);
		mockPlugin = createMockPlugin(longContent, adapter);
		notifications = new NotificationManager();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(shouldAutoAccept: () => boolean): ElaborationModule {
		return new ElaborationModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			shouldAutoAccept
		);
	}

	it('auto-accepts a freshly generated proposal when the flag is on', async () => {
		settings.autoAccept.elaboration = true;
		const mod = build(() => settings.autoAccept.elaboration);

		await mod.scanNote(mockFile('notes/topic.md') as never);

		// No pending proposals remain — the generated one was accepted.
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(0);

		// The note was modified (the elaboration callout was appended on accept).
		expect(mockPlugin.app.vault.modify).toHaveBeenCalledTimes(1);
	});

	it('leaves the proposal pending when the flag is off', async () => {
		settings.autoAccept.elaboration = false;
		const mod = build(() => settings.autoAccept.elaboration);

		await mod.scanNote(mockFile('notes/topic.md') as never);

		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe('pending');

		// The note is untouched while the proposal awaits review.
		expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
	});

	it('reads the flag live, so toggling after construction takes effect', async () => {
		// Flag starts off; module reads it live via the accessor.
		settings.autoAccept.elaboration = false;
		const mod = build(() => settings.autoAccept.elaboration);

		// Flip it on before scanning — no reconstruction.
		settings.autoAccept.elaboration = true;
		await mod.scanNote(mockFile('notes/topic.md') as never);

		expect(await mod.getPendingProposals()).toHaveLength(0);
	});

	it('fires the onProposalAccepted chain hook on auto-accept', async () => {
		settings.autoAccept.elaboration = true;
		const mod = build(() => settings.autoAccept.elaboration);
		const chained = vi.fn();
		mod.onProposalAccepted = chained;

		await mod.scanNote(mockFile('notes/topic.md') as never);

		expect(chained).toHaveBeenCalledWith('notes/topic.md');
	});
});
