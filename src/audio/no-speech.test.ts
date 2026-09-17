import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';

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
import { AIClient, NoSpeechDetectedError, NoteOperationQueue } from '../shared';
import type { NotificationManager, CheckpointManager } from '../shared';
import type { AudioEmbed } from './types';
import { DEFAULT_SETTINGS } from '../settings';

interface MockPlugin {
	app: {
		vault: {
			process: Mock<(file: unknown, fn: (data: string) => string) => Promise<string>>;
			readBinary: ReturnType<typeof vi.fn>;
		};
		workspace: { getActiveFile: ReturnType<typeof vi.fn> };
	};
}

const tfile = (p: string): ObsidianTFile => new TFile(p) as unknown as ObsidianTFile;

const NOTE = ['# Memo', '', '![[silent.mp3]]', '', '![[talk.mp3]]', '', 'tail'].join('\n');

function createMockNotifications() {
	const handle = { update: vi.fn(), progress: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false };
	return {
		startOperation: vi.fn().mockReturnValue(handle),
		info: vi.fn(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(false),
		_handle: handle,
	};
}

describe('AudioModule no-speech handling (#524)', () => {
	let plugin: MockPlugin;
	let notifications: ReturnType<typeof createMockNotifications>;
	let checkpoints: ReturnType<typeof createMockCheckpointManager>;
	let completeSpy: MockInstance<typeof AIClient.prototype.complete>;
	let module: AudioModule;
	let onComplete: Mock<(filePath: string) => void>;

	const embeds = (): AudioEmbed[] => [
		{ fileName: 'silent.mp3', file: tfile('audio/silent.mp3'), line: 2 },
		{ fileName: 'talk.mp3', file: tfile('audio/talk.mp3'), line: 4 },
	];

	beforeEach(() => {
		transcribeMock.mockReset();
		completeSpy = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue('A cleaned transcript of the talk.');
		notifications = createMockNotifications();
		checkpoints = createMockCheckpointManager();
		plugin = {
			app: {
				vault: {
					process: vi.fn(async (_file: unknown, fn: (data: string) => string) => fn(NOTE)),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
				},
				workspace: { getActiveFile: vi.fn().mockReturnValue(tfile('notes/memo.md')) },
			},
		};
		const settings = structuredClone(DEFAULT_SETTINGS);
		module = new AudioModule(
			makeModuleDeps({
				plugin: plugin as unknown as Plugin,
				getSettings: () => settings,
				notifications: notifications as unknown as NotificationManager,
				checkpointManager: checkpoints as unknown as CheckpointManager,
				noteQueue: new NoteOperationQueue(),
			}),
			undefined
		);
		(module as unknown as { interFileDelayMs: number }).interFileDelayMs = 0;
		onComplete = vi.fn();
		module.onTranscriptionComplete = onComplete;
	});

	afterEach(() => vi.restoreAllMocks());

	describe('transcribe', () => {
		it('propagates the provider no-speech outcome without any AI call', async () => {
			transcribeMock.mockRejectedValue(new NoSpeechDetectedError());

			await expect(module.transcribe(new ArrayBuffer(8), 'silent.mp3')).rejects.toBeInstanceOf(NoSpeechDetectedError);
			expect(completeSpy).not.toHaveBeenCalled();
		});

		it.each(['', '   ', '<script>x</script>'])(
			'turns a blank sanitized transcript %j into NoSpeechDetectedError without any AI call',
			async (raw) => {
				transcribeMock.mockResolvedValue({ raw, sourceName: 'silent.mp3' });

				await expect(module.transcribe(new ArrayBuffer(8), 'silent.mp3')).rejects.toBeInstanceOf(NoSpeechDetectedError);
				expect(completeSpy).not.toHaveBeenCalled();
			}
		);
	});

	describe('processTranscriptText', () => {
		it.each(['', '   '])('makes no AI call and returns the input for %j', async (raw) => {
			const result = await module.processTranscriptText(raw);

			expect(result.text).toBe(raw);
			expect(result.reformatted).toBeUndefined();
			expect(completeSpy).not.toHaveBeenCalled();
		});
	});

	describe('transcribeFileToActiveNote', () => {
		it('leaves the note untouched and shows a no-speech notice', async () => {
			transcribeMock.mockRejectedValue(new NoSpeechDetectedError());

			await module.transcribeFileToActiveNote(tfile('audio/silent.mp3'));

			expect(plugin.app.vault.process).not.toHaveBeenCalled();
			expect(onComplete).not.toHaveBeenCalled();
			expect(notifications._handle.error).not.toHaveBeenCalled();
			expect(notifications._handle.finish).toHaveBeenCalledWith(
				'No speech detected in silent.mp3 — nothing to transcribe'
			);
		});
	});

	describe('transcribeAndInsert', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		async function run(): Promise<void> {
			const pending = module.transcribeAndInsert(tfile('notes/memo.md'), embeds());
			await vi.runAllTimersAsync();
			await pending;
		}

		it('inserts only the embeds that carry speech', async () => {
			transcribeMock.mockImplementation(async (_data: ArrayBuffer, fileName: string) => {
				if (fileName === 'silent.mp3') throw new NoSpeechDetectedError();
				return { raw: 'A real transcript of the talk.', sourceName: fileName };
			});

			await run();

			expect(plugin.app.vault.process).toHaveBeenCalledTimes(1);
			const written = await plugin.app.vault.process.mock.results[0].value as string;
			expect(written).toContain('Transcription of talk.mp3');
			expect(written).not.toContain('Transcription of silent.mp3');
			expect(notifications.info).toHaveBeenCalledWith('No speech detected in silent.mp3 — nothing to transcribe');
			expect(notifications.notifyError).not.toHaveBeenCalled();
			expect(checkpoints.completeItem).toHaveBeenCalledTimes(2);
		});

		it('leaves the note untouched when no embed carries speech', async () => {
			transcribeMock.mockRejectedValue(new NoSpeechDetectedError());

			await run();

			expect(plugin.app.vault.process).not.toHaveBeenCalled();
			expect(onComplete).not.toHaveBeenCalled();
			expect(notifications.notifyError).not.toHaveBeenCalled();
		});
	});

	describe('transcribeAndInsertCombined (per-file text merge)', () => {
		it('leaves the note untouched when every file is silent', async () => {
			transcribeMock.mockRejectedValue(new NoSpeechDetectedError());

			await module.transcribeAndInsertCombined(tfile('notes/memo.md'), embeds());

			expect(plugin.app.vault.process).not.toHaveBeenCalled();
			expect(onComplete).not.toHaveBeenCalled();
			expect(notifications._handle.error).not.toHaveBeenCalled();
			expect(notifications._handle.finish).toHaveBeenCalledWith(
				'No speech detected in 2 audio files — nothing to transcribe'
			);
		});

		it('merges only the files that carry speech', async () => {
			transcribeMock.mockImplementation(async (_data: ArrayBuffer, fileName: string) => {
				if (fileName === 'silent.mp3') throw new NoSpeechDetectedError();
				return { raw: 'A real transcript of the talk.', sourceName: fileName };
			});

			await module.transcribeAndInsertCombined(tfile('notes/memo.md'), embeds());

			const written = await plugin.app.vault.process.mock.results[0].value as string;
			expect(written).toContain('A cleaned transcript of the talk.');
			expect(notifications.info).toHaveBeenCalledWith('No speech detected in silent.mp3 — nothing to transcribe');
		});
	});
});
