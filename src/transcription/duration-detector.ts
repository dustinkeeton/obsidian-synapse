import { Platform, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { sanitizePath, sanitizeUrl, isRecord, parseJson } from '../shared';

/**
 * The subset of yt-dlp `--dump-json` output this detector consumes. Both fields
 * are optional and best-effort: a missing/non-numeric `duration` yields
 * `undefined` and a missing `title` falls back to the URL — neither is an error.
 */
interface YtDlpDurationJson {
	duration?: number;
	title?: string;
}

/** Narrow unknown yt-dlp output to the duration/title subset (non-object → `null`). */
function asYtDlpDurationJson(value: unknown): YtDlpDurationJson | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		duration: typeof value.duration === 'number' ? value.duration : undefined,
		title: typeof value.title === 'string' ? value.title : undefined,
	};
}

/**
 * Result of a duration detection attempt.
 * `durationSeconds` is undefined when detection fails (e.g. missing ffprobe).
 */
export interface DurationResult {
	durationSeconds: number | undefined;
	title: string;
}

/**
 * Node builtins used by the subprocess orchestration. Injected so tests can
 * stub them (a runtime `require` of these inside the function body is not
 * intercepted by `vi.mock`). Defaults to {@link buildRealNodeDeps}.
 */
export interface NodeDeps {
	os: typeof import('os');
	path: typeof import('path');
	fs: typeof import('fs');
	execFile: typeof import('child_process')['execFile'];
}

/**
 * Lazily resolve the real Node builtins via `require`.
 *
 * MUST only be called AFTER the `Platform.isDesktop` guard: on mobile these
 * modules do not exist, so requiring them eagerly (e.g. in a parameter
 * default) would crash. Keeping the requires here preserves the mobile
 * early-return as a require-free path.
 */
function buildRealNodeDeps(): NodeDeps {
	/* eslint-disable @typescript-eslint/no-var-requires -- lazy-load Node builtins so the bundle can load on mobile (isDesktopOnly: false) */
	// Cast each require() value to its module type (matching audio-extractor) so
	// the untyped `require()` result doesn't leak `any` into NodeDeps.
	return {
		os: require('os') as typeof import('os'),
		path: require('path') as typeof import('path'),
		fs: require('fs') as typeof import('fs'),
		execFile: (require('child_process') as typeof import('child_process')).execFile,
	};
	/* eslint-enable @typescript-eslint/no-var-requires -- re-enable now that the lazy Node-builtin loads are done */
}

/**
 * Detect the duration of a local audio file using ffprobe.
 * Returns undefined duration on failure (mobile, missing ffprobe, corrupt file).
 */
export async function detectLocalFileDuration(
	file: TFile,
	readBinary: (file: TFile) => Promise<ArrayBuffer>,
	getSettings: () => SynapseSettings,
	deps?: NodeDeps
): Promise<DurationResult> {
	const title = file.basename;

	if (!Platform.isDesktop) {
		return { durationSeconds: undefined, title };
	}

	try {
		// Resolve real Node builtins only AFTER the mobile guard above, so the
		// mobile early-return never triggers a require().
		const { os, path, fs, execFile } = deps ?? buildRealNodeDeps();

		const data = await readBinary(file);
		// Defense-in-depth: file.name is vault-derived; strip any path-unsafe
		// characters before interpolating it into a filesystem temp path so a
		// crafted basename can never escape os.tmpdir().
		const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
		const tempPath = path.join(os.tmpdir(), `synapse-probe-${Date.now()}-${safeName}`);
		await fs.promises.writeFile(tempPath, Buffer.from(data));

		const ffmpegPath = sanitizePath(getSettings().video.ffmpegPath);
		// Derive ffprobe path from ffmpeg path: replace "ffmpeg" with "ffprobe"
		const ffprobePath = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');

		const duration = await new Promise<number | undefined>((resolve) => {
			execFile(
				ffprobePath,
				[
					'-v', 'error',
					'-show_entries', 'format=duration',
					'-of', 'csv=p=0',
					tempPath,
				],
				{ env: shellEnv(), timeout: 15_000 },
				(error, stdout) => {
					// Fire-and-forget cleanup: the execFile callback is sync, so we
					// can't await here; unlink is a cheap metadata op and its result
					// doesn't affect duration detection.
					void fs.promises.unlink(tempPath).catch(() => { /* ignore */ });
					if (error) {
						resolve(undefined);
						return;
					}
					const seconds = parseFloat(stdout.trim());
					resolve(isNaN(seconds) ? undefined : seconds);
				}
			);
		});

		return { durationSeconds: duration, title };
	} catch {
		return { durationSeconds: undefined, title };
	}
}

/**
 * Detect the duration of a video URL using yt-dlp metadata.
 * Returns undefined duration on failure.
 */
export async function detectUrlDuration(
	url: string,
	getSettings: () => SynapseSettings,
	deps?: NodeDeps
): Promise<DurationResult> {
	if (!Platform.isDesktop) {
		return { durationSeconds: undefined, title: url };
	}

	try {
		const validatedUrl = sanitizeUrl(url);
		// Resolve real Node builtins only AFTER the mobile guard above, so the
		// mobile early-return never triggers a require().
		const { execFile } = deps ?? buildRealNodeDeps();
		const ytDlpPath = sanitizePath(getSettings().video.ytDlpPath);

		const output = await new Promise<string>((resolve, reject) => {
			execFile(
				ytDlpPath,
				['--dump-json', '--no-download', validatedUrl],
				{ env: shellEnv(), maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
				(error, stdout) => {
					if (error) reject(error instanceof Error ? error : new Error(String(error)));
					else resolve(stdout);
				}
			);
		});

		// Parse to `unknown` and narrow before reading. Malformed JSON throws and is
		// caught below into the `{ durationSeconds: undefined, title: url }`
		// fallback; a non-object payload yields all-fallback fields — both match the
		// prior untyped behavior. The guard also drops a non-numeric `duration`
		// (e.g. "N/A") to undefined while preserving any title.
		const data = asYtDlpDurationJson(parseJson(output)) ?? {};
		return {
			durationSeconds: typeof data.duration === 'number' ? data.duration : undefined,
			title: data.title || url,
		};
	} catch {
		return { durationSeconds: undefined, title: url };
	}
}

/**
 * Minimum duration (in seconds) below which the slider is skipped.
 * For very short media, a slider adds friction without value.
 */
export const MIN_SLIDER_DURATION = 10;

/**
 * Format a number of seconds into a display timestamp.
 * Returns MM:SS for durations under an hour, HH:MM:SS otherwise.
 */
export function formatTimestamp(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(s / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;

	if (hours > 0) {
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Obsidian's Electron process has a minimal PATH that often excludes
 * user-installed tools. Append common install locations.
 */
function shellEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const extra = [
		'/usr/local/bin',
		'/opt/homebrew/bin',
		`${process.env.HOME}/.local/bin`,
	];
	const current = env.PATH || '';
	const missing = extra.filter(p => !current.includes(p));
	if (missing.length) {
		env.PATH = missing.join(':') + ':' + current;
	}
	return env;
}
