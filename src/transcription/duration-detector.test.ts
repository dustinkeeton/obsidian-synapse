import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { Platform, type TFile } from 'obsidian';
import {
	detectLocalFileDuration,
	detectUrlDuration,
	formatTimestamp,
	MIN_SLIDER_DURATION,
	type NodeDeps,
} from './duration-detector';
import { DEFAULT_SETTINGS, type SynapseSettings } from '../settings';
import { mockFile } from '../__test-utils__/mock-factories';

describe('formatTimestamp', () => {
	it('formats 0 seconds as 00:00', () => {
		expect(formatTimestamp(0)).toBe('00:00');
	});

	it('formats seconds under a minute', () => {
		expect(formatTimestamp(45)).toBe('00:45');
	});

	it('formats exactly one minute', () => {
		expect(formatTimestamp(60)).toBe('01:00');
	});

	it('formats minutes and seconds', () => {
		expect(formatTimestamp(90)).toBe('01:30');
	});

	it('formats exactly one hour', () => {
		expect(formatTimestamp(3600)).toBe('01:00:00');
	});

	it('formats hours, minutes, and seconds', () => {
		expect(formatTimestamp(5400)).toBe('01:30:00');
	});

	it('formats large durations with hours', () => {
		expect(formatTimestamp(7261)).toBe('02:01:01');
	});

	it('pads single-digit values', () => {
		expect(formatTimestamp(61)).toBe('01:01');
	});

	it('handles durations just under an hour as MM:SS', () => {
		expect(formatTimestamp(3599)).toBe('59:59');
	});

	it('clamps negative values to 00:00', () => {
		expect(formatTimestamp(-5)).toBe('00:00');
	});

	it('floors fractional seconds', () => {
		expect(formatTimestamp(90.7)).toBe('01:30');
	});
});

describe('MIN_SLIDER_DURATION', () => {
	it('is 10 seconds', () => {
		expect(MIN_SLIDER_DURATION).toBe(10);
	});
});

// --- Injected-dependency tests for the subprocess orchestration ---
//
// detectLocalFileDuration / detectUrlDuration require Node builtins
// (os/path/fs/child_process) at runtime, which vi.mock cannot intercept. The
// functions accept an optional trailing `deps` parameter so tests can stub
// execFile/fs and assert on subprocess wiring without spawning a process.

/** execFile stub shared across the DI tests; reset per-test. */
const execFileMock = vi.fn();

/**
 * Build a NodeDeps with a stubbed execFile and recording fs.promises so tests
 * can introspect the temp-file write/cleanup. Uses real os/path.
 */
function makeDeps(overrides: Partial<NodeDeps> = {}): {
	deps: NodeDeps;
	writeFile: ReturnType<typeof vi.fn>;
	unlink: ReturnType<typeof vi.fn>;
} {
	const writeFile = vi.fn().mockResolvedValue(undefined);
	const unlink = vi.fn().mockResolvedValue(undefined);
	const deps: NodeDeps = {
		os,
		path,
		fs: { promises: { writeFile, unlink } } as unknown as NodeDeps['fs'],
		execFile: execFileMock as unknown as NodeDeps['execFile'],
		...overrides,
	};
	return { deps, writeFile, unlink };
}

/**
 * A TFile-like fixture (the mock TFile derives name/basename from the path).
 * The centralized mock TFile is structurally close but not assignable to the
 * real obsidian TFile type (e.g. its `vault` is `unknown`), so bridge it with a
 * single cast at the fixture boundary.
 */
function makeFile(filePath = 'notes/clip.mp4'): TFile {
	return mockFile(filePath) as unknown as TFile;
}

function settingsWith(overrides: Partial<SynapseSettings['video']> = {}): () => SynapseSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.video = { ...settings.video, ...overrides };
	return () => settings;
}

