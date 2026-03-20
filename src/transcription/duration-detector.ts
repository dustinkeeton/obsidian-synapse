import { Platform, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { sanitizePath } from '../shared/validation';

/**
 * Result of a duration detection attempt.
 * `durationSeconds` is undefined when detection fails (e.g. missing ffprobe).
 */
export interface DurationResult {
	durationSeconds: number | undefined;
	title: string;
}

/**
 * Detect the duration of a local audio file using ffprobe.
 * Returns undefined duration on failure (mobile, missing ffprobe, corrupt file).
 */
export async function detectLocalFileDuration(
	file: TFile,
	readBinary: (file: TFile) => Promise<ArrayBuffer>,
	getSettings: () => SynapseSettings
): Promise<DurationResult> {
	const title = file.basename;

	if (!Platform.isDesktop) {
		return { durationSeconds: undefined, title };
	}

	try {
		const os = require('os') as typeof import('os');
		const path = require('path') as typeof import('path');
		const fs = require('fs') as typeof import('fs');
		const { execFile } = require('child_process') as typeof import('child_process');

		const data = await readBinary(file);
		const tempPath = path.join(os.tmpdir(), `synapse-probe-${Date.now()}-${file.name}`);
		fs.writeFileSync(tempPath, Buffer.from(data));

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
					try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
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
	getSettings: () => SynapseSettings
): Promise<DurationResult> {
	if (!Platform.isDesktop) {
		return { durationSeconds: undefined, title: url };
	}

	try {
		const { execFile } = require('child_process') as typeof import('child_process');
		const ytDlpPath = sanitizePath(getSettings().video.ytDlpPath);

		const output = await new Promise<string>((resolve, reject) => {
			execFile(
				ytDlpPath,
				['--dump-json', '--no-download', url],
				{ env: shellEnv(), maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
				(error, stdout) => {
					if (error) reject(error);
					else resolve(stdout);
				}
			);
		});

		const data = JSON.parse(output);
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
