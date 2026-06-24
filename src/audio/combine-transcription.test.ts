import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock the transcriber + post-processor so no network/API calls happen.
// The size-cap constant must ride along: the module mock replaces ALL exports,
// and AudioModule's provider-aware size guard reads it.
vi.mock('./transcriber', () => ({
	Transcriber: class {
		transcribe = vi.fn().mockResolvedValue({ raw: 'raw combined transcript', sourceName: 'combined' });
	},
	GEMINI_MAX_INLINE_AUDIO_BYTES: 15 * 1024 * 1024,
}));
vi.mock('./post-processor', () => ({
	PostProcessor: class {
		process = vi.fn().mockResolvedValue('processed combined transcript');
	},
}));

import { AudioModule } from './index';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

// Mock TFile's `vault` is typed `unknown`; cast for typed method signatures.
const tfile = (p: string): any => new TFile(p);

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
		confirm: vi.fn().mockResolvedValue(false),
		_handle: handle,
	};
}

/**
 * Fake AudioExtractor whose concatAudio writes a real temp file (so the
 * module's real fs read/cleanup path exercises end-to-end) and records calls.
 */
function createFakeExtractor(byteSize = 1024) {
	const concatAudio = vi.fn(async (inputs: string[]) => {
		const out = path.join(os.tmpdir(), `synapse-test-combined-${Date.now()}-${Math.round(byteSize)}.mp3`);
		fs.writeFileSync(out, Buffer.alloc(byteSize, 1));
		return out;
	});
	return { concatAudio, checkDependencies: vi.fn().mockResolvedValue({ ytDlp: true, ffmpeg: true }) };
}

describe('AudioModule.transcribeAndInsertCombined', () => {
	let mockPlugin: any;
	let notifications: ReturnType<typeof createMockNotifications>;
	let extractor: ReturnType<typeof createFakeExtractor>;

	const noteContent = ['# Lecture', '', '![[part1.mp3]]', '', '![[part2.wav]]', '', 'tail'].join('\n');

	beforeEach(() => {
		notifications = createMockNotifications();
		extractor = createFakeExtractor();
		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue(noteContent),
					modify: vi.fn().mockResolvedValue(undefined),
					// Atomic read -> transform -> write; the callback's return
					// value is the written content (mirrors Vault.process).
					process: vi.fn(async (file: any, fn: (data: string) => string) =>
						fn(await mockPlugin.app.vault.read(file))
					),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
				},
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			},
		};
	});

	function makeModule(ex: any = extractor, provider = 'whisper-api') {
		return new AudioModule(
			mockPlugin,
			() => ({
				video: { ffmpegPath: 'ffmpeg' },
				audio: { transcriptionProvider: provider },
			}) as any,
			notifications as any,
			createMockCheckpointManager() as any,
			ex
		);
	}

	function embeds(): any[] {
		return [
			{ fileName: 'part1.mp3', file: tfile('audio/part1.mp3'), line: 2 },
			{ fileName: 'part2.wav', file: tfile('audio/part2.wav'), line: 4 },
		];
	}

	it('produces a single Combined transcription callout listing source files', async () => {
		const module = makeModule();
		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		expect(extractor.concatAudio).toHaveBeenCalledTimes(1);
		// Both audio files were read and concatenated.
		expect(extractor.concatAudio.mock.calls[0][0]).toHaveLength(2);

		expect(mockPlugin.app.vault.process).toHaveBeenCalledTimes(1);
		const written = await mockPlugin.app.vault.process.mock.results[0].value as string;

		// Exactly one combined callout, no per-file callouts.
		expect(written).toContain('Combined transcription (2 files)');
		expect((written.match(/Combined transcription/g) || []).length).toBe(1);
		expect(written).toContain('Source files: part1.mp3, part2.wav');
		expect(written).toContain('processed combined transcript');
	});

	it('inserts the callout after the last (highest-line) selected embed', async () => {
		const module = makeModule();
		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
		// Callout comes after the part2 embed and before the trailing line.
		expect(written.indexOf('Combined transcription')).toBeGreaterThan(written.indexOf('![[part2.wav]]'));
		expect(written.indexOf('tail')).toBeGreaterThan(written.indexOf('Combined transcription'));
	});

	it('cleans up all temp files (inputs + combined output)', async () => {
		const module = makeModule();
		const combinedPaths: string[] = [];
		extractor.concatAudio.mockImplementation(async (inputs: string[]) => {
			// inputs must exist at concat time
			for (const i of inputs) expect(fs.existsSync(i)).toBe(true);
			const out = path.join(os.tmpdir(), `synapse-test-cleanup-${Date.now()}.mp3`);
			fs.writeFileSync(out, Buffer.alloc(32, 1));
			combinedPaths.push(out);
			return out;
		});

		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		// Combined output cleaned up.
		for (const p of combinedPaths) expect(fs.existsSync(p)).toBe(false);
		// Input temp files cleaned up.
		const inputs = extractor.concatAudio.mock.calls[0][0] as string[];
		for (const i of inputs) expect(fs.existsSync(i)).toBe(false);
	});

	it('falls back to per-file transcription with fewer than 2 embeds', async () => {
		const module = makeModule();
		const spy = vi.spyOn(module, 'transcribeAndInsert').mockResolvedValue();

		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), [embeds()[0]]);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(extractor.concatAudio).not.toHaveBeenCalled();
	});

	it('offers the per-file fallback at the lower Gemini cap when provider is gemini', async () => {
		// 16 MB: above the 15 MB Gemini inline cap, below the generic 25 MB heuristic.
		extractor = createFakeExtractor(16 * 1024 * 1024);
		const module = makeModule(extractor, 'gemini');
		const spy = vi.spyOn(module, 'transcribeAndInsert').mockResolvedValue();
		notifications.confirm.mockResolvedValue(true); // user picks per-file

		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		expect(notifications.confirm).toHaveBeenCalledWith(
			expect.stringMatching(/Gemini/),
			expect.anything()
		);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('does not warn at 16 MB for non-Gemini providers (generic ~25 MB threshold)', async () => {
		extractor = createFakeExtractor(16 * 1024 * 1024);
		const module = makeModule(extractor, 'whisper-api');

		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		expect(notifications.confirm).not.toHaveBeenCalled();
		expect(mockPlugin.app.vault.process).toHaveBeenCalledTimes(1);
	});

	it('combines via per-file transcription when ffmpeg/extractor is unavailable', async () => {
		const module = makeModule(null); // mobile: no ffmpeg
		(module as any).interFileDelayMs = 0; // skip rate-limit delay in tests

		await module.transcribeAndInsertCombined(tfile('notes/lecture.md'), embeds());

		// No audio concatenation, but still exactly ONE combined callout.
		expect(extractor.concatAudio).not.toHaveBeenCalled();
		expect(mockPlugin.app.vault.process).toHaveBeenCalledTimes(1);
		const written = await mockPlugin.app.vault.process.mock.results[0].value as string;
		expect(written).toContain('Combined transcription (2 files)');
		expect((written.match(/Combined transcription/g) || []).length).toBe(1);
		expect(written).toContain('Source files: part1.mp3, part2.wav');
		// Each file transcribed separately.
		expect(mockPlugin.app.vault.readBinary).toHaveBeenCalledTimes(2);
	});
});
