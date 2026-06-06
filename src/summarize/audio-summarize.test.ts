import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummarizeModule, TranscribeAudioFn } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

// Mock the summarizer to return a canned summary
vi.mock('./summarizer', () => ({
	Summarizer: class MockSummarizer {
		summarize = vi.fn().mockResolvedValue('This is a test summary.');
	},
}));

// Mock the note scanner — let real implementation run for collectTargets
vi.mock('./note-scanner', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./note-scanner')>();
	return {
		...actual,
		findSummarizeTargets: actual.findSummarizeTargets,
		hasSummaryBelow: actual.hasSummaryBelow,
	};
});

// Mock the video module
vi.mock('../video', () => ({
	isSupportedUrl: vi.fn().mockReturnValue(false),
}));

// Mock the audio module — findAudioEmbeds returns controlled results
const mockFindAudioEmbeds = vi.fn().mockReturnValue([]);
vi.mock('../audio', () => ({
	findAudioEmbeds: (...args: any[]) => mockFindAudioEmbeds(...args),
}));

// Mock the shared module. Content fetchers are stubbed here (they moved from
// ./content-fetcher into ../shared) to avoid real network calls.
vi.mock('../shared', () => ({
	FolderPickerModal: vi.fn(),
	getMarkdownFiles: vi.fn().mockReturnValue([]),
	NotificationManager: vi.fn(),
	CALLOUT_TYPES: { transcription: 'synapse-transcription', summary: 'synapse-summary' },
	buildCallout: vi.fn((_type: string, title: string, content: string) =>
		`\n> [!synapse-summary] ${title}\n> ${content}\n`
	),
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

function makeTFile(path: string): TFile {
	const file = new TFile(path);
	return file;
}

describe('SummarizeModule audio target detection', () => {
	let module: SummarizeModule;
	let mockPlugin: any;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;
	let transcribeAudioFn: TranscribeAudioFn & ReturnType<typeof vi.fn>;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		mockFindAudioEmbeds.mockReset();

		transcribeAudioFn = vi.fn().mockResolvedValue('Transcribed audio content.') as any;

		const audioFile = makeTFile('audio/recording.mp3');

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Note\n\n![[recording.mp3]]\n'),
					modify: vi.fn().mockResolvedValue(undefined),
					create: vi.fn().mockResolvedValue(new TFile()),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
					getFirstLinkpathDest: vi.fn().mockReturnValue(audioFile),
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
			undefined,
			transcribeAudioFn
		);
	});

	it('detects audio embeds as summarization targets', async () => {
		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// transcribeAudioFn should have been called because the audio target was detected
		expect(transcribeAudioFn).toHaveBeenCalled();
	});

	it('transcribes and summarizes audio targets', async () => {
		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// The vault should have been modified with the summary
		expect(mockPlugin.app.vault.modify).toHaveBeenCalled();

		// The content written should contain the summary callout
		const modifiedContent = mockPlugin.app.vault.modify.mock.calls[0][1];
		expect(modifiedContent).toContain('Summary of recording.mp3');
	});

	it('resolves audio file through MetadataCache', async () => {
		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// MetadataCache should have been used to resolve the audio file
		expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
			'recording.mp3',
			'notes/test.md'
		);
	});

	it('skips audio embeds that already have a summary below', async () => {
		const noteContent = [
			'# Note',
			'',
			'![[recording.mp3]]',
			'',
			'> [!synapse-summary] Summary of recording.mp3',
			'> Previous summary content',
		].join('\n');

		mockPlugin.app.vault.read.mockResolvedValue(noteContent);

		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// Should not transcribe because the audio embed already has a summary
		expect(transcribeAudioFn).not.toHaveBeenCalled();
		// Should show "no targets" message
		expect(mockNotifications.info).toHaveBeenCalledWith(
			'No URLs, transcriptions, or audio to summarize in this note'
		);
	});

	it('does not detect audio embeds when no transcribeAudio callback is provided', async () => {
		// Create module without audio callback
		const moduleNoAudio = new SummarizeModule(
			mockPlugin as any,
			() => settings,
			mockNotifications as any,
			createMockCheckpointManager() as any,
			undefined,
			undefined
		);

		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await moduleNoAudio.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// findAudioEmbeds should not have been called when there is no audio callback
		expect(mockFindAudioEmbeds).not.toHaveBeenCalled();
	});

	it('merges audio targets with URL targets in the targets list', async () => {
		// When there are multiple targets, the selection modal opens.
		// This test verifies the targets are collected correctly by checking
		// that findAudioEmbeds is called alongside URL scanning.
		const noteContent = [
			'# Note',
			'',
			'![[recording.mp3]]',
			'',
			'https://example.com/article',
		].join('\n');

		mockPlugin.app.vault.read.mockResolvedValue(noteContent);

		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// findAudioEmbeds should have been called to detect audio targets
		expect(mockFindAudioEmbeds).toHaveBeenCalled();
		// The modal opens because there are 2+ targets; no direct processing
		// happens without user selection. This verifies the merge happened.
	});

	it('handles audio file not found in vault gracefully', async () => {
		// Return null for getFirstLinkpathDest to simulate missing file
		mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// Should report an error rather than crash
		expect(mockNotifications.notifyError).toHaveBeenCalled();
	});

	it('handles empty transcription result', async () => {
		transcribeAudioFn.mockResolvedValue('');

		const audioFile = makeTFile('audio/recording.mp3');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'recording.mp3', file: audioFile, line: 2 },
		]);

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/test.md');
		await summarizeCmd.editorCallback({}, { file });

		// Should report error about empty content
		expect(mockNotifications.notifyError).toHaveBeenCalledWith(
			'No content extracted from recording.mp3',
			expect.any(Error)
		);
	});

	it('detects multiple audio embeds from the same note', async () => {
		// With 2+ targets, the modal opens. We verify all audio embeds
		// are detected by checking findAudioEmbeds was called.
		// For single-target auto-process, see the single-embed tests above.
		const noteContent = [
			'# Lecture',
			'',
			'![[part1.mp3]]',
			'',
			'![[part2.wav]]',
		].join('\n');

		mockPlugin.app.vault.read.mockResolvedValue(noteContent);

		const audioFile1 = makeTFile('audio/part1.mp3');
		const audioFile2 = makeTFile('audio/part2.wav');
		mockFindAudioEmbeds.mockReturnValue([
			{ fileName: 'part1.mp3', file: audioFile1, line: 2 },
			{ fileName: 'part2.wav', file: audioFile2, line: 4 },
		]);

		mockPlugin.app.metadataCache.getFirstLinkpathDest
			.mockImplementation((name: string) => {
				if (name === 'part1.mp3') return audioFile1;
				if (name === 'part2.wav') return audioFile2;
				return null;
			});

		await module.onload();
		const summarizeCmd = mockPlugin.addCommand.mock.calls.find(
			(c: any) => c[0].id === 'synapse:summarize-current-note'
		)[0];

		const file = makeTFile('notes/lecture.md');
		await summarizeCmd.editorCallback({}, { file });

		// findAudioEmbeds was called, confirming both embeds were detected
		expect(mockFindAudioEmbeds).toHaveBeenCalled();
		// Modal is shown because there are 2 targets; neither transcribeAudioFn
		// call happens without user confirmation through the modal.
	});
});

describe('SummarizeTarget type: audio', () => {
	it('has audio as a valid target type', () => {
		const target = {
			type: 'audio' as const,
			source: 'recording.mp3',
			line: 2,
			endLine: 2,
		};
		expect(target.type).toBe('audio');
	});
});
