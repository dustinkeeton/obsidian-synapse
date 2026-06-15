import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule, TranscribeAudioFn, TranscribeAudioCombinedFn } from './index';
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

vi.mock('../video', () => ({
	isSupportedUrl: vi.fn().mockReturnValue(false),
}));

const mockFindAudioEmbeds = vi.fn().mockReturnValue([]);
vi.mock('../audio', () => ({
	findAudioEmbeds: (...args: any[]) => mockFindAudioEmbeds(...args),
}));

vi.mock('../shared', async () => ({
	// Use the REAL content-schema registry so auto-format detection runs as in
	// production (this path consults detectSchemaFor on the combined transcript).
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
	fetchPageContent: vi.fn().mockResolvedValue('Some fetched content for testing.'),
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

describe('SummarizeModule combined audio summarization (#214)', () => {
	let module: SummarizeModule;
	let mockPlugin: any;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let transcribeAudio: TranscribeAudioFn & ReturnType<typeof vi.fn>;
	let transcribeAudioCombined: TranscribeAudioCombinedFn & ReturnType<typeof vi.fn>;

	const part1 = new TFile('audio/part1.mp3');
	const part2 = new TFile('audio/part2.wav');

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		mockFindAudioEmbeds.mockReset();
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'part1.mp3', file: part1, line: 2 },
			{ fileName: 'part2.wav', file: part2, line: 4 },
		]);

		transcribeAudio = vi.fn().mockResolvedValue('single transcript') as any;
		transcribeAudioCombined = vi.fn().mockResolvedValue('combined transcript text') as any;

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n'),
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
			transcribeAudio,
			transcribeAudioCombined
		);
	});

	const audioTargets = (): SummarizeTarget[] => [
		{ type: 'audio', source: 'part1.mp3', line: 2, endLine: 2 },
		{ type: 'audio', source: 'part2.wav', line: 4, endLine: 4 },
	];

	const file = () => new TFile('notes/lecture.md');

	it('transcribes and summarizes the combined audio exactly once', async () => {
		await (module as any).processTargetsCombined(file(), audioTargets(), '# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n');

		expect(transcribeAudioCombined).toHaveBeenCalledTimes(1);
		// Both audio files resolved and passed.
		expect(transcribeAudioCombined.mock.calls[0][0]).toHaveLength(2);
		// Per-file transcriber NOT used in combined mode.
		expect(transcribeAudio).not.toHaveBeenCalled();
	});

	it('inserts a single Combined summary callout listing source files', async () => {
		await (module as any).processTargetsCombined(file(), audioTargets(), '# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n');

		expect(mockPlugin.app.vault.process).toHaveBeenCalledTimes(1);
		const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
		expect(written).toContain('Combined summary (2 files)');
		expect((written.match(/Combined summary/g) || []).length).toBe(1);
		expect(written).toContain('Source files: part1.mp3, part2.wav');
	});

	it('falls back to per-target processing with fewer than 2 audio targets', async () => {
		await (module as any).processTargetsCombined(
			file(),
			[{ type: 'audio', source: 'part1.mp3', line: 2, endLine: 2 }],
			'# Lecture\n\n![[part1.mp3]]\n'
		);

		// Per-file path used, not the combined one.
		expect(transcribeAudioCombined).not.toHaveBeenCalled();
		expect(transcribeAudio).toHaveBeenCalledTimes(1);
	});

	it('reports an error when the combined transcript is empty', async () => {
		transcribeAudioCombined.mockResolvedValue('');
		await (module as any).processTargetsCombined(file(), audioTargets(), '# Lecture\n\n![[part1.mp3]]\n\n![[part2.wav]]\n');

		expect(notifications.notifyError).toHaveBeenCalledWith(
			'No content extracted from combined audio',
			expect.any(Error)
		);
		expect(mockPlugin.app.vault.process).not.toHaveBeenCalled();
	});
});
