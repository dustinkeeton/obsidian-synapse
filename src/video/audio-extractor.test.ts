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

	it('maps the ffprobe no-audio-codec stderr to the slideshow message', async () => {
		// metadata dump (#0) succeeds without a no-audio signal; the extraction
		// call (#1) fails with the characteristic ffprobe codec line.
		const stderr = 'ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe.';
		const error = Object.assign(new Error('Command failed'), { code: 1 });
		execFileMock.mockImplementation(
			(_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
				if (args.includes('--dump-json')) {
					// A normal video dump (has an audio-bearing format) so the proactive
					// check does NOT short-circuit — we want the reactive stderr path.
					cb(null, JSON.stringify({ title: 'Clip', formats: [{ acodec: 'aac' }] }), '');
				} else {
					cb(error, '', stderr);
				}
			}
		);

		const ex = makeExtractor();
		await expect(ex.extractFromUrl('https://www.tiktok.com/@user/video/123')).rejects.toThrow(
			/photo slideshow with no audio track/i
		);
	});

	it('reports an actionable "set the ffmpeg path" message when ffprobe is not found', async () => {
		const stderr = 'ERROR: ffprobe/ffmpeg not found. Please install or provide the path using --ffmpeg-location';
		const error = Object.assign(new Error('Command failed'), { code: 1 });
		execFileMock.mockImplementation(
			(_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
				if (args.includes('--dump-json')) {
					cb(null, JSON.stringify({ title: 'Clip', formats: [{ acodec: 'aac' }] }), '');
				} else {
					cb(error, '', stderr);
				}
			}
		);

		const ex = makeExtractor();
		const rejection = ex.extractFromUrl('https://www.tiktok.com/@user/video/123');
		await expect(rejection).rejects.toThrow(/set the ffmpeg path in Synapse settings/i);
		await expect(rejection).rejects.toThrow(/ffmpeg\/ffprobe not found/i);
	});
});

describe('AudioExtractor.extractFromUrl ffmpeg-location & fallback', () => {
	beforeEach(() => {
		execFileMock.mockReset();
	});

	// The dump-json metadata probe must always succeed with an audio-bearing
	// format so the proactive no-audio check never short-circuits; tests then
	// control the extraction call(s) separately.
	function withAudioDump(
		onExtract: (args: string[], cb: (e: unknown, o: string, s: string) => void) => void
	) {
		execFileMock.mockImplementation(
			(_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
				if (args.includes('--dump-json')) {
					cb(null, JSON.stringify({ title: 'Clip', formats: [{ acodec: 'aac', vcodec: 'h264' }] }), '');
				} else {
					onExtract(args, cb);
				}
			}
		);
	}

	function makeExtractor(ffmpegPath?: string): AudioExtractor {
		const ex = new AudioExtractor(() => {
			const s = structuredClone(DEFAULT_SETTINGS);
			if (ffmpegPath !== undefined) {
				s.video.ffmpegPath = ffmpegPath;
			}
			return s;
		});
		(ex as unknown as { _node: unknown })._node = { os, path, execFile: execFileMock };
		return ex;
	}

	function extractCalls(): unknown[][] {
		return execFileMock.mock.calls.filter(
			(c) => !(c[1] as string[]).includes('--dump-json')
		);
	}

	it('omits --ffmpeg-location when ffmpegPath is the bare default', async () => {
		withAudioDump((_args, cb) => cb(null, '', ''));

		// Sanity-check the fixture default is the bare command name.
		expect(DEFAULT_SETTINGS.video.ffmpegPath).toBe('ffmpeg');

		const ex = makeExtractor();
		await ex.extractFromUrl('https://www.tiktok.com/@user/video/123');

		const extract = extractCalls();
		expect(extract).toHaveLength(1);
		expect(extract[0][1] as string[]).not.toContain('--ffmpeg-location');
	});

	it('passes --ffmpeg-location when ffmpegPath is a concrete path', async () => {
		withAudioDump((_args, cb) => cb(null, '', ''));

		const ex = makeExtractor('/opt/homebrew/bin/ffmpeg');
		await ex.extractFromUrl('https://www.tiktok.com/@user/video/123');

		const args = extractCalls()[0][1] as string[];
		const idx = args.indexOf('--ffmpeg-location');
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toBe('/opt/homebrew/bin/ffmpeg');
	});

	it('retries once with a looser -f format after a non-network extraction failure', async () => {
		const error = Object.assign(new Error('Command failed'), { code: 1 });
		let extractAttempts = 0;
		withAudioDump((_args, cb) => {
			extractAttempts += 1;
			if (extractAttempts === 1) {
				// First (strict mp3) attempt fails with a generic, non-network error.
				cb(error, '', 'ERROR: Requested format is not available');
			} else {
				cb(null, '', '');
			}
		});

		const ex = makeExtractor();
		const result = await ex.extractFromUrl('https://www.tiktok.com/@user/video/123');
		expect(result.audioPath).toMatch(/synapse-audio-\d+\.mp3$/);

		const extract = extractCalls();
		expect(extract).toHaveLength(2);
		// The first attempt forces mp3 without an explicit -f selector...
		expect(extract[0][1] as string[]).not.toContain('-f');
		// ...the retry loosens format selection with -f bestaudio/best.
		const retryArgs = extract[1][1] as string[];
		const fIdx = retryArgs.indexOf('-f');
		expect(fIdx).toBeGreaterThan(-1);
		expect(retryArgs[fIdx + 1]).toBe('bestaudio/best');
	});

	it('does NOT retry when a proactive slideshow post is detected from metadata', async () => {
		// Dump reports every format as audio-less (acodec: 'none') -> no audio.
		execFileMock.mockImplementation(
			(_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
				if (args.includes('--dump-json')) {
					cb(null, JSON.stringify({ title: 'Slideshow', formats: [{ acodec: 'none', vcodec: 'none' }] }), '');
				} else {
					cb(null, '', '');
				}
			}
		);

		const ex = makeExtractor();
		await expect(ex.extractFromUrl('https://www.tiktok.com/@user/video/123')).rejects.toThrow(
			/photo slideshow with no audio track/i
		);
		// Failed fast on metadata: no extraction (or fallback) attempt was made.
		expect(extractCalls()).toHaveLength(0);
	});

	it('does NOT retry a network failure on the first extraction attempt', async () => {
		const error = Object.assign(new Error('Command failed'), { code: 1 });
		withAudioDump((_args, cb) =>
			cb(error, '', 'ERROR: unable to download video data: <urlopen error [Errno 61] Connection refused>')
		);

		const ex = makeExtractor();
		await expect(ex.extractFromUrl('https://www.tiktok.com/@user/video/123')).rejects.toThrow(
			/connection refused/i
		);
		// Network errors are surfaced immediately — only the single failed attempt.
		expect(extractCalls()).toHaveLength(1);
	});
});
