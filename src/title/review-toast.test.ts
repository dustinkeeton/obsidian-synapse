import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TitleModule } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
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
	file.parent = new TFolder('Inbox');
	return file;
}

describe('TitleModule Review toast action (#340)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: { vault: Record<string, unknown>; metadataCache: Record<string, unknown> } };
	let settings: SynapseSettings;
	let notifications: { info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; notifyError: ReturnType<typeof vi.fn> };
	let untitledFile: TFile;

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = { info: vi.fn(), success: vi.fn(), notifyError: vi.fn() };
		untitledFile = makeUntitledFile();

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Notes\n\nDetailed content about neural networks.'),
					rename: vi.fn().mockResolvedValue(undefined),
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn((path: string) =>
						path === 'Inbox/Untitled.md' ? untitledFile : null
					),
					adapter,
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
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
			notifications as never,
			shouldAutoAccept
		);
	}

	it('emits a "Title proposal ready" Review toast when auto-accept is off', async () => {
		settings.autoAccept.title = false;
		const mod = build(() => settings.autoAccept.title);
		await mod.onload();
		const openSpy = vi.fn();
		mod.onOpenProposalView = openSpy;

		await mod.checkUntitled('Inbox/Untitled.md');

		expect(notifications.success).toHaveBeenCalledWith(
			'Title proposal ready',
			undefined,
			expect.objectContaining({ label: 'Review' })
		);
		// The action opens the unified proposal view.
		notifications.success.mock.calls[0][2].onClick();
		expect(openSpy).toHaveBeenCalledTimes(1);

		// Nothing was renamed (proposal left pending for review).
		expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
	});

	it('does NOT emit the Review toast when auto-accept is on', async () => {
		settings.autoAccept.title = true;
		const mod = build(() => settings.autoAccept.title);
		await mod.onload();

		await mod.checkUntitled('Inbox/Untitled.md');

		// No Review toast — the proposal was auto-applied, nothing to review.
		expect(notifications.success).not.toHaveBeenCalled();
		// Auto-accept renames the file and surfaces its own info toast.
		expect(mockPlugin.app.vault.rename).toHaveBeenCalledTimes(1);
		expect(notifications.info).toHaveBeenCalledWith(expect.stringContaining('Auto-accepted title'));
	});
});
