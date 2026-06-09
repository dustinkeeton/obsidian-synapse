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

describe('AudioExtractor.runCommand error classification', () => {
	beforeEach(() => {
		execFileMock.mockReset();
	});

	function makeExtractor(): AudioExtractor {
		const ex = new AudioExtractor(() => structuredClone(DEFAULT_SETTINGS));
		// Inject node deps so no real process is spawned.
		(ex as unknown as { _node: unknown })._node = { os, path, execFile: execFileMock };
		return ex;
	}

	it('classifies a yt-dlp connection-refused failure from full stderr and names the tool', async () => {
		// yt-dlp surfaces the network failure on a stderr line that is NOT the last line.
		const stderr = [
			'ERROR: unable to download video data: <urlopen error [Errno 61] Connection refused>',
			'(Some trailing yt-dlp diagnostic line)',
		].join('\n');
		const error = Object.assign(new Error('Command failed'), { code: 1 });
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) =>
				cb(error, '', stderr)
		);

		const ex = makeExtractor();
		await expect(ex.extractFromUrl('https://www.tiktok.com/@user/video/123')).rejects.toThrow(
			/connection refused/i
		);
		await expect(ex.extractFromUrl('https://www.tiktok.com/@user/video/123')).rejects.toThrow(
			/yt-dlp/
		);
	});

	it('reports a not-found message when the binary is missing (ENOENT)', async () => {
		const error = Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) =>
				cb(error, '', '')
		);

		const ex = makeExtractor();
		const rejection = ex.extractFromUrl('https://www.tiktok.com/@user/video/123');
		await expect(rejection).rejects.toThrow(/not found/i);
		await expect(rejection).rejects.toThrow(/yt-dlp/);
	});

	it('reports a timeout when execFile kills the child via signal (no ETIMEDOUT code)', async () => {
		// execFile's `timeout` option SIGTERMs the child: killed=true, signal set,
		// code null. This must be detected before stderr classification.
		const error = Object.assign(new Error('Command failed'), {
			killed: true,
			signal: 'SIGTERM',
			code: null,
		});
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) =>
				cb(error, '', '')
		);

		const ex = makeExtractor();
		const rejection = ex.extractFromUrl('https://www.tiktok.com/@user/video/123');
		await expect(rejection).rejects.toThrow(/timed out after 5 minutes/);
		await expect(rejection).rejects.toThrow(/yt-dlp/);
	});
});
