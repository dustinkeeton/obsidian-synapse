import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

const { transcribeMock } = vi.hoisted(() => ({ transcribeMock: vi.fn() }));

vi.mock('./transcriber', () => ({
	Transcriber: class {
		transcribe = transcribeMock;
	},
	GEMINI_MAX_INLINE_AUDIO_BYTES: 15 * 1024 * 1024,
}));

import { AudioModule } from './index';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';
import { AIClient, NoteOperationQueue } from '../shared';
import type { NotificationManager, CheckpointManager } from '../shared';
import type { AudioEmbed } from './types';
import { DEFAULT_SETTINGS } from '../settings';

type Dispatcher = { dispatch: (messages: unknown) => Promise<string> };

const tfile = (p: string): ObsidianTFile => new TFile(p) as unknown as ObsidianTFile;
const NOTE = ['# Memo', '', '![[one.mp3]]', '', '![[two.mp3]]', '', 'tail'].join('\n');

describe('AudioModule response-cache reporting (#527)', () => {
	let finish: Mock<(message?: string) => void>;
	let module: AudioModule;

	const embeds = (): AudioEmbed[] => [
		{ fileName: 'one.mp3', file: tfile('audio/one.mp3'), line: 2 },
		{ fileName: 'two.mp3', file: tfile('audio/two.mp3'), line: 4 },
	];

	beforeEach(() => {
		transcribeMock.mockReset();
		transcribeMock.mockImplementation((_data: ArrayBuffer, fileName: string) =>
			Promise.resolve({ raw: `spoken words recorded in ${fileName}`, sourceName: fileName })
		);
		vi.spyOn(AIClient.prototype as unknown as Dispatcher, 'dispatch').mockResolvedValue('A cleaned transcript.');
		finish = vi.fn<(message?: string) => void>();
		const notifications = {
			startOperation: vi.fn(() => ({ update: vi.fn(), progress: vi.fn(), finish, error: vi.fn(), cancelled: false })),
			info: vi.fn(),
			notifyError: vi.fn(),
		};
		const plugin = {
			app: {
				vault: {
					process: vi.fn(async (_file: unknown, fn: (data: string) => string) => fn(NOTE)),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
				},
				workspace: { getActiveFile: vi.fn().mockReturnValue(tfile('notes/memo.md')) },
			},
		};
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ai.temperature = 0;
		settings.audio.postProcessing.enabled = true;
		settings.audio.postProcessing.addStructure = true;
		module = new AudioModule(
			makeModuleDeps({
				plugin: plugin as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as unknown as NotificationManager,
				checkpointManager: createMockCheckpointManager() as unknown as CheckpointManager,
				noteQueue: new NoteOperationQueue(),
			}),
			undefined
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('flags a transcription whose post-processing was replayed, and not a fresh one', async () => {
		const fresh = await module.transcribe(new ArrayBuffer(8), 'one.mp3');
		const replayed = await module.transcribe(new ArrayBuffer(8), 'one.mp3');

		expect(fresh.aiCached).toBeUndefined();
		expect(replayed.aiCached).toBe(true);
	});

	it('flags replayed caption post-processing from processTranscriptText', async () => {
		const fresh = await module.processTranscriptText('plain caption words from a video');
		const replayed = await module.processTranscriptText('plain caption words from a video');

		expect(fresh.aiCached).toBeUndefined();
		expect(replayed.aiCached).toBe(true);
	});

	it('reports the replay in the single-file finish message only', async () => {
		await module.transcribeFileToActiveNote(tfile('audio/one.mp3'));
		await module.transcribeFileToActiveNote(tfile('audio/one.mp3'));

		expect(finish.mock.calls.map((c) => c[0])).toEqual([
			'Transcription of one.mp3 added to note',
			'Transcription of one.mp3 added to note — used a cached AI response',
		]);
	});

	it('aggregates a batch into one line', async () => {
		await module.transcribe(new ArrayBuffer(8), 'one.mp3');
		vi.useFakeTimers();

		const pending = module.transcribeAndInsert(tfile('notes/memo.md'), embeds());
		await vi.runAllTimersAsync();
		await pending;

		expect(finish).toHaveBeenLastCalledWith('Done -- 2/2 transcriptions added — 1 of 2 served from cache');
	});

	it('keeps the batch message unchanged when nothing was replayed', async () => {
		vi.useFakeTimers();

		const pending = module.transcribeAndInsert(tfile('notes/memo.md'), embeds());
		await vi.runAllTimersAsync();
		await pending;

		expect(finish).toHaveBeenLastCalledWith('Done -- 2/2 transcriptions added');
	});
});