describe('detectLocalFileDuration (injected deps)', () => {
	beforeEach(() => {
		execFileMock.mockReset();
		Platform.isDesktop = true;
	});

	afterEach(() => {
		Platform.isDesktop = true;
		vi.restoreAllMocks();
	});

	it('derives the ffprobe path from ffmpegPath and probes the temp file', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, '123.45\n')
		);
		const { deps, writeFile } = makeDeps();

		const result = await detectLocalFileDuration(
			makeFile(),
			async () => new ArrayBuffer(8),
			settingsWith({ ffmpegPath: '/opt/homebrew/bin/ffmpeg' }),
			deps
		);

		expect(result.durationSeconds).toBe(123.45);
		expect(result.title).toBe('clip');

		// ffprobe path derived by replacing the trailing "ffmpeg" with "ffprobe".
		const [cmd, args] = execFileMock.mock.calls[0];
		expect(cmd).toBe('/opt/homebrew/bin/ffprobe');
		expect(args).toEqual([
			'-v', 'error',
			'-show_entries', 'format=duration',
			'-of', 'csv=p=0',
			expect.stringContaining('synapse-probe-'),
		]);

		// The temp file written matches the path passed to ffprobe.
		const tempPath = writeFile.mock.calls[0][0] as string;
		expect(tempPath.startsWith(os.tmpdir())).toBe(true);
		expect(args[args.length - 1]).toBe(tempPath);
	});

	it('writes the temp file then cleans it up on success', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, '42\n')
		);
		const { deps, writeFile, unlink } = makeDeps();

		await detectLocalFileDuration(makeFile(), async () => new ArrayBuffer(4), settingsWith(), deps);

		expect(writeFile).toHaveBeenCalledTimes(1);
		expect(unlink).toHaveBeenCalledTimes(1);
		// Cleanup unlinks the same temp file that was written.
		expect(unlink.mock.calls[0][0]).toBe(writeFile.mock.calls[0][0]);
	});

	it('still cleans up the temp file when ffprobe fails', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(new Error('ffprobe boom'), '')
		);
		const { deps, writeFile, unlink } = makeDeps();

		const result = await detectLocalFileDuration(
			makeFile(),
			async () => new ArrayBuffer(4),
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
		expect(unlink).toHaveBeenCalledTimes(1);
		expect(unlink.mock.calls[0][0]).toBe(writeFile.mock.calls[0][0]);
	});

	it('returns undefined duration when ffprobe errors', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(new Error('not found'), '')
		);
		const { deps } = makeDeps();

		const result = await detectLocalFileDuration(
			makeFile(),
			async () => new ArrayBuffer(4),
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
		expect(result.title).toBe('clip');
	});

	it('returns undefined duration when ffprobe stdout is non-numeric', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, 'N/A\n')
		);
		const { deps } = makeDeps();

		const result = await detectLocalFileDuration(
			makeFile(),
			async () => new ArrayBuffer(4),
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
	});

	it('augments PATH with common install locations in the exec env', async () => {
		const original = process.env.PATH;
		process.env.PATH = '/usr/bin';
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, '10\n')
		);
		const { deps } = makeDeps();

		try {
			await detectLocalFileDuration(makeFile(), async () => new ArrayBuffer(4), settingsWith(), deps);
		} finally {
			process.env.PATH = original;
		}

		const opts = execFileMock.mock.calls[0][2] as { env: NodeJS.ProcessEnv; timeout: number };
		expect(opts.env.PATH).toContain('/usr/local/bin');
		expect(opts.env.PATH).toContain('/opt/homebrew/bin');
		expect(opts.env.PATH).toContain('/usr/bin');
		expect(opts.timeout).toBe(15_000);
	});

	it('returns undefined duration without spawning on mobile', async () => {
		Platform.isDesktop = false;
		const readBinary = vi.fn();
		const { deps } = makeDeps();

		const result = await detectLocalFileDuration(
			makeFile('clip.mp4'),
			readBinary,
			settingsWith(),
			deps
		);

		expect(result).toEqual({ durationSeconds: undefined, title: 'clip' });
		expect(execFileMock).not.toHaveBeenCalled();
		expect(readBinary).not.toHaveBeenCalled();
	});
});

describe('detectUrlDuration (injected deps)', () => {
	beforeEach(() => {
		execFileMock.mockReset();
		Platform.isDesktop = true;
	});

	afterEach(() => {
		Platform.isDesktop = true;
	});

	it('parses duration and title from yt-dlp --dump-json output', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) => {
				expect(args).toContain('--dump-json');
				expect(args).toContain('--no-download');
				cb(null, JSON.stringify({ duration: 211.7, title: 'A Clip' }));
			}
		);
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith({ ytDlpPath: '/opt/homebrew/bin/yt-dlp' }),
			deps
		);

		expect(result.durationSeconds).toBe(211.7);
		expect(result.title).toBe('A Clip');
		expect(execFileMock.mock.calls[0][0]).toBe('/opt/homebrew/bin/yt-dlp');
	});

	it('falls back to the url as title when yt-dlp omits a title', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, JSON.stringify({ duration: 5 }))
		);
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBe(5);
		expect(result.title).toBe('https://www.youtube.com/watch?v=abc123');
	});

	it('returns undefined duration when yt-dlp duration is non-numeric', async () => {
		// A successfully-parsed payload with a non-numeric duration still yields a
		// title (only the duration is dropped).
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, JSON.stringify({ duration: 'N/A', title: 'X' }))
		);
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
		expect(result.title).toBe('X');
	});

	it('returns undefined duration when yt-dlp output is not valid JSON', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, 'not json at all')
		);
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
		expect(result.title).toBe('https://www.youtube.com/watch?v=abc123');
	});

	it('returns undefined duration when yt-dlp exec rejects', async () => {
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(new Error('spawn yt-dlp ENOENT'), '')
		);
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith(),
			deps
		);

		expect(result.durationSeconds).toBeUndefined();
		expect(result.title).toBe('https://www.youtube.com/watch?v=abc123');
	});

	it('augments PATH and sets a 30s timeout / 10MB maxBuffer in the exec env', async () => {
		const original = process.env.PATH;
		process.env.PATH = '/usr/bin';
		execFileMock.mockImplementation(
			(_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string) => void) =>
				cb(null, JSON.stringify({ duration: 1, title: 'T' }))
		);
		const { deps } = makeDeps();

		try {
			await detectUrlDuration('https://www.youtube.com/watch?v=abc123', settingsWith(), deps);
		} finally {
			process.env.PATH = original;
		}

		const opts = execFileMock.mock.calls[0][2] as {
			env: NodeJS.ProcessEnv;
			timeout: number;
			maxBuffer: number;
		};
		expect(opts.env.PATH).toContain('/opt/homebrew/bin');
		expect(opts.timeout).toBe(30_000);
		expect(opts.maxBuffer).toBe(10 * 1024 * 1024);
	});

	it('returns undefined duration without spawning on mobile', async () => {
		Platform.isDesktop = false;
		const { deps } = makeDeps();

		const result = await detectUrlDuration(
			'https://www.youtube.com/watch?v=abc123',
			settingsWith(),
			deps
		);

		expect(result).toEqual({
			durationSeconds: undefined,
			title: 'https://www.youtube.com/watch?v=abc123',
		});
		expect(execFileMock).not.toHaveBeenCalled();
	});
});
