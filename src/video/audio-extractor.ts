import { SynapseSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';
import {
	sanitizePath, sanitizeUrl, describeNetworkError, isRecord, parseJson,
	loadNodeModules, shellEnv, type NodeModules,
} from '../shared';

/**
 * The subset of yt-dlp's `--dump-json` output that {@link AudioExtractor}
 * reads. yt-dlp emits a large, format-dependent object; every field below is
 * optional and best-effort — a missing field falls back (see
 * {@link AudioExtractor.getMetadata}), it is never a hard error. Validated with
 * {@link isRecord} + per-field `typeof` checks before access, so a malformed or
 * partial payload degrades to the URL/`Untitled` fallback instead of throwing.
 */
interface YtDlpDumpJson {
	title?: string;
	channel?: string;
	uploader?: string;
	duration?: number;
	upload_date?: string;
	description?: string;
	extractor_key?: string;
}

/**
 * Narrow unknown yt-dlp output to {@link YtDlpDumpJson}, coercing each consumed
 * field to its expected primitive type (anything else is dropped to the field's
 * fallback). Returns `null` only when the top level is not an object, so the
 * caller can fall back wholesale on malformed output.
 */
function asYtDlpDumpJson(value: unknown): YtDlpDumpJson | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		title: typeof value.title === 'string' ? value.title : undefined,
		channel: typeof value.channel === 'string' ? value.channel : undefined,
		uploader: typeof value.uploader === 'string' ? value.uploader : undefined,
		duration: typeof value.duration === 'number' ? value.duration : undefined,
		upload_date: typeof value.upload_date === 'string' ? value.upload_date : undefined,
		description: typeof value.description === 'string' ? value.description : undefined,
		extractor_key: typeof value.extractor_key === 'string' ? value.extractor_key : undefined,
	};
}

export class AudioExtractor {
	private _node: NodeModules | null = null;

	/**
	 * Lazily resolve Node builtins through the centralized, desktop-guarded
	 * loader (cached after first use). The loader throws {@link DesktopOnlyError}
	 * off-desktop, so every method that touches `this.node` carries an explicit
	 * desktop assertion at its first filesystem/subprocess access.
	 */
	private get node(): NodeModules {
		if (!this._node) {
			this._node = loadNodeModules();
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
			// Parse to `unknown` and narrow. A non-object payload yields all-fallback
			// fields (matching the prior untyped `data.x` reads on a non-object,
			// which were `undefined`); a thrown SyntaxError on malformed JSON is
			// swallowed by the surrounding catch into the `{ title: 'Untitled' }`
			// fallback, exactly as before.
			const data = asYtDlpDumpJson(parseJson(output)) ?? {};
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
					// execFile's `timeout` kills the child with a signal (SIGTERM),
					// leaving error.code null — so detect the kill via `killed`/`signal`
					// rather than an ETIMEDOUT code. Check this BEFORE classifying
					// stderr, so a genuine timeout is labeled as such instead of being
					// misclassified from leftover output.
					const errno = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
					if (errno.killed && !!errno.signal) {
						reject(new Error(`${label} timed out after 5 minutes`));
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
