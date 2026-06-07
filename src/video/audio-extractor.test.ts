import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { AudioExtractor } from './audio-extractor';
import { DEFAULT_SETTINGS } from '../settings';

// Capture the ffmpeg argument array without spawning a process. The extractor
// lazily resolves its node deps through a private `_node` field, so we inject a
// stub execFile directly (a runtime require() of 'child_process' is not
// intercepted by vi.mock).
const execFileMock = vi.fn();

describe('AudioExtractor.concatAudio', () => {
	beforeEach(() => {
		execFileMock.mockReset();
		// (cmd, args, opts, callback) -> succeed with empty stdout
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) =>
				cb(null, '', '')
		);
	});

	function makeExtractor(): AudioExtractor {
		const ex = new AudioExtractor(() => structuredClone(DEFAULT_SETTINGS));
		// Inject node deps so no real process is spawned.
		(ex as unknown as { _node: unknown })._node = { os, path, execFile: execFileMock };
		return ex;
	}

	it('builds a concat-filter command with one -i per input', async () => {
		const ex = makeExtractor();
		const out = await ex.concatAudio(['/a/one.mp3', '/b/two.wav', '/c/three.m4a']);

		expect(out).toMatch(/synapse-combined-\d+\.mp3$/);
		expect(execFileMock).toHaveBeenCalledTimes(1);

		const [cmd, args] = execFileMock.mock.calls[0];
		expect(cmd).toBe('ffmpeg');

		// One -i per input file, each input present.
		expect((args as string[]).filter((a) => a === '-i')).toHaveLength(3);
		expect(args).toContain('/a/one.mp3');
		expect(args).toContain('/b/two.wav');
		expect(args).toContain('/c/three.m4a');
	});

	it('constructs the concat filter graph and re-encodes to mp3', async () => {
		const ex = makeExtractor();
		await ex.concatAudio(['/a/one.mp3', '/b/two.wav']);

		const args = execFileMock.mock.calls[0][1] as string[];
		const fcIdx = args.indexOf('-filter_complex');
		expect(fcIdx).toBeGreaterThan(-1);
		expect(args[fcIdx + 1]).toBe('[0:a][1:a]concat=n=2:v=0:a=1[out]');

		expect(args).toContain('-map');
		expect(args[args.indexOf('-map') + 1]).toBe('[out]');

		// Re-encode (NOT stream copy) so mixed formats combine cleanly.
		expect(args).toContain('-acodec');
		expect(args).toContain('libmp3lame');
		expect(args).not.toContain('-c');
		expect(args).not.toContain('copy');
	});

	it('scales the filter node count with the number of inputs', async () => {
		const ex = makeExtractor();
		await ex.concatAudio(['/1.mp3', '/2.mp3', '/3.ogg', '/4.flac']);

		const args = execFileMock.mock.calls[0][1] as string[];
		const filter = args[args.indexOf('-filter_complex') + 1];
		expect(filter).toBe('[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[out]');
	});

	it('rejects an empty input list', async () => {
		const ex = makeExtractor();
		await expect(ex.concatAudio([])).rejects.toThrow(/at least one/i);
		expect(execFileMock).not.toHaveBeenCalled();
	});
});
