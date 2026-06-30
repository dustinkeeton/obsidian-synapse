import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { TidyModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import type { Plugin, Command, TFile as ObsidianTFile } from 'obsidian';
import type { NotificationManager } from '../shared';

/** The mock TFile and obsidian's real TFile differ structurally; tests only need
 *  the runtime instance, so cross the boundary once here. */
const tfile = (path: string): ObsidianTFile => new TFile(path) as unknown as ObsidianTFile;

/** Reach TidyModule's private undo path without widening to `any`. */
function internals(m: TidyModule): { undoTidy(file: ObsidianTFile): Promise<void> } {
	return m as unknown as { undoTidy(file: ObsidianTFile): Promise<void> };
}

/** Spy-backed stand-ins for the Vault/adapter/FileManager/Plugin surfaces TidyModule uses. */
interface MockAdapter {
	write: Mock<(path: string, data: string) => Promise<void>>;
	exists: Mock<(path: string) => Promise<boolean>>;
}
interface MockVault {
	read: Mock<(file: ObsidianTFile) => Promise<string>>;
	modify: Mock<(file: ObsidianTFile, data: string) => Promise<void>>;
	// Default stub returns the transformed content (string); one test overrides it
	// to a bare order-tracking resolve — `unknown` accommodates both at the boundary.
	process: Mock<(file: ObsidianTFile, fn: (data: string) => string) => Promise<unknown>>;
	create: Mock<(path: string, data: string) => Promise<TFile>>;
	createFolder: Mock<(path: string) => Promise<void>>;
	getAbstractFileByPath: Mock<(path: string) => TFile | null>;
	getMarkdownFiles?: Mock<() => TFile[]>;
	adapter: MockAdapter;
}
interface MockFileManager {
	trashFile: Mock<(file: ObsidianTFile) => Promise<void>>;
}
interface MockPlugin {
	app: { vault: MockVault; fileManager: MockFileManager };
	addCommand: Mock<(command: Command) => unknown>;
	registerEvent: Mock<(ref: unknown) => void>;
}

// Mock the AI client
vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = vi.fn().mockResolvedValue('# Test\n\nSome content with no typos.');
	},
}));

// Mock withRetry to just call the function directly
vi.mock('../shared/api-utils', () => ({
	withRetry: vi.fn((fn: () => Promise<any>) => fn()),
	sleep: vi.fn().mockResolvedValue(undefined),
	notifyError: vi.fn(),
}));

function createMockNotifications() {
	const handle = {
		update: vi.fn(),
		progress: vi.fn(),
		finish: vi.fn(),
		error: vi.fn(),
		cancelled: false,
	};
	return {
		startOperation: vi.fn().mockReturnValue(handle),
		info: vi.fn(),
		success: vi.fn(),
		notifyError: vi.fn(),
		_handle: handle,
	};
}

