import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { fetchPageContent, fetchRedditContent } from '../shared';
import { findSummarizeTargets, extractNoteProse } from './note-scanner';
import type { Mock } from 'vitest';
import type { Plugin } from 'obsidian';
import type { NotificationManager, CheckpointManager } from '../shared';

/** The slice of an Obsidian Command the tests read back off addCommand. */
interface MockCommand {
	id: string;
	name: string;
	editorCallback?: (editor: unknown, ctx: unknown) => unknown;
}

/** Typed shape of the hand-built plugin stub the module + registrar consume. */
interface MockPlugin {
	app: {
		vault: {
			read: Mock<(file: unknown) => Promise<string>>;
			modify?: ReturnType<typeof vi.fn>;
			process: Mock<(file: unknown, fn: (data: string) => string) => Promise<string>>;
			create: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
		};
		metadataCache: { getFileCache: ReturnType<typeof vi.fn> };
		workspace: { getActiveFile: ReturnType<typeof vi.fn> };
	};
	addCommand: Mock<(cmd: MockCommand) => void>;
	registerEvent: ReturnType<typeof vi.fn>;
}

// Mock the summarizer to return a canned summary.
// Track the last created instance so tests can inspect call args.
let lastSummarizerInstance: { summarize: ReturnType<typeof vi.fn> };
vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
		constructor() {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			lastSummarizerInstance = this;
		}
	},
}));

// Mock the note scanner to control what targets are found.
// extractNoteProse defaults to empty so existing reference-only tests are
// unaffected; note-content tests override it per-case.
vi.mock('./note-scanner', () => ({
	findSummarizeTargets: vi.fn().mockReturnValue([
		{ type: 'url', source: 'https://example.com', line: 2, endLine: 2 },
	]),
	extractNoteProse: vi.fn().mockReturnValue(''),
	hasSummaryBelow: vi.fn().mockReturnValue(false),
}));

// Mock the video module
vi.mock('../video', () => ({
	isSupportedUrl: vi.fn().mockReturnValue(false),
	detectPlatform: vi.fn().mockReturnValue(null),
}));

