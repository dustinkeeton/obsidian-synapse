import { normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { ExtractionResult, VideoMetadata } from './types';

// child_process is available in Obsidian's Electron environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { exec } = require('child_process') as typeof import('child_process');

export class AudioExtractor {
	constructor(private getSettings: () => AutoNotesSettings) {}

	async extractFromUrl(url: string): Promise<ExtractionResult> {
		const settings = this.getSettings().video;
		const tempDir = settings.tempFolder;
		const outputPath = normalizePath(
			`${tempDir}/audio-${Date.now()}.mp3`
		);

		// Get metadata first
		const metadata = await this.getMetadata(url);

		// Download and extract audio
		await this.runCommand(
			`"${settings.ytDlpPath}" -x --audio-format mp3 ` +
			`-o "${outputPath}" "${url}"`
		);

		return { audioPath: outputPath, metadata };
	}

	async extractFromFile(filePath: string): Promise<ExtractionResult> {
		const settings = this.getSettings().video;
		const tempDir = settings.tempFolder;
		const outputPath = normalizePath(
			`${tempDir}/audio-${Date.now()}.mp3`
		);

		await this.runCommand(
			`"${settings.ffmpegPath}" -i "${filePath}" -vn -acodec libmp3lame ` +
			`"${outputPath}"`
		);

		const fileName = filePath.split('/').pop() || 'video';
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
			const output = await this.runCommand(
				`"${settings.ytDlpPath}" --dump-json --no-download "${url}"`
			);
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

	private runCommand(cmd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`Command failed: ${error.message}\n${stderr}`));
				} else {
					resolve(stdout);
				}
			});
		});
	}

	private async commandExists(cmd: string): Promise<boolean> {
		try {
			await this.runCommand(`which "${cmd}"`);
			return true;
		} catch {
			return false;
		}
	}
}
