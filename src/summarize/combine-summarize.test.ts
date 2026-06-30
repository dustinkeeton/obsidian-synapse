import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { SummarizeModule, TranscribeAudioFn } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { SummarizeTarget } from './types';
import type { Plugin } from 'obsidian';
import type { NotificationManager, CheckpointManager } from '../shared';
import type { AudioEmbed } from '../audio';

/** Typed shape of the hand-built plugin stub the module consumes. */
interface MockPlugin {
	app: {
		vault: {
			read: Mock<(file: unknown) => Promise<string>>;
			modify: ReturnType<typeof vi.fn>;
			process: Mock<(file: unknown, fn: (data: string) => string) => Promise<string>>;
			create: ReturnType<typeof vi.fn>;
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
			readBinary: ReturnType<typeof vi.fn>;
		};
		metadataCache: {
			getFileCache: ReturnType<typeof vi.fn>;
			getFirstLinkpathDest: ReturnType<typeof vi.fn>;
		};
		workspace: { getActiveFile: ReturnType<typeof vi.fn> };
	};
	addCommand: ReturnType<typeof vi.fn>;
	registerEvent: ReturnType<typeof vi.fn>;
}

/** Typed view of the private combined-summary entry point the tests drive. */
function internals(module: SummarizeModule): {
	processTargetsCombined: (
		file: TFile,
		targets: SummarizeTarget[],
		content: string,
	) => Promise<void>;
} {
	return module as unknown as {
		processTargetsCombined: (
			file: TFile,
			targets: SummarizeTarget[],
			content: string,
		) => Promise<void>;
	};
}

vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
	},
}));

vi.mock('./note-scanner', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./note-scanner')>();
	return { ...actual };
});

const mockFindAudioEmbeds = vi
	.fn<(content: string, sourcePath: string, metadataCache: unknown) => AudioEmbed[]>()
	.mockReturnValue([]);
vi.mock('../audio', () => ({
	findAudioEmbeds: (content: string, sourcePath: string, metadataCache: unknown) =>
		mockFindAudioEmbeds(content, sourcePath, metadataCache),
}));

