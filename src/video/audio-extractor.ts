import { normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';
import { sanitizePath, sanitizeUrl } from '../shared';

// child_process is available in Obsidian's Electron environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

export class AudioExtractor {
	constructor(private getSettings: () => AutoNotesSettings) {}

	async extractFromUrl(url: string): Promise<ExtractionResult> {
		const sanitizedUrl = sanitizeUrl(url);
		const settings = this.getSettings().video;
		const tempDir = settings.tempFolder;
		const outputPath = normalizePath(
			`${tempDir}/audio-${Date.now()}.mp3`
		);

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
		const tempDir = settings.tempFolder;
		const outputPath = normalizePath(
			`${tempDir}/audio-${Date.now()}.mp3`
		);

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
				maxBuffer: 10 * 1024 * 1024,
				timeout: 300_000, // 5 minute timeout for long downloads/conversions
			}, (error, stdout, _stderr) => {
				if (error) {
					reject(new Error(`Command failed (exit code ${error.code || 'unknown'})`));
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
