import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule, TranscribeAudioFn } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import { SummarizeTarget } from './types';

vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
	},
}));

vi.mock('./note-scanner', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./note-scanner')>();
	return { ...actual };
});

const mockFindAudioEmbeds = vi.fn().mockReturnValue([]);
vi.mock('../audio', () => ({
	findAudioEmbeds: (...args: any[]) => mockFindAudioEmbeds(...args),
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
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
		_handle: handle,
	};
}

const NOTE = '# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n';

describe('SummarizeModule combined summarization (#367)', () => {
	let module: SummarizeModule;
	let mockPlugin: any;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let transcribeAudio: TranscribeAudioFn & ReturnType<typeof vi.fn>;

	const part1 = new TFile('audio/part1.mp3');
	const part2 = new TFile('audio/part2.wav');

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		mockFindAudioEmbeds.mockReset();
		mockFindAudioEmbeds.mockReturnValue([]);

		transcribeAudio = vi.fn().mockResolvedValue('single transcript') as any;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue(NOTE),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write (mirrors Vault.process).
					process: vi.fn(async (file: any, fn: (data: string) => string) =>
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
			mockPlugin,
			() => settings,
			notifications as any,
			createMockCheckpointManager() as any,
			new CommandRegistrar(mockPlugin as any),
			undefined,
			transcribeAudio
		);
	});

	const audio = (source: string, line: number): SummarizeTarget => ({ type: 'audio', source, line, endLine: line });
	const file = () => new TFile('notes/lecture.md');

	async function written(): Promise<string> {
		const calls = mockPlugin.app.vault.process.mock.results;
		return (await calls[calls.length - 1].value) as string;
	}

	it('transcribes each selected audio once and writes a single combined summary', async () => {
		await (module as any).processTargetsCombined(file(), [audio('part1.mp3', 2), audio('part2.wav', 4)], NOTE);

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
		await (module as any).processTargetsCombined(file(), [audio('part1.mp3', 2), audio('part2.wav', 4)], NOTE);

		const out = await written();
		expect(out.indexOf('Combined summary')).toBeGreaterThan(out.indexOf('part2.wav'));
	});

	it('falls back to a per-item summary for a single selected item', async () => {
		await (module as any).processTargetsCombined(file(), [audio('part1.mp3', 2)], '# Lecture\n\n![[part1.mp3]]\n');

		expect(transcribeAudio).toHaveBeenCalledTimes(1);
		const out = await written();
		expect(out).toContain('Summary of part1.mp3');
		expect(out).not.toContain('Combined summary');
	});

	it('reuses an existing transcript instead of re-transcribing it', async () => {
		const transcription: SummarizeTarget = {
			type: 'transcription', source: 'clip.mp4', line: 1, endLine: 3, content: 'existing transcript text',
		};
		await (module as any).processTargetsCombined(file(), [transcription, audio('part1.mp3', 5)], NOTE);

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
		await (module as any).processTargetsCombined(file(), [noteContent, url], NOTE);

		// Prose is reused (never transcribed); the URL is fetched.
		expect(transcribeAudio).not.toHaveBeenCalled();
		const out = await written();
		expect(out).toContain('Combined summary (2 items)');
		expect(out).toContain('Note: lecture');
		expect(out).toContain('https://example.com');
	});
});
