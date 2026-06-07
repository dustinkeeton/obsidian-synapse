import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrganizeModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

// Analyzer finds a topic; matcher proposes a NEW directory (the only path that
// creates an organize proposal).
vi.mock('./content-analyzer', () => ({
	ContentAnalyzer: class MockContentAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		analyze = vi.fn().mockResolvedValue({
			notePath: 'inbox/note.md',
			topics: [{ label: 'machine learning', confidence: 0.95 }],
			tags: [],
			links: [],
		});
	},
}));

vi.mock('./directory-matcher', () => ({
	DirectoryMatcher: class MockDirectoryMatcher {
		constructor(_app: unknown) {}
		scoreDirectories = vi.fn().mockReturnValue([]);
		determineAction = vi.fn().mockReturnValue({
			type: 'propose-new-directory',
			targetDirectory: 'Machine Learning',
			reasoning: 'Note is about machine learning',
		});
	},
}));

/** In-memory adapter so OrganizeStore round-trips proposals via JSON. */
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

describe('OrganizeModule auto-accept (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: Record<string, unknown>; addCommand: ReturnType<typeof vi.fn>; registerEvent: ReturnType<typeof vi.fn> };
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let renameSpy: ReturnType<typeof vi.fn>;
	let sourceFile: TFile;

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		renameSpy = vi.fn().mockResolvedValue(undefined);
		sourceFile = new TFile('inbox/note.md');

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Note\n\nMachine learning content.'),
					rename: renameSpy,
					createFolder: vi.fn().mockResolvedValue(undefined),
					// Source note exists; destination path does not (no conflict).
					getAbstractFileByPath: vi.fn((path: string) =>
						path === 'inbox/note.md' ? sourceFile : null
					),
					adapter,
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
				},
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(shouldAutoAccept: () => boolean): OrganizeModule {
		return new OrganizeModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			shouldAutoAccept
		);
	}

	it('auto-accepts a freshly created organize proposal, moving the note', async () => {
		settings.autoAccept.organize = true;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();

		const result = await mod.organizeNote(sourceFile as never);

		// A proposal was created and immediately accepted (note moved).
		expect(result?.proposalCreated).toBe(true);
		expect(result?.autoAccepted).toBe(true);
		expect(renameSpy).toHaveBeenCalledTimes(1);
		expect(renameSpy.mock.calls[0][1]).toBe('Machine Learning/note.md');

		// Nothing left pending.
		expect(await mod.getPendingProposals()).toHaveLength(0);
	});

	it('leaves the organize proposal pending and does not move the note when the flag is off', async () => {
		settings.autoAccept.organize = false;
		const mod = build(() => settings.autoAccept.organize);
		await mod.onload();

		const result = await mod.organizeNote(sourceFile as never);

		expect(result?.proposalCreated).toBe(true);
		expect(result?.autoAccepted).toBe(false);
		expect(renameSpy).not.toHaveBeenCalled();

		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe('pending');
		expect(pending[0].proposedDirectory).toBe('Machine Learning');
	});
});
