import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock the transcriber + post-processor so no network/API calls happen.
vi.mock('./transcriber', () => ({
	Transcriber: class {
		transcribe = vi.fn().mockResolvedValue({ raw: 'raw combined transcript', sourceName: 'combined' });
	},
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

	function makeModule(ex: any = extractor) {
		return new AudioModule(
			mockPlugin,
			() => ({ video: { ffmpegPath: 'ffmpeg' } }) as any,
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

describe('AudioModule.transcribeAudioCombined', () => {
	let mockPlugin: any;
	let notifications: ReturnType<typeof createMockNotifications>;

	beforeEach(() => {
		notifications = createMockNotifications();
		mockPlugin = {
			app: {
				vault: { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(64)) },
				workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			},
		};
	});

	function makeModule(ex: any) {
		return new AudioModule(
			mockPlugin,
			() => ({ video: { ffmpegPath: 'ffmpeg' } }) as any,
			notifications as any,
			createMockCheckpointManager() as any,
			ex
		);
	}

	it('returns one combined transcript for multiple files', async () => {
		const extractor = createFakeExtractor();
		const module = makeModule(extractor);

		const text = await module.transcribeAudioCombined([
			tfile('audio/a.mp3'),
			tfile('audio/b.mp3'),
		]);

		expect(extractor.concatAudio).toHaveBeenCalledTimes(1);
		expect(text).toBe('processed combined transcript');
	});

	it('short-circuits a single file without concatenation', async () => {
		const extractor = createFakeExtractor();
		const module = makeModule(extractor);

		const text = await module.transcribeAudioCombined([tfile('audio/solo.mp3')]);

		expect(extractor.concatAudio).not.toHaveBeenCalled();
		expect(text).toBe('processed combined transcript');
	});

	it('merges transcribed text when ffmpeg is unavailable (no concatenation)', async () => {
		const module = makeModule(null); // mobile: no extractor
		(module as any).interFileDelayMs = 0;

		const text = await module.transcribeAudioCombined([
			tfile('audio/a.mp3'),
			tfile('audio/b.mp3'),
		]);

		// Two separate transcriptions merged into one string; no concat.
		expect(mockPlugin.app.vault.readBinary).toHaveBeenCalledTimes(2);
		expect(text).toBe('processed combined transcript\n\nprocessed combined transcript');
	});

	it('warns when the combined audio exceeds the provider size limit', async () => {
		const big = createFakeExtractor(26 * 1024 * 1024); // > 25 MB
		const module = makeModule(big);

		await module.transcribeAudioCombined([
			tfile('audio/a.mp3'),
			tfile('audio/b.mp3'),
		]);

		expect(notifications.info).toHaveBeenCalledWith(expect.stringMatching(/exceed the transcription provider limit/i));
	});
});