describe('TidyModule', () => {
	let module: TidyModule;
	let mockPlugin: MockPlugin;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);

		const mockAdapter = {
			write: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true),
		};

		const vault: MockVault = {
			read: vi.fn().mockResolvedValue('# Test\n\nSome contnt with typos.'),
			modify: vi.fn().mockResolvedValue(undefined),
			// Atomic read -> transform -> write; the callback's return value is
			// the written content (mirrors Obsidian's Vault.process).
			process: vi.fn(async (file: ObsidianTFile, fn: (data: string) => string) =>
				fn(await vault.read(file))
			),
			create: vi.fn().mockResolvedValue(new TFile()),
			createFolder: vi.fn().mockResolvedValue(undefined),
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			adapter: mockAdapter,
		};

		// Snapshot cleanup goes through FileManager.trashFile (recoverable),
		// not vault.delete (permanent).
		const fileManager: MockFileManager = {
			trashFile: vi.fn().mockResolvedValue(undefined),
		};

		mockPlugin = {
			app: { vault, fileManager },
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new TidyModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			mockNotifications as unknown as NotificationManager,
			new CommandRegistrar(mockPlugin)
		);
	});

	describe('onload', () => {
		it('registers the tidy command (undo-tidy is gated off by the registry)', async () => {
			await module.onload();

			// `undo-tidy` ships as `status: 'disabled'` in COMMAND_REGISTRY, so
			// the registrar gates it out — only the active tidy command registers.
			expect(mockPlugin.addCommand).toHaveBeenCalledTimes(1);
			const commands = mockPlugin.addCommand.mock.calls.map((c) => c[0].id);
			expect(commands).toContain('tidy-current-note');
			expect(commands).not.toContain('undo-tidy');
		});
	});

	describe('tidy', () => {
		it('reads note, calls AI, and writes tidied content', async () => {
			const file = tfile('notes/test.md');
			await module.tidy(file);

			expect(mockPlugin.app.vault.process).toHaveBeenCalledWith(
				file,
				expect.any(Function)
			);
			const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
			expect(written).toContain('Some content with no typos.');
		});

		it('saves a snapshot before modifying', async () => {
			const file = tfile('notes/test.md');
			const writeOrder: string[] = [];

			mockPlugin.app.vault.adapter.write.mockImplementation(() => {
				writeOrder.push('snapshot-saved');
				return Promise.resolve();
			});
			mockPlugin.app.vault.process.mockImplementation(() => {
				writeOrder.push('note-modified');
				return Promise.resolve();
			});

			await module.tidy(file);

			expect(writeOrder).toEqual(['snapshot-saved', 'note-modified']);
		});

		it('preserves frontmatter untouched', async () => {
			const frontmatter = '---\ntitle: My Note\ntags: [test]\n---\n';
			const body = 'Some contnt.';
			mockPlugin.app.vault.read.mockResolvedValue(frontmatter + body);

			const file = tfile('notes/test.md');
			await module.tidy(file);

			const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
			expect(written).toContain('title: My Note');
			expect(written).toContain('tags:');
		});

		it('finishes early for empty notes', async () => {
			mockPlugin.app.vault.read.mockResolvedValue('---\ntitle: Empty\n---\n');

			const file = tfile('notes/empty.md');
			await module.tidy(file);

			expect(mockNotifications._handle.finish).toHaveBeenCalledWith(
				'Nothing to tidy — note is empty'
			);
			expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
		});

		it('strips code fences from AI response', async () => {
			// Access the AIClient instance through the module internals
			const file = tfile('notes/test.md');

			// Override the AI response for this test via withRetry mock
			const { withRetry } = await import('../shared/api-utils');
			vi.mocked(withRetry).mockImplementationOnce(() =>
				Promise.resolve('```markdown\n# Clean content\n\nFixed text.\n```')
			);

			await module.tidy(file);

			const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
			expect(written).not.toContain('```');
			expect(written).toContain('# Clean content');
		});

		it('reports error on AI failure', async () => {
			const file = tfile('notes/test.md');

			const { withRetry } = await import('../shared/api-utils');
			vi.mocked(withRetry).mockImplementationOnce(() =>
				Promise.reject(new Error('API error (500): Internal server error'))
			);

			await module.tidy(file);

			expect(mockNotifications._handle.error).toHaveBeenCalledWith(
				expect.stringContaining('Tidy failed')
			);
		});

		it('shows progress updates during operation', async () => {
			const file = tfile('notes/test.md');
			await module.tidy(file);

			expect(mockNotifications.startOperation).toHaveBeenCalledWith(
				'Tidying test',
				'tidy-notes/test.md'
			);
			expect(mockNotifications._handle.update).toHaveBeenCalledWith(
				'Correcting spelling and formatting'
			);
			expect(mockNotifications._handle.finish).toHaveBeenCalledWith('Note tidied');
		});
	});

	describe('scanVault onlyFile scoping (#111)', () => {
		it('narrows the scan to a single note when onlyFile is given', async () => {
			const a = new TFile('Inbox/a.md');
			const b = new TFile('Inbox/b.md');
			const c = new TFile('Inbox/c.md');
			mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([a, b, c]);

			const tidied: string[] = [];
			vi.spyOn(module, 'tidy').mockImplementation(async (f: ObsidianTFile) => {
				tidied.push(f.path);
			});

			const count = await module.scanVault('Inbox', true, b as unknown as ObsidianTFile);

			expect(count).toBe(1);
			expect(tidied).toEqual(['Inbox/b.md']);
		});

		it('processes all files in folder when onlyFile is omitted', async () => {
			const a = new TFile('Inbox/a.md');
			const b = new TFile('Inbox/b.md');
			mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([a, b]);

			const tidied: string[] = [];
			vi.spyOn(module, 'tidy').mockImplementation(async (f: ObsidianTFile) => {
				tidied.push(f.path);
			});

			const count = await module.scanVault('Inbox', true);

			expect(count).toBe(2);
			expect(tidied).toEqual(['Inbox/a.md', 'Inbox/b.md']);
		});
	});

	describe('undoTidy', () => {
		it('restores original content from snapshot', async () => {
			const file = tfile('notes/test.md');
			const snapshot = {
				id: 'snap-1',
				filePath: 'notes/test.md',
				originalContent: '# Original\n\nOriginal contnt.',
				createdAt: '2026-03-13T00:00:00.000Z',
			};

			// Mock the store having a snapshot
			const mockSnapshotFile = new TFile('snapshot.json');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockSnapshotFile);
			mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(snapshot));

			// undo-tidy is gated off as a palette command (registry master switch), so
			// invoke the still-present undo logic directly.
			await module.onload();
			await internals(module).undoTidy(file);

			expect(mockPlugin.app.vault.process).toHaveBeenCalledWith(
				file,
				expect.any(Function)
			);
			expect(await mockPlugin.app.vault.process.mock.results[0].value)
				.toBe(snapshot.originalContent);
			expect(mockNotifications.success).toHaveBeenCalledWith('Tidy undone');
		});

		it('informs user when no snapshot exists', async () => {
			const file = tfile('notes/test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await module.onload();
			await internals(module).undoTidy(file);

			expect(mockNotifications.info).toHaveBeenCalledWith(
				'No tidy to undo for this note'
			);
			expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
		});

		it('removes snapshot after undo', async () => {
			const file = tfile('notes/test.md');
			const snapshot = {
				id: 'snap-1',
				filePath: 'notes/test.md',
				originalContent: 'original',
				createdAt: '2026-03-13T00:00:00.000Z',
			};

			const mockSnapshotFile = new TFile('snapshot.json');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockSnapshotFile);
			mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(snapshot));

			await module.onload();
			await internals(module).undoTidy(file);

			expect(mockPlugin.app.fileManager.trashFile).toHaveBeenCalled();
		});
	});
});