vi.mock('../shared', async () => ({
	// Use the REAL content-schema registry so auto-format detection runs as in
	// production (the combined path consults detectSchemaFor on the combined text).
	...(await vi.importActual<typeof import('../shared/content-schemas')>('../shared/content-schemas')),
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	buildCallout: vi.fn((_type: string, title: string, content: string) =>
		`\n> [!synapse-summary] ${title}\n> ${content.replace(/\n/g, '\n> ')}\n`
	),
	ENRICHMENT_START: '%% synapse-enrichment-start %%',
	ENRICHMENT_END: '%% synapse-enrichment-end %%',
	generateId: vi.fn().mockReturnValue('id-mock'),
	isSupportedUrl: vi.fn().mockReturnValue(false),
	detectPlatform: vi.fn().mockReturnValue(null),
	fetchPageContent: vi.fn().mockResolvedValue('Fetched URL content for testing.'),
	fetchTweetContent: vi.fn().mockResolvedValue('Tweet content for testing.'),
	isRedditUrl: (url: string) => {
		try {
			const h = new URL(url).hostname.toLowerCase();
			return h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it' || h.endsWith('.redd.it');
		} catch { return false; }
	},
	fetchRedditContent: vi.fn().mockResolvedValue('Reddit content for testing.'),
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
		error: vi.fn<(message: string) => void>(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
		_handle: handle,
	};
}

const NOTE = '# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n';

describe('SummarizeModule combined summarization (#367)', () => {
	let module: SummarizeModule;
	let mockPlugin: MockPlugin;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let transcribeAudio: Mock<TranscribeAudioFn>;

	const part1 = new TFile('audio/part1.mp3');
	const part2 = new TFile('audio/part2.wav');

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		mockFindAudioEmbeds.mockReset();
		mockFindAudioEmbeds.mockReturnValue([]);

		transcribeAudio = vi.fn<TranscribeAudioFn>().mockResolvedValue('single transcript');

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn<(file: unknown) => Promise<string>>().mockResolvedValue(NOTE),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: unknown, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
					getFirstLinkpathDest: vi.fn().mockImplementation((name: string) => {
						if (name === 'part1.mp3') return part1;
						if (name === 'part2.wav') return part2;
						return null;
					}),
				},
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};

		notifications = createMockNotifications();
		module = new SummarizeModule(
			mockPlugin as unknown as Plugin,
			() => settings,
			notifications as unknown as NotificationManager,
			createMockCheckpointManager() as unknown as CheckpointManager,
			new CommandRegistrar(
				mockPlugin as unknown as ConstructorParameters<typeof CommandRegistrar>[0],
			),
			undefined,
			transcribeAudio,
		);
	});

	const audio = (source: string, line: number): SummarizeTarget => ({ type: 'audio', source, line, endLine: line });
	const file = () => new TFile('notes/lecture.md');

	async function written(): Promise<string> {
		const calls = mockPlugin.app.vault.process.mock.results;
		return (await calls[calls.length - 1].value) as string;
	}

	it('transcribes each selected audio once and writes a single combined summary', async () => {
		await internals(module).processTargetsCombined(file(), [audio('part1.mp3', 2), audio('part2.wav', 4)], NOTE);

		// One transcription per file -- no combined-file transcription pass.
		expect(transcribeAudio).toHaveBeenCalledTimes(2);
		expect(mockPlugin.app.vault.process).toHaveBeenCalledTimes(1);

		const out = await written();
		expect(out).toContain('Combined summary (2 items)');
		expect((out.match(/Combined summary/g) || []).length).toBe(1);
		expect(out).toContain('Sources: Audio: part1.mp3, Audio: part2.wav');
		expect(out).toContain('This is a test summary.');
	});

	it('appends the combined callout at the end of the note', async () => {
		await internals(module).processTargetsCombined(file(), [audio('part1.mp3', 2), audio('part2.wav', 4)], NOTE);

		const out = await written();
		expect(out.indexOf('Combined summary')).toBeGreaterThan(out.indexOf('part2.wav'));
	});

	it('falls back to a per-item summary for a single selected item', async () => {
		await internals(module).processTargetsCombined(file(), [audio('part1.mp3', 2)], '# Lecture\n\n![[part1.mp3]]\n');

		expect(transcribeAudio).toHaveBeenCalledTimes(1);
		const out = await written();
		expect(out).toContain('Summary of part1.mp3');
		expect(out).not.toContain('Combined summary');
	});

	it('reuses an existing transcript instead of re-transcribing it', async () => {
		const transcription: SummarizeTarget = {
			type: 'transcription', source: 'clip.mp4', line: 1, endLine: 3, content: 'existing transcript text',
		};
		await internals(module).processTargetsCombined(file(), [transcription, audio('part1.mp3', 5)], NOTE);

		// Only the audio target is transcribed; the transcription block is reused.
		expect(transcribeAudio).toHaveBeenCalledTimes(1);
		const out = await written();
		expect(out).toContain('Combined summary (2 items)');
		expect(out).toContain('Transcription: clip.mp4');
		expect(out).toContain('Audio: part1.mp3');
	});

	it("combines the note's own prose with a URL reference into one summary", async () => {
		const noteContent: SummarizeTarget = {
			type: 'note-content', source: 'lecture', line: 9, endLine: 9, content: 'The lecture covered A and B.',
		};
		const url: SummarizeTarget = { type: 'url', source: 'https://example.com', line: 2, endLine: 2 };
		await internals(module).processTargetsCombined(file(), [noteContent, url], NOTE);

		// Prose is reused (never transcribed); the URL is fetched.
		expect(transcribeAudio).not.toHaveBeenCalled();
		const out = await written();
		expect(out).toContain('Combined summary (2 items)');
		expect(out).toContain('Note: lecture');
		expect(out).toContain('https://example.com');
	});

	it('reports combined-path link failures with the standardized linkLoadError notice', async () => {
		const { fetchPageContent } = await import('../shared');
		vi.mocked(fetchPageContent)
			.mockRejectedValueOnce(new Error('Reddit returned HTTP 429'))
			.mockResolvedValueOnce('   ');

		const url1: SummarizeTarget = { type: 'url', source: 'https://example.com/a', line: 2, endLine: 2 };
		const url2: SummarizeTarget = { type: 'url', source: 'https://example.com/b', line: 3, endLine: 3 };
		await internals(module).processTargetsCombined(file(), [url1, url2], NOTE);

		// Both failure shapes (thrown + empty) now use notifications.error(linkLoadError(...)),
		// matching the per-item summarize path and Elaborate -- NOT the old notifyError.
		expect(notifications.notifyError).not.toHaveBeenCalled();
		const messages = notifications.error.mock.calls.map((c) => c[0]);
		expect(messages).toContain('Could not load content from https://example.com/a: Reddit returned HTTP 429');
		expect(messages).toContain('Could not load content from https://example.com/b: page returned no readable text');
	});
});
