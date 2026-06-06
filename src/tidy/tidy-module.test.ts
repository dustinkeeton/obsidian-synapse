import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TidyModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';

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
	let mockPlugin: any;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);

		const mockAdapter = {
			write: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true),
		};

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Test\n\nSome contnt with typos.'),
					modify: vi.fn().mockResolvedValue(undefined),
					create: vi.fn().mockResolvedValue(new TFile()),
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					delete: vi.fn().mockResolvedValue(undefined),
					adapter: mockAdapter,
				},
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new TidyModule(
			mockPlugin as any,
			() => settings,
			mockNotifications as any,
			new CommandRegistrar(mockPlugin as any)
		);
	});

	describe('onload', () => {
		it('registers tidy and undo commands', async () => {
			await module.onload();

			expect(mockPlugin.addCommand).toHaveBeenCalledTimes(2);
			const commands = mockPlugin.addCommand.mock.calls.map((c: any) => c[0].id);
			expect(commands).toContain('synapse:tidy-current-note');
			expect(commands).toContain('synapse:undo-tidy');
		});
	});

	describe('tidy', () => {
		it('reads note, calls AI, and writes tidied content', async () => {
			const file = new TFile('notes/test.md') as any;
			await module.tidy(file);

			expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(file);
			expect(mockPlugin.app.vault.modify).toHaveBeenCalledWith(
				file,
				expect.stringContaining('Some content with no typos.')
			);
		});

		it('saves a snapshot before modifying', async () => {
			const file = new TFile('notes/test.md') as any;
			const writeOrder: string[] = [];

			mockPlugin.app.vault.adapter.write.mockImplementation(() => {
				writeOrder.push('snapshot-saved');
				return Promise.resolve();
			});
			mockPlugin.app.vault.modify.mockImplementation(() => {
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

			const file = new TFile('notes/test.md') as any;
			await module.tidy(file);

			const written = mockPlugin.app.vault.modify.mock.calls[0][1] as string;
			expect(written).toContain('title: My Note');
			expect(written).toContain('tags:');
		});

		it('finishes early for empty notes', async () => {
			mockPlugin.app.vault.read.mockResolvedValue('---\ntitle: Empty\n---\n');

			const file = new TFile('notes/empty.md') as any;
			await module.tidy(file);

			expect(mockNotifications._handle.finish).toHaveBeenCalledWith(
				'Nothing to tidy — note is empty'
			);
			expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
		});

		it('strips code fences from AI response', async () => {
			// Access the AIClient instance through the module internals
			const file = new TFile('notes/test.md') as any;

			// Override the AI response for this test via withRetry mock
			const { withRetry } = await import('../shared/api-utils');
			(withRetry as any).mockImplementationOnce(() =>
				Promise.resolve('```markdown\n# Clean content\n\nFixed text.\n```')
			);

			await module.tidy(file);

			const written = mockPlugin.app.vault.modify.mock.calls[0][1] as string;
			expect(written).not.toContain('```');
			expect(written).toContain('# Clean content');
		});

		it('reports error on AI failure', async () => {
			const file = new TFile('notes/test.md') as any;

			const { withRetry } = await import('../shared/api-utils');
			(withRetry as any).mockImplementationOnce(() =>
				Promise.reject(new Error('API error (500): Internal server error'))
			);

			await module.tidy(file);

			expect(mockNotifications._handle.error).toHaveBeenCalledWith(
				expect.stringContaining('Tidy failed')
			);
		});

		it('shows progress updates during operation', async () => {
			const file = new TFile('notes/test.md') as any;
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
			vi.spyOn(module, 'tidy').mockImplementation(async (f: any) => {
				tidied.push(f.path);
			});

			const count = await module.scanVault('Inbox', true, b as any);

			expect(count).toBe(1);
			expect(tidied).toEqual(['Inbox/b.md']);
		});

		it('processes all files in folder when onlyFile is omitted', async () => {
			const a = new TFile('Inbox/a.md');
			const b = new TFile('Inbox/b.md');
			mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([a, b]);

			const tidied: string[] = [];
			vi.spyOn(module, 'tidy').mockImplementation(async (f: any) => {
				tidied.push(f.path);
			});

			const count = await module.scanVault('Inbox', true);

			expect(count).toBe(2);
			expect(tidied).toEqual(['Inbox/a.md', 'Inbox/b.md']);
		});
	});

	describe('undoTidy', () => {
		it('restores original content from snapshot', async () => {
			const file = new TFile('notes/test.md') as any;
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

			// Access undoTidy through the command callback
			await module.onload();
			const undoCommand = mockPlugin.addCommand.mock.calls.find(
				(c: any) => c[0].id === 'synapse:undo-tidy'
			)[0];

			// Call the editorCallback directly
			await undoCommand.editorCallback({}, { file });

			expect(mockPlugin.app.vault.modify).toHaveBeenCalledWith(
				file,
				snapshot.originalContent
			);
			expect(mockNotifications.success).toHaveBeenCalledWith('Tidy undone');
		});

		it('informs user when no snapshot exists', async () => {
			const file = new TFile('notes/test.md') as any;
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await module.onload();
			const undoCommand = mockPlugin.addCommand.mock.calls.find(
				(c: any) => c[0].id === 'synapse:undo-tidy'
			)[0];

			await undoCommand.editorCallback({}, { file });

			expect(mockNotifications.info).toHaveBeenCalledWith(
				'No tidy to undo for this note'
			);
			expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
		});

		it('removes snapshot after undo', async () => {
			const file = new TFile('notes/test.md') as any;
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
			const undoCommand = mockPlugin.addCommand.mock.calls.find(
				(c: any) => c[0].id === 'synapse:undo-tidy'
			)[0];

			await undoCommand.editorCallback({}, { file });

			expect(mockPlugin.app.vault.delete).toHaveBeenCalled();
		});
	});
});
