import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { fetchPageContent } from '../shared';

// Mock the summarizer to return a canned summary.
// Track the last created instance so tests can inspect call args.
let lastSummarizerInstance: { summarize: ReturnType<typeof vi.fn> };
vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
		constructor() {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			lastSummarizerInstance = this as any;
		}
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
	detectPlatform: vi.fn().mockReturnValue(null),
}));

// Mock the shared module to avoid folder picker / getMarkdownFiles issues.
// Content fetchers are stubbed here (they moved from ./content-fetcher into
// ../shared) to avoid real network calls.
vi.mock('../shared', () => ({
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	buildCallout: vi.fn((_type: string, _title: string, content: string) => `> ${content}`),
	ENRICHMENT_START: '%% synapse-enrichment-start %%',
	ENRICHMENT_END: '%% synapse-enrichment-end %%',
	generateId: vi.fn().mockReturnValue('id-mock'),
	fetchPageContent: vi.fn().mockResolvedValue('Some fetched content for testing.'),
	fetchTweetContent: vi.fn().mockResolvedValue('Tweet content for testing.'),
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
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: any, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
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
			createMockCheckpointManager() as any,
			new CommandRegistrar(mockPlugin as any)
		);
	});

	it('calls onOrganizeRequested with the file after single-note summarize', async () => {
		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		// Register commands so we can invoke the summarize command
		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
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
			(c: any) => c[0].id === 'synapse:summarize-current-note'
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
			(c: any) => c[0].id === 'synapse:summarize-current-note'
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
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const specificFile = new TFile('projects/research/my-note.md') as any;
		await summarizeCmd.editorCallback({}, { file: specificFile });

		// The callback receives the EXACT file that was summarized
		expect(organizeCallback).toHaveBeenCalledWith(specificFile);
		// And it was called exactly once (not per-vault-file)
		expect(organizeCallback).toHaveBeenCalledTimes(1);
	});
});

// ── Content-Aware Template Detection Integration ──────────────────────

const RECIPE_CONTENT = [
	'# Chocolate Chip Cookies',
	'',
	'## Ingredients',
	'- 2 cups all-purpose flour',
	'- 1 cup butter',
	'- 1 tsp vanilla extract',
	'',
	'## Instructions',
	'1. Preheat oven to 375 degrees fahrenheit.',
	'2. Whisk flour, baking soda, and salt together.',
	'3. Stir in chocolate chips.',
	'4. Bake for 10 minutes.',
].join('\n');

const NON_RECIPE_CONTENT = 'This is a plain news article about the economy.';

describe('SummarizeModule content-aware templates', () => {
	let module: SummarizeModule;
	let mockPlugin: any;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.summarize.autoOrganizeOnSummarize = false;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Note\n\nhttps://example.com\n'),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: any, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
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
			createMockCheckpointManager() as any,
			new CommandRegistrar(mockPlugin as any)
		);
	});

	async function invokeCommand(file: any): Promise<void> {
		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];
		await summarizeCmd.editorCallback({}, { file });
	}

	it('uses recipe template prompt when autoDetectTemplates is true and content matches', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = '';

		// Return recipe content from the content fetcher
		vi.mocked(fetchPageContent).mockResolvedValueOnce(RECIPE_CONTENT);

		const file = new TFile('notes/recipe.md') as any;
		await invokeCommand(file);

		// The summarizer should have been called with the recipe template prompt
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toContain('Ingredients');
		expect(summarizeCall[3]).toContain('Instructions');
		expect(summarizeCall[3]).toContain('Notes');
	});

	it('skips template detection when autoDetectTemplates is false', async () => {
		settings.summarize.autoDetectTemplates = false;
		settings.summarize.customPrompt = '';

		vi.mocked(fetchPageContent).mockResolvedValueOnce(RECIPE_CONTENT);

		const file = new TFile('notes/recipe.md') as any;
		await invokeCommand(file);

		// The summarizer should have been called with undefined (style default)
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBeUndefined();
	});

	it('customPrompt takes precedence over template detection', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = 'My custom override prompt';

		vi.mocked(fetchPageContent).mockResolvedValueOnce(RECIPE_CONTENT);

		const file = new TFile('notes/recipe.md') as any;
		await invokeCommand(file);

		// The summarizer should have been called with the custom prompt
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBe('My custom override prompt');
	});

	it('falls back to style prompt when content does not match any template', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = '';

		vi.mocked(fetchPageContent).mockResolvedValueOnce(NON_RECIPE_CONTENT);

		const file = new TFile('notes/article.md') as any;
		await invokeCommand(file);

		// The summarizer should have been called with undefined (style default)
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBeUndefined();
	});
});
