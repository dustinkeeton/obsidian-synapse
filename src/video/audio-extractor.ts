import { SynapseSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';
import { sanitizePath, sanitizeUrl, describeNetworkError } from '../shared';

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
	private _node: {
		os: typeof import('os');
		path: typeof import('path');
		execFile: typeof import('child_process')['execFile'];
	} | null = null;

	private get node() {
		if (!this._node) {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			this._node = {
				os: require('os'),
				path: require('path'),
				execFile: require('child_process').execFile,
			};
		}
		return this._node;
	}

	constructor(private getSettings: () => SynapseSettings) {}

	async extractFromUrl(url: string): Promise<ExtractionResult> {
		const sanitizedUrl = sanitizeUrl(url);
		const settings = this.getSettings().video;
		// Use OS temp dir for absolute path — yt-dlp needs a real filesystem path
		const outputPath = this.node.path.join(this.node.os.tmpdir(), `synapse-audio-${Date.now()}.mp3`);

		// Get metadata first
		const metadata = await this.getMetadata(sanitizedUrl);

		// Download and extract audio using execFile with argument array
		await this.runCommand(sanitizePath(settings.ytDlpPath), [
			'-x', '--audio-format', 'mp3',
			'-o', outputPath,
			sanitizedUrl,
		], 'yt-dlp');

		return { audioPath: outputPath, metadata };
	}

	async extractFromFile(filePath: string): Promise<ExtractionResult> {
		const sanitizedPath = sanitizePath(filePath);
		const settings = this.getSettings().video;
		const outputPath = this.node.path.join(this.node.os.tmpdir(), `synapse-audio-${Date.now()}.mp3`);

		await this.runCommand(sanitizePath(settings.ffmpegPath), [
			'-i', sanitizedPath,
			'-vn', '-acodec', 'libmp3lame',
			outputPath,
		], 'ffmpeg');

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
		const outputPath = this.node.path.join(this.node.os.tmpdir(), `synapse-video-${Date.now()}.mp4`);

		await this.runCommand(sanitizePath(settings.ytDlpPath), [
			'-f', 'mp4/best',
			'-o', outputPath,
			sanitizedUrl,
		], 'yt-dlp');

		return outputPath;
	}

	/**
	 * Clip an audio file to a specific time range using ffmpeg.
	 * Returns the path to the clipped temp file. Caller is responsible for cleanup.
	 */
	async clipAudio(inputPath: string, startSeconds: number, endSeconds: number): Promise<string> {
		const settings = this.getSettings().video;
		const outputPath = this.node.path.join(this.node.os.tmpdir(), `synapse-clipped-${Date.now()}.mp3`);
		await this.runCommand(sanitizePath(settings.ffmpegPath), [
			'-i', sanitizePath(inputPath),
			'-ss', String(startSeconds),
			'-to', String(endSeconds),
			'-vn', '-acodec', 'libmp3lame',
			outputPath,
		], 'ffmpeg');
		return outputPath;
	}

	/**
	 * Concatenate multiple audio files into a single mp3 using the ffmpeg
	 * concat filter. Unlike the `concat` demuxer / `-c copy`, the filter
	 * re-encodes every input, so mixed formats and codecs
	 * (mp3/wav/m4a/ogg/flac/webm/aac) combine cleanly into one continuous
	 * track. Returns the path to the combined temp file; the caller is
	 * responsible for cleanup.
	 */
	async concatAudio(inputPaths: string[]): Promise<string> {
		if (inputPaths.length === 0) {
			throw new Error('concatAudio requires at least one input file');
		}
		const settings = this.getSettings().video;
		const outputPath = this.node.path.join(this.node.os.tmpdir(), `synapse-combined-${Date.now()}.mp3`);

		// Build: -i in1 -i in2 ... -filter_complex "[0:a][1:a]...concat=n=N:v=0:a=1[out]" -map "[out]" -acodec libmp3lame out
		const args: string[] = [];
		for (const input of inputPaths) {
			args.push('-i', sanitizePath(input));
		}
		const filterInputs = inputPaths.map((_, i) => `[${i}:a]`).join('');
		const filter = `${filterInputs}concat=n=${inputPaths.length}:v=0:a=1[out]`;
		args.push(
			'-filter_complex', filter,
			'-map', '[out]',
			'-acodec', 'libmp3lame',
			outputPath,
		);

		await this.runCommand(sanitizePath(settings.ffmpegPath), args, 'ffmpeg');
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
			], 'yt-dlp');
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

	private runCommand(cmd: string, args: string[], label = cmd): Promise<string> {
		return new Promise((resolve, reject) => {
			this.node.execFile(cmd, args, {
				env: shellEnv(),
				maxBuffer: 10 * 1024 * 1024,
				timeout: 300_000, // 5 minute timeout for long downloads/conversions
			}, (error, stdout, stderr) => {
				if (error) {
					if (error.code === 'ENOENT') {
						reject(new Error(`${label} not found — install it or set the full path in settings`));
						return;
					}
					// Classify against the FULL stderr (not just the last line) so
					// yt-dlp's "Connection refused"/"Failed to resolve host" lines are caught.
					const stderrText = stderr?.trim() || '';
					const networkMsg = describeNetworkError(error, label) ?? describeNetworkError(stderrText, label);
					if (networkMsg) {
						reject(new Error(networkMsg));
						return;
					}
					const errno = error as NodeJS.ErrnoException & { killed?: boolean };
					if (errno.killed && errno.code === 'ETIMEDOUT') {
						reject(new Error(`${label} timed out after 5 minutes`));
						return;
					}
					const detail = stderrText.split('\n').pop() || '';
					reject(new Error(
						`${label} failed (exit code ${error.code || 'unknown'})${detail ? ': ' + detail : ''}`
					));
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
