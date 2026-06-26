import { SynapseSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';
import {
	sanitizePath, sanitizeUrl, describeNetworkError, isRecord, parseJson,
	loadNodeModules, shellEnv, type NodeModules,
} from '../shared';

/**
 * User-facing message for a TikTok (or similar) post that carries no audio
 * stream — typically a photo/image slideshow. Surfaced both proactively (from
 * `--dump-json` metadata, before any extraction is attempted) and reactively
 * (when ffprobe's `unable to obtain file audio codec` signature appears in
 * stderr). Kept as a shared constant so the proactive and reactive paths stay
 * in sync.
 */
const NO_AUDIO_MESSAGE =
	'This TikTok post appears to be a photo slideshow with no audio track.';

/**
 * Marker error thrown the moment {@link AudioExtractor.extractFromUrl} detects a
 * no-audio/slideshow post from metadata. It carries {@link NO_AUDIO_MESSAGE} and
 * is deliberately NOT retried with a looser format (there is simply no audio to
 * extract), so the fallback path rethrows it untouched.
 */
class NoAudioError extends Error {
	constructor(message: string = NO_AUDIO_MESSAGE) {
		super(message);
		this.name = 'NoAudioError';
	}
}

/**
 * Typed error thrown when a required external binary cannot be located — either
 * because the executable is missing entirely (ENOENT on spawn) or because
 * yt-dlp reports ffmpeg/ffprobe as not found. Carries which {@link tool} is
 * missing so callers can route the failure to actionable onboarding UI: an
 * "Open settings" notice that reveals the Video transcription section (#382).
 *
 * Unlike the plain-string failures around it, this instance is preserved
 * (rethrown unchanged) through the video → summarize wrap layers so the
 * discriminant survives to the notify site. Detection there matches on the
 * error `name` (see `findDependencyMissingError` in the summarize module) to
 * avoid a cross-feature import, so keep `name` stable.
 */
export class DependencyMissingError extends Error {
	constructor(
		readonly tool: 'yt-dlp' | 'ffmpeg',
		message: string,
	) {
		super(message);
		this.name = 'DependencyMissingError';
	}
}

/**
 * Does `p` look like a concrete filesystem path rather than a bare command name
 * resolved via PATH? yt-dlp's `--ffmpeg-location` wants a real file/dir path, so
 * passing the bare default (`'ffmpeg'`) would break PATH discovery. We only emit
 * the flag when the user configured an actual path (contains a `/` or `\`, or is
 * absolute on Windows like `C:\...`).
 */
function isConcretePath(p: string): boolean {
	return p.includes('/') || p.includes('\\');
}

/**
 * yt-dlp stderr signature emitted when ffprobe runs but cannot determine an
 * audio codec — i.e. the post has no standard audio stream (TikTok
 * photo/slideshow). Distinct from ffprobe being missing entirely.
 */
const NO_AUDIO_STDERR = /unable to obtain file audio codec/i;

/**
 * yt-dlp/ffmpeg stderr signatures indicating the ffmpeg or ffprobe binary could
 * not be located (vs. being present but unable to introspect the media).
 */
const FFMPEG_NOT_FOUND_STDERR =
	/ffprobe(?:\/ffmpeg)?(?: or ffmpeg)? not found|ffmpeg(?:\/ffprobe)?(?: or ffprobe)? not found|ffmpeg(?: and|,)? ffprobe not found|(?:ffmpeg|ffprobe).{0,40}\bENOENT\b/i;

/**
 * The subset of yt-dlp's `--dump-json` output that {@link AudioExtractor}
 * reads. yt-dlp emits a large, format-dependent object; every field below is
 * optional and best-effort — a missing field falls back (see
 * {@link AudioExtractor.toMetadata}), it is never a hard error. Validated with
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
	/**
	 * Best-effort audio codec for the default/selected format. yt-dlp reports the
	 * literal string `'none'` when a format carries no audio — the key signal for
	 * a TikTok photo/slideshow post. Absent on many extractors (audio assumed).
	 */
	acodec?: string;
	/**
	 * Per-format list from `--dump-json`. Used as a fallback audio probe: a post
	 * with no format whose `acodec` is anything other than `'none'` has no audio
	 * stream. Each entry's `acodec` is best-effort and may be missing.
	 */
	formats?: Array<{ acodec?: string; vcodec?: string }>;
	/**
	 * yt-dlp result type. Image slideshows surface as non-`'video'` types (often
	 * `'playlist'`/`'multi_video'`), one more signal for the no-audio case.
	 */
	_type?: string;
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
		acodec: typeof value.acodec === 'string' ? value.acodec : undefined,
		formats: asFormats(value.formats),
		_type: typeof value._type === 'string' ? value._type : undefined,
	};
}

