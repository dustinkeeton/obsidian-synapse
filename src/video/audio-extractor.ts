import { AutoNotesSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';
import { sanitizePath, sanitizeUrl } from '../shared';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');

// child_process is available in Obsidian's Electron environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

/**
 * Obsidian's Electron process has a minimal PATH that often excludes
 * user-installed tools. Append common install locations so yt-dlp/ffmpeg
 * can be found when configured with bare command names.
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
		// Prepend so Homebrew tools (with proper Python) take priority
		// over ~/.local/bin or system versions
		env.PATH = missing.join(':') + ':' + current;
	}
	return env;
}

export class AudioExtractor {
	constructor(private getSettings: () => AutoNotesSettings) {}

	async extractFromUrl(url: string): Promise<ExtractionResult> {
		const sanitizedUrl = sanitizeUrl(url);
		const settings = this.getSettings().video;
		// Use OS temp dir for absolute path — yt-dlp needs a real filesystem path
		const outputPath = path.join(os.tmpdir(), `auto-notes-audio-${Date.now()}.mp3`);

		// Get metadata first
		const metadata = await this.getMetadata(sanitizedUrl);

		// Download and extract audio using execFile with argument array
		await this.runCommand(sanitizePath(settings.ytDlpPath), [
			'-x', '--audio-format', 'mp3',
			'-o', outputPath,
			sanitizedUrl,
		]);

		return { audioPath: outputPath, metadata };
	}

	async extractFromFile(filePath: string): Promise<ExtractionResult> {
		const sanitizedPath = sanitizePath(filePath);
		const settings = this.getSettings().video;
		const outputPath = path.join(os.tmpdir(), `auto-notes-audio-${Date.now()}.mp3`);

		await this.runCommand(sanitizePath(settings.ffmpegPath), [
			'-i', sanitizedPath,
			'-vn', '-acodec', 'libmp3lame',
			outputPath,
		]);

		const fileName = sanitizedPath.split('/').pop() || 'video';
		return {
			audioPath: outputPath,
			metadata: { title: fileName.replace(/\.[^.]+$/, '') },
		};
	}

	/**
	 * Download the actual video file to a temp path.
	 * Returns the temp file path. Caller is responsible for cleanup.
	 */
	async downloadVideo(url: string): Promise<string> {
		const sanitizedUrl = sanitizeUrl(url);
		const settings = this.getSettings().video;
		const outputPath = path.join(os.tmpdir(), `auto-notes-video-${Date.now()}.mp4`);

		await this.runCommand(sanitizePath(settings.ytDlpPath), [
			'-f', 'mp4/best',
			'-o', outputPath,
			sanitizedUrl,
		]);

		return outputPath;
	}

	async checkDependencies(): Promise<{
		ytDlp: boolean;
		ffmpeg: boolean;
	}> {
		const settings = this.getSettings().video;
		const [ytDlp, ffmpeg] = await Promise.all([
			this.commandExists(settings.ytDlpPath),
			this.commandExists(settings.ffmpegPath),
		]);
		return { ytDlp, ffmpeg };
	}

	private async getMetadata(url: string): Promise<VideoMetadata> {
		const settings = this.getSettings().video;
		try {
			const output = await this.runCommand(sanitizePath(settings.ytDlpPath), [
				'--dump-json', '--no-download', url,
			]);
			const data = JSON.parse(output);
			return {
				title: data.title || 'Untitled',
				channel: data.channel || data.uploader,
				duration: data.duration,
				uploadDate: data.upload_date,
				description: data.description?.slice(0, 500),
				platform: data.extractor_key,
				url,
			};
		} catch {
			return { title: 'Untitled', url };
		}
	}

	private runCommand(cmd: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(cmd, args, {
				env: shellEnv(),
				maxBuffer: 10 * 1024 * 1024,
				timeout: 300_000, // 5 minute timeout for long downloads/conversions
			}, (error, stdout, stderr) => {
				if (error) {
					const code = error.code || 'unknown';
					const detail = stderr?.trim().split('\n').pop() || '';
					const msg = code === 'ENOENT'
						? `"${cmd}" not found — install it or set the full path in settings`
						: `Command failed (exit code ${code})${detail ? ': ' + detail : ''}`;
					reject(new Error(msg));
				} else {
					resolve(stdout);
				}
			});
		});
	}

	private async commandExists(cmd: string): Promise<boolean> {
		try {
			await this.runCommand('which', [cmd]);
			return true;
		} catch {
			return false;
		}
	}
}
