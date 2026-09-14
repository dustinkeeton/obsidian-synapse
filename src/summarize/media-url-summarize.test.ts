import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { SummarizeModule, TranscribeUrlFn } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import { fetchPageContent, getMarkdownFiles } from '../shared';
import { extractNoteProse, findSummarizeTargets } from './note-scanner';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';
import { NoteOperationQueue } from '../shared';
import type { NotificationManager, CheckpointManager } from '../shared';

interface MockCommand {
	id: string;
	name: string;
	editorCallback?: (editor: unknown, ctx: unknown) => unknown;
}

interface MockPlugin {
	app: {
		vault: {
			read: Mock<(file: unknown) => Promise<string>>;
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

const VIDEO_URL = 'https://www.youtube.com/watch?v=abc123';
const TRANSCRIPT = 'Welcome to the show, today we discuss transcript caching.';

vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('A genuine content summary.');
	},
}));

vi.mock('./note-scanner', () => ({
	findSummarizeTargets: vi.fn().mockReturnValue([
		{ type: 'url', source: 'https://www.youtube.com/watch?v=abc123', line: 2, endLine: 2 },
	]),
	extractNoteProse: vi.fn().mockReturnValue(''),
	hasSummaryBelow: vi.fn().mockReturnValue(false),
}));

vi.mock('../audio', () => ({
	findAudioEmbeds: vi.fn().mockReturnValue([]),
}));

vi.mock('../shared', async () => ({
	...(await vi.importActual<typeof import('../shared/content-schemas')>('../shared/content-schemas')),
	...(await vi.importActual<typeof import('../shared/note-operation-queue')>('../shared/note-operation-queue')),
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	buildCallout: vi.fn((_t: string, title: string, content: string) => `> [!summary] ${title}\n> ${content}`),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	ENRICHMENT_START: '%% synapse-enrichment-start %%',
	ENRICHMENT_END: '%% synapse-enrichment-end %%',
	generateId: vi.fn().mockReturnValue('id-mock'),
	fireAndForget: vi.fn(),
	isPathExcluded: vi.fn().mockReturnValue(false),
	matchesExcludeTag: vi.fn().mockReturnValue(false),
	detectSchemaFor: vi.fn().mockReturnValue(null),
	isSupportedUrl: vi.fn((url: string) => url.includes('youtube.com')),
	detectPlatform: vi.fn().mockReturnValue({ platform: 'youtube' }),
	fetchPageContent: vi.fn().mockResolvedValue('<html>YouTube page shell</html>'),
	fetchTweetContent: vi.fn().mockResolvedValue(''),
	isRedditUrl: vi.fn().mockReturnValue(false),
	fetchRedditContent: vi.fn().mockResolvedValue(''),
	linkLoadError: (source: string, reason: string) => `Could not load content from ${source}: ${reason}`,
	CheckpointManager: class {
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
	};
}

describe('SummarizeModule media URLs (#488)', () => {
	let module: SummarizeModule;
	let mockPlugin: MockPlugin;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let noteContent: string;

	function build(transcribeUrl?: TranscribeUrlFn): SummarizeModule {
		return new SummarizeModule(
			makeModuleDeps({
				plugin: mockPlugin as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as unknown as NotificationManager,
				checkpointManager: createMockCheckpointManager() as unknown as CheckpointManager,
				registrar: new CommandRegistrar(
					mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
				),
				noteQueue: new NoteOperationQueue(),
			}),
			transcribeUrl
		);
	}

	async function runSummarize(file = new TFile('notes/video.md')): Promise<void> {
		await module.onload();
		const cmd = mockPlugin.addCommand.mock.calls.find(
			(c) => c[0].id === 'summarize-current-note',
		)![0];
		await cmd.editorCallback?.({}, { file });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.summarize.includeNoteContent = false;
		noteContent = `# Note\n\n${VIDEO_URL}\n`;
		vi.mocked(extractNoteProse).mockReturnValue('');
		vi.mocked(findSummarizeTargets).mockImplementation(() => [
			{ type: 'url', source: VIDEO_URL, line: 2, endLine: 2 },
		]);

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn<(file: unknown) => Promise<string>>().mockImplementation(() => Promise.resolve(noteContent)),
					process: vi.fn(async (_file: unknown, fn: (data: string) => string) => {
						noteContent = fn(noteContent);
						return noteContent;
					}),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				},
				metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn<(cmd: MockCommand) => void>(),
			registerEvent: vi.fn(),
		};
		notifications = createMockNotifications();
	});

	it('summarizes the transcript and never inserts transcript text into the note', async () => {
		module = build(vi.fn().mockResolvedValue(TRANSCRIPT));

		await runSummarize();

		expect(noteContent).toContain(`Summary of ${VIDEO_URL}`);
		expect(noteContent).toContain('A genuine content summary.');
		expect(noteContent).not.toContain(TRANSCRIPT);
		expect(noteContent).not.toContain('Transcription of');
		expect(fetchPageContent).not.toHaveBeenCalled();
	});

	it('inserts no summary and never fetches page HTML when transcription fails', async () => {
		module = build(vi.fn().mockRejectedValue(new Error('No transcription path available for the URL (captions: unavailable)')));

		await runSummarize();

		expect(fetchPageContent).not.toHaveBeenCalled();
		expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
		expect(noteContent).not.toContain('Summary of');
		expect(notifications.error).toHaveBeenCalledTimes(1);
		expect(notifications.error.mock.calls[0][0]).toMatch(/No transcription path available/);
	});

	it('treats a media URL with no transcription callback as failed rather than fetching the page', async () => {
		module = build(undefined);

		await runSummarize();

		expect(fetchPageContent).not.toHaveBeenCalled();
		expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
		expect(notifications.error).toHaveBeenCalledTimes(1);
	});

	it('skips the combined summary entirely when the media transcript is missing', async () => {
		settings.summarize.includeNoteContent = true;
		settings.summarize.combineSummaries = true;
		vi.mocked(extractNoteProse).mockReturnValue('My notes mention the video above.');
		const file = new TFile('notes/video.md') as unknown as ObsidianTFile;
		vi.mocked(getMarkdownFiles).mockReturnValue([file]);
		module = build(vi.fn().mockRejectedValue(new Error('captions unavailable')));

		await module.scanVault(undefined, true, file);

		expect(fetchPageContent).not.toHaveBeenCalled();
		expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
		expect(noteContent).not.toContain('Combined summary');
		expect(notifications.error).toHaveBeenCalledTimes(1);
	});

	it('combines the transcript with note prose when transcription succeeds', async () => {
		settings.summarize.includeNoteContent = true;
		settings.summarize.combineSummaries = true;
		vi.mocked(extractNoteProse).mockReturnValue('My notes mention the video above.');
		const file = new TFile('notes/video.md') as unknown as ObsidianTFile;
		vi.mocked(getMarkdownFiles).mockReturnValue([file]);
		module = build(vi.fn().mockResolvedValue(TRANSCRIPT));

		await module.scanVault(undefined, true, file);

		expect(noteContent).toContain('Combined summary (2 items)');
		expect(noteContent).not.toContain(TRANSCRIPT);
		expect(notifications.error).not.toHaveBeenCalled();
	});
});