/** Narrow an unknown `formats` value to the best-effort `{acodec,vcodec}[]` shape. */
function asFormats(value: unknown): YtDlpDumpJson['formats'] {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.map((f) => (isRecord(f)
		? {
			acodec: typeof f.acodec === 'string' ? f.acodec : undefined,
			vcodec: typeof f.vcodec === 'string' ? f.vcodec : undefined,
		}
		: {}));
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

		// Fetch metadata once and reuse it for both the returned VideoMetadata and
		// the proactive no-audio/slideshow check, avoiding a second network call.
		const dump = await this.dumpJson(sanitizedUrl);
		const metadata = this.toMetadata(dump, sanitizedUrl);

		// TikTok photo/slideshow posts have no audio stream; ffprobe would later
		// fail with "unable to obtain file audio codec". Detect it up front from
		// metadata and fail fast with an actionable, specific message instead of
		// burning a download + a fallback retry that cannot possibly succeed.
		if (this.isNoAudioPost(dump)) {
			throw new NoAudioError();
		}

		const ytDlp = sanitizePath(settings.ytDlpPath);
		const ffmpegLocation = this.ffmpegLocationArgs();

		// First attempt: force mp3. On a non-network, non-no-audio failure, retry
		// once with a looser format that does not pin the container/codec — some
		// posts only expose formats that the strict `--audio-format mp3` path
		// cannot satisfy on the first try.
		try {
			await this.runCommand(ytDlp, [
				'-x', '--audio-format', 'mp3',
				...ffmpegLocation,
				'-o', outputPath,
				sanitizedUrl,
			], 'yt-dlp');
		} catch (error) {
			// A confirmed no-audio post can never be salvaged by a looser format —
			// surface the specific slideshow guidance instead of retrying.
			if (this.isNoAudioFailure(error)) {
				throw error instanceof NoAudioError ? error : new NoAudioError();
			}
			// A missing binary (yt-dlp/ffmpeg) can't be fixed by a looser format —
			// surface the typed error immediately so callers can offer onboarding (#382).
			if (error instanceof DependencyMissingError) {
				throw error;
			}
			// Network failures are already user-actionable and not content-related;
			// don't waste a retry on them.
			if (this.isNetworkFailure(error)) {
				throw error;
			}
			await this.runCommand(ytDlp, [
				'-f', 'bestaudio/best',
				'-x', '--audio-format', 'mp3',
				...ffmpegLocation,
				'-o', outputPath,
				sanitizedUrl,
			], 'yt-dlp');
		}

		return { audioPath: outputPath, metadata };
	}

	/**
	 * Build the `--ffmpeg-location <path>` argument pair for yt-dlp, or an empty
	 * array when the configured ffmpeg path is a bare command name. yt-dlp finds
	 * the matching ffprobe alongside ffmpeg from this location, so pointing it at
	 * a concrete path fixes the "unable to obtain file audio codec" class of
	 * failures caused by yt-dlp picking up a mismatched/absent ffprobe via PATH.
	 */
	private ffmpegLocationArgs(): string[] {
		const ffmpegPath = this.getSettings().video.ffmpegPath;
		if (!isConcretePath(ffmpegPath)) {
			// Bare command name (the default): let PATH discovery via shellEnv()
			// resolve ffmpeg/ffprobe. Passing `--ffmpeg-location ffmpeg` would make
			// yt-dlp treat it as a literal path and fail.
			return [];
		}
		return ['--ffmpeg-location', sanitizePath(ffmpegPath)];
	}

	/** Did this error originate from a network failure (already user-actionable)? */
	private isNetworkFailure(error: unknown): boolean {
		const msg = error instanceof Error ? error.message : String(error);
		return describeNetworkError(msg, 'yt-dlp') !== null;
	}

	/** Did this error represent a no-audio/slideshow post (proactive or reactive)? */
	private isNoAudioFailure(error: unknown): boolean {
		if (error instanceof NoAudioError) {
			return true;
		}
		const msg = error instanceof Error ? error.message : String(error);
		return msg === NO_AUDIO_MESSAGE || NO_AUDIO_STDERR.test(msg);
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
			...this.ffmpegLocationArgs(),
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

	/**
	 * Fetch and narrow yt-dlp's `--dump-json --no-download` output for `url`.
	 *
	 * Returns `null` on any failure (network, non-zero exit, malformed JSON, or a
	 * non-object payload) so callers can fall back wholesale — matching the prior
	 * `getMetadata` "never throw on metadata" contract. The narrowed object is
	 * consumed by both {@link toMetadata} and {@link isNoAudioPost}, so a single
	 * dump call serves the returned metadata AND the proactive slideshow check.
	 */
	private async dumpJson(url: string): Promise<YtDlpDumpJson | null> {
		const settings = this.getSettings().video;
		try {
			const output = await this.runCommand(sanitizePath(settings.ytDlpPath), [
				'--dump-json', '--no-download', url,
			], 'yt-dlp');
			return asYtDlpDumpJson(parseJson(output));
		} catch {
			return null;
		}
	}

	/** Build {@link VideoMetadata} from narrowed dump JSON (or all-fallback when null). */
	private toMetadata(dump: YtDlpDumpJson | null, url: string): VideoMetadata {
		const data = dump ?? {};
		return {
			title: data.title || 'Untitled',
			channel: data.channel || data.uploader,
			duration: data.duration,
			uploadDate: data.upload_date,
			description: data.description?.slice(0, 500),
			platform: data.extractor_key,
			url,
		};
	}

	/**
	 * Decide from dump JSON whether a post has no extractable audio (TikTok
	 * photo/slideshow). Signals, in order:
	 *  1. top-level `acodec === 'none'` (yt-dlp's explicit "no audio" marker);
	 *  2. a non-empty `formats` list where NO format has an audio codec other
	 *     than `'none'` (every format is audio-less);
	 *  3. a slideshow-ish result `_type` (e.g. `playlist`/`multi_video`/`images`)
	 *     when there is no audio-bearing format to contradict it.
	 *
	 * Conservative by design: a `null` dump (metadata fetch failed) or an unknown
	 * shape returns `false`, so extraction is still attempted rather than wrongly
	 * blocked. Reactive detection of the ffprobe stderr signature
	 * ({@link NO_AUDIO_STDERR}) backstops anything this proactive check misses.
	 */
	private isNoAudioPost(dump: YtDlpDumpJson | null): boolean {
		if (!dump) {
			return false;
		}
		if (dump.acodec === 'none') {
			return true;
		}
		const formats = dump.formats;
		if (formats && formats.length > 0) {
			const hasAudio = formats.some((f) => typeof f.acodec === 'string' && f.acodec !== 'none');
			if (!hasAudio) {
				return true;
			}
			// At least one audio-bearing format exists — trust it over _type.
			return false;
		}
		if (typeof dump._type === 'string' && /playlist|multi_video|image/i.test(dump._type)) {
			return true;
		}
		return false;
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
						// The missing binary is whichever command we tried to run. Carry
						// it as a typed error so callers can offer install/onboarding (#382).
						const tool: 'yt-dlp' | 'ffmpeg' = label === 'ffmpeg' ? 'ffmpeg' : 'yt-dlp';
						reject(new DependencyMissingError(
							tool,
							`${label} not found — install it or set the full path in settings`,
						));
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
					// No-audio/slideshow: ffprobe ran but found no audio codec. Map to
					// the specific, actionable slideshow message. Checked before the
					// generic fallback so the raw "unable to obtain file audio codec"
					// line never reaches the user.
					if (NO_AUDIO_STDERR.test(stderrText)) {
						reject(new NoAudioError());
						return;
					}
					// ffmpeg/ffprobe present-but-not-found (distinct from the binary
					// being missing, which surfaces as ENOENT above). Point the user at
					// the Video setting that controls the ffmpeg path.
					if (FFMPEG_NOT_FOUND_STDERR.test(stderrText)) {
						// Typed so callers can route to the actionable onboarding notice (#382).
						reject(new DependencyMissingError(
							'ffmpeg',
							'ffmpeg/ffprobe not found — set the ffmpeg path in Synapse settings (Video).',
						));
						return;
					}
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
