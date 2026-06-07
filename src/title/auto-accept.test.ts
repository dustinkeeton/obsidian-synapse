import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TitleModule } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { TFile, TFolder } from '../__mocks__/obsidian';

// Stub the title suggester so checkUntitled produces a deterministic proposal
// without any AI/network call.
vi.mock('./title-suggester', () => ({
	TitleSuggester: class MockTitleSuggester {
		constructor(_client: unknown) {}
		suggestTitle = vi.fn().mockResolvedValue({
			title: 'Neural Networks',
			reasoning: 'Content is about neural networks',
		});
		checkTitleMismatch = vi.fn().mockResolvedValue({ isMismatch: false });
	},
}));

/** In-memory adapter so TitleProposalStore round-trips proposals via JSON. */
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

function makeUntitledFile(): TFile {
	const file = new TFile('Inbox/Untitled.md');
	const folder = new TFolder('Inbox');
	file.parent = folder;
	return file;
}

describe('TitleModule auto-accept (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: { vault: Record<string, unknown>; metadataCache: Record<string, unknown> } };
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let untitledFile: TFile;
	let renameSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		untitledFile = makeUntitledFile();
		renameSpy = vi.fn().mockResolvedValue(undefined);

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Notes\n\nDetailed content about neural networks and training.'),
					rename: renameSpy,
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn((path: string) => {
						// The source note exists; the rename target does not.
						if (path === 'Inbox/Untitled.md') return untitledFile;
						return null;
					}),
					adapter,
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
				},
			},
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(shouldAutoAccept: () => boolean): TitleModule {
		return new TitleModule(
			mockPlugin as never,
			() => settings,
			notifications,
			shouldAutoAccept
		);
	}

	it('auto-accepts a freshly generated title proposal by renaming the file', async () => {
		settings.autoAccept.title = true;
		const mod = build(() => settings.autoAccept.title);
		await mod.onload();

		await mod.checkUntitled('Inbox/Untitled.md');

		// The file was renamed to the proposed title.
		expect(renameSpy).toHaveBeenCalledTimes(1);
		expect(renameSpy.mock.calls[0][1]).toBe('Inbox/Neural Networks.md');

		// Nothing left pending.
		expect(await mod.getPendingProposals()).toHaveLength(0);
	});

	it('leaves the title proposal pending and does not rename when the flag is off', async () => {
		settings.autoAccept.title = false;
		const mod = build(() => settings.autoAccept.title);
		await mod.onload();

		await mod.checkUntitled('Inbox/Untitled.md');

		expect(renameSpy).not.toHaveBeenCalled();
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe('pending');
		expect(pending[0].proposedTitle).toBe('Neural Networks');
	});
});