// Mock the shared module to avoid folder picker / getMarkdownFiles issues.
// Content fetchers are stubbed here (they moved from ./content-fetcher into
// ../shared) to avoid real network calls.
vi.mock('../shared', async () => ({
	// Use the REAL content-schema registry (recipe/receipt detection + prompts)
	// so auto-format behavior is exercised faithfully through the shared barrel.
	...(await vi.importActual<typeof import('../shared/content-schemas')>('../shared/content-schemas')),
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	// URL detection helpers live in shared/url-detector; the summarize module
	// imports them from the shared barrel (not via the video module's re-export).
	isSupportedUrl: vi.fn().mockReturnValue(false),
	detectPlatform: vi.fn().mockReturnValue(null),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	buildCallout: vi.fn((_type: string, _title: string, content: string) => `> ${content}`),
	ENRICHMENT_START: '%% synapse-enrichment-start %%',
	ENRICHMENT_END: '%% synapse-enrichment-end %%',
	generateId: vi.fn().mockReturnValue('id-mock'),
	fetchPageContent: vi.fn().mockResolvedValue('Some fetched content for testing.'),
	fetchTweetContent: vi.fn().mockResolvedValue('Tweet content for testing.'),
	isRedditUrl: (url: string) => {
		try {
			const h = new URL(url).hostname.toLowerCase();
			return h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it' || h.endsWith('.redd.it');
		} catch { return false; }
	},
	fetchRedditContent: vi.fn().mockResolvedValue('Reddit content for testing.'),
	linkLoadError: (source: string, reason: string) => `Could not load content from ${source}: ${reason}`,
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
		error: vi.fn(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
		_handle: handle,
	};
}

describe('SummarizeModule organize scope', () => {
	let module: SummarizeModule;
	let mockPlugin: MockPlugin;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.summarize.autoOrganizeOnSummarize = true;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn<(file: unknown) => Promise<string>>().mockResolvedValue('# Note\n\nhttps://example.com\n'),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: unknown, fn: (data: string) => string) =>
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
			addCommand: vi.fn<(cmd: MockCommand) => void>(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new SummarizeModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			mockNotifications as unknown as NotificationManager,
			createMockCheckpointManager() as unknown as CheckpointManager,
			new CommandRegistrar(
				mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
			),
		);
	});

	it('calls onOrganizeRequested with the file after single-note summarize', async () => {
		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		// Register commands so we can invoke the summarize command
		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];

		const file = new TFile('notes/test.md');
		await summarizeCmd.editorCallback?.({}, { file });

		expect(organizeCallback).toHaveBeenCalledTimes(1);
		expect(organizeCallback).toHaveBeenCalledWith(file);
	});

	it('does not call onOrganizeRequested when autoOrganizeOnSummarize is false', async () => {
		settings.summarize.autoOrganizeOnSummarize = false;

		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];

		const file = new TFile('notes/test.md');
		await summarizeCmd.editorCallback?.({}, { file });

		expect(organizeCallback).not.toHaveBeenCalled();
	});

	it('does not call onOrganizeRequested when callback is not set', async () => {
		// When onOrganizeRequested is null (not wired), summarize completes
		// without attempting any organize operation
		module.onOrganizeRequested = null;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];

		const file = new TFile('notes/test.md');

		// Should not throw even with autoOrganizeOnSummarize enabled
		await expect(
			summarizeCmd.editorCallback?.({}, { file })
		).resolves.not.toThrow();
	});

	it('fires onOrganizeRequested with the correct file, not scanDirectory', async () => {
		// This test verifies the core fix: single-note summarize
		// uses organizeNote(file) scope, not vault-wide scanDirectory.
		const organizeCallback = vi.fn();
		module.onOrganizeRequested = organizeCallback;

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];

		const specificFile = new TFile('projects/research/my-note.md');
		await summarizeCmd.editorCallback?.({}, { file: specificFile });

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
	let mockPlugin: MockPlugin;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.summarize.autoOrganizeOnSummarize = false;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn<(file: unknown) => Promise<string>>().mockResolvedValue('# Note\n\nhttps://example.com\n'),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: unknown, fn: (data: string) => string) =>
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
			addCommand: vi.fn<(cmd: MockCommand) => void>(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new SummarizeModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			mockNotifications as unknown as NotificationManager,
			createMockCheckpointManager() as unknown as CheckpointManager,
			new CommandRegistrar(
				mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
			),
		);
	});

	async function invokeCommand(file: TFile): Promise<void> {
		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];
		await summarizeCmd.editorCallback?.({}, { file });
	}

	it('uses recipe template prompt when autoDetectTemplates is true and content matches', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = '';

		// Return recipe content from the content fetcher
		vi.mocked(fetchPageContent).mockResolvedValueOnce(RECIPE_CONTENT);

		const file = new TFile('notes/recipe.md');
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

		const file = new TFile('notes/recipe.md');
		await invokeCommand(file);

		// The summarizer should have been called with undefined (style default)
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBeUndefined();
	});

	it('customPrompt takes precedence over template detection', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = 'My custom override prompt';

		vi.mocked(fetchPageContent).mockResolvedValueOnce(RECIPE_CONTENT);

		const file = new TFile('notes/recipe.md');
		await invokeCommand(file);

		// The summarizer should have been called with the custom prompt
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBe('My custom override prompt');
	});

	it('falls back to style prompt when content does not match any template', async () => {
		settings.summarize.autoDetectTemplates = true;
		settings.summarize.customPrompt = '';

		vi.mocked(fetchPageContent).mockResolvedValueOnce(NON_RECIPE_CONTENT);

		const file = new TFile('notes/article.md');
		await invokeCommand(file);

		// The summarizer should have been called with undefined (style default)
		const summarizeCall = lastSummarizerInstance.summarize.mock.calls[0];
		expect(summarizeCall[3]).toBeUndefined();
	});

	it('routes a Reddit URL to the Reddit fetcher, not the generic page fetcher', async () => {
		const redditUrl = 'https://www.reddit.com/r/immich/comments/abc123/title/';
		vi.mocked(findSummarizeTargets).mockReturnValueOnce([
			{ type: 'url', source: redditUrl, line: 2, endLine: 2 },
		]);
		// Clear cross-test accumulation so the assertions reflect only this run.
		vi.mocked(fetchPageContent).mockClear();
		vi.mocked(fetchRedditContent).mockClear();

		const file = new TFile('notes/reddit.md');
		await invokeCommand(file);

		expect(fetchRedditContent).toHaveBeenCalledWith(redditUrl, expect.any(Number));
		expect(fetchPageContent).not.toHaveBeenCalled();
	});
});

// ── Note-content summarization (#367) ─────────────────────────────────

describe('SummarizeModule note content (#367)', () => {
	let module: SummarizeModule;
	let mockPlugin: MockPlugin;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn<(file: unknown) => Promise<string>>().mockResolvedValue('# Title\n\nThe note body prose.\n'),
					process: vi.fn(async (file: unknown, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn<(cmd: MockCommand) => void>(),
			registerEvent: vi.fn(),
		};

		mockNotifications = createMockNotifications();
		module = new SummarizeModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			mockNotifications as unknown as NotificationManager,
			createMockCheckpointManager() as unknown as CheckpointManager,
			new CommandRegistrar(
				mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
			),
		);
	});

	async function runSummarize(path = 'notes/My Note.md'): Promise<void> {
		await module.onload();
		const cmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];
		await cmd.editorCallback?.({}, { file: new TFile(path) });
	}

	it('summarizes a prose-only note when includeNoteContent is on', async () => {
		vi.mocked(findSummarizeTargets).mockReturnValueOnce([]);
		vi.mocked(extractNoteProse).mockReturnValueOnce('The note body prose.');

		await runSummarize();

		expect(lastSummarizerInstance.summarize).toHaveBeenCalledTimes(1);
		expect(lastSummarizerInstance.summarize.mock.calls[0][0]).toContain('The note body prose.');
		expect(mockPlugin.app.vault.process).toHaveBeenCalled();
	});

	it('treats a prose-only note as nothing to summarize when includeNoteContent is off', async () => {
		settings.summarize.includeNoteContent = false;
		vi.mocked(findSummarizeTargets).mockReturnValueOnce([]);
		vi.mocked(extractNoteProse).mockReturnValue('Prose that should be ignored.');

		await runSummarize();

		expect(mockNotifications.info).toHaveBeenCalledWith(
			'No note content, URLs, transcriptions, or audio to summarize in this note'
		);
		expect(lastSummarizerInstance.summarize).not.toHaveBeenCalled();
	});
});
