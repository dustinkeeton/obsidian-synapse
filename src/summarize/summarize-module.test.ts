import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

// Mock the content fetcher to avoid real network calls
vi.mock('./content-fetcher', () => ({
	fetchPageContent: vi.fn().mockResolvedValue('Some fetched content for testing.'),
}));

// Mock the summarizer to return a canned summary
vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
	},
}));

// Mock the note scanner to control what targets are found
vi.mock('./note-scanner', () => ({
	findSummarizeTargets: vi.fn().mockReturnValue([
		{ type: 'url', source: 'https://example.com', line: 2, endLine: 2 },
	]),
}));

// Mock the video module
vi.mock('../video', () => ({
	isSupportedUrl: vi.fn().mockReturnValue(false),
}));

// Mock the shared module to avoid folder picker / getMarkdownFiles issues
vi.mock('../shared', () => ({
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	CALLOUT_TYPES: { transcription: 'auto-notes-transcription', summary: 'auto-notes-summary' },
	buildCallout: vi.fn((_type: string, _title: string, content: string) => `> ${content}`),
	CheckpointManager: class MockCheckpointManager {
		create = vi.fn().mockResolvedValue({ id: 'cp-mock' });
		completeItem = vi.fn().mockResolvedValue(null);
		complete = vi.fn().mockResolvedValue([]);
		discard = vi.fn().mockResolvedValue(undefined);
		listIncomplete = vi.fn().mockResolvedValue([]);
	},
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
		confirm: vi.fn().mockResolvedValue(true),
		_handle: handle,
	};
}

describe('SummarizeModule organize scope', () => {
	let module: SummarizeModule;
	let mockPlugin: any;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.summarize.autoOrganizeOnSummarize = true;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Note\n\nhttps://example.com\n'),
					modify: vi.fn().mockResolvedValue(undefined),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
				},
				workspace: {
					getActiveFile: vi.fn().mockReturnValue(null),
				},
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new SummarizeModule(
			mockPlugin as any,
			() => settings,
			mockNotifications as any,
			createMockCheckpointManager() as any
		);
	});

	it('calls onOrganizeRequested with the file after single-note summarize', async () => {
		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		// Register commands so we can invoke the summarize command
		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'auto-notes:summarize-current-note'
		)[0];

		const file = new TFile('notes/test.md') as any;
		await summarizeCmd.editorCallback({}, { file });

		expect(organizeCallback).toHaveBeenCalledTimes(1);
		expect(organizeCallback).toHaveBeenCalledWith(file);
	});

	it('does not call onOrganizeRequested when autoOrganizeOnSummarize is false', async () => {
		settings.summarize.autoOrganizeOnSummarize = false;

		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'auto-notes:summarize-current-note'
		)[0];

		const file = new TFile('notes/test.md') as any;
		await summarizeCmd.editorCallback({}, { file });

		expect(organizeCallback).not.toHaveBeenCalled();
	});

	it('does not call onOrganizeRequested when callback is not set', async () => {
		// When onOrganizeRequested is null (not wired), summarize completes
		// without attempting any organize operation
		module.onOrganizeRequested = null;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'auto-notes:summarize-current-note'
		)[0];

		const file = new TFile('notes/test.md') as any;

		// Should not throw even with autoOrganizeOnSummarize enabled
		await expect(
			summarizeCmd.editorCallback({}, { file })
		).resolves.not.toThrow();
	});

	it('fires onOrganizeRequested with the correct file, not scanDirectory', async () => {
		// This test verifies the core fix: single-note summarize
		// uses organizeNote(file) scope, not vault-wide scanDirectory.
		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'auto-notes:summarize-current-note'
		)[0];

		const specificFile = new TFile('projects/research/my-note.md') as any;
		await summarizeCmd.editorCallback({}, { file: specificFile });

		// The callback receives the EXACT file that was summarized
		expect(organizeCallback).toHaveBeenCalledWith(specificFile);
		// And it was called exactly once (not per-vault-file)
		expect(organizeCallback).toHaveBeenCalledTimes(1);
	});
});
