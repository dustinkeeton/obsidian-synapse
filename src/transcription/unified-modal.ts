import { App, Modal, Platform, Setting, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AUDIO_EXTENSIONS } from '../audio';
import { detectPlatform } from '../video';
import { isPathExcluded } from '../shared';
import type { TimeRange, NotificationManager } from '../shared';
import {
	detectLocalFileDuration,
	detectUrlDuration,
	MIN_SLIDER_DURATION,
} from './duration-detector';
import { TimeRangeModal } from './time-range-modal';

export class UnifiedTranscriptionModal extends Modal {
	private selectedFile: TFile | null = null;
	private url = '';

	constructor(
		app: App,
		private getSettings: () => SynapseSettings,
		private enabledModules: { audio: boolean; video: boolean },
		private callbacks: {
			onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
			onTranscribeUrl: (url: string, timeRange?: TimeRange) => Promise<void>;
		},
		private notifications: NotificationManager
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe media' });

		// Local File section
		if (this.enabledModules.audio || this.enabledModules.video) {
			const settings = this.getSettings();
			// Honor folder exclusions scoped to audio: a folder the user excluded
			// from audio transcription is also hidden from this manual picker (#323).
			const audioFiles = this.app.vault
				.getFiles()
				.filter(
					(f) =>
						AUDIO_EXTENSIONS.test(f.name) &&
						!isPathExcluded(f.path, 'audio', settings)
				);

			new Setting(contentEl)
				.setName('Local file')
				.setDesc('Select an audio file from your vault')
				.addDropdown((dropdown) => {
					dropdown.addOption('', 'Select a file...');
					for (const file of audioFiles) {
						dropdown.addOption(file.path, file.path);
					}
					dropdown.onChange((value) => {
						this.selectedFile =
							this.app.vault.getAbstractFileByPath(value) as TFile | null;
						if (value) this.url = '';
					});
				});

			// Post-processing info
			const ppStatus = settings.audio.postProcessing.enabled
				? 'Enabled (configure in settings)'
				: 'Disabled';
			new Setting(contentEl)
				.setName('Post-processing')
				.setDesc(ppStatus);
		}

		// URL section — every platform since #184: desktop routes through
		// captions/yt-dlp, mobile through the caption tier (YouTube only).
		if (this.enabledModules.video) {
			const platformBadge = contentEl.createDiv({
				cls: 'synapse-platform-badge',
			});
			platformBadge.hide();

			new Setting(contentEl)
				.setName('Video URL')
				.setDesc('YouTube or TikTok URL')
				.addText((text) => {
					text.setPlaceholder('https://youtube.com/watch?v=...');
					text.onChange((value) => {
						this.url = value;
						if (value) this.selectedFile = null;
						const detected = detectPlatform(value);
						if (detected) {
							platformBadge.setText(`Platform: ${detected.platform}`);
							platformBadge.show();
						} else if (value.length > 0) {
							platformBadge.setText('Unsupported URL');
							platformBadge.show();
						} else {
							platformBadge.hide();
						}
					});
				});
		}

		// Transcribe button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe')
				.setCta()
				.onClick(async () => {
					await this.handleTranscribe();
				});
		});
	}

	/**
	 * Handle the transcribe action. On desktop, attempts to detect media
	 * duration and show a time-range slider toast. Falls back to text
	 * inputs if duration detection fails, or transcribes the full file
	 * if the media is too short for clipping.
	 */
	private async handleTranscribe(): Promise<void> {
		if (this.selectedFile) {
			await this.handleFileTranscribe(this.selectedFile);
		} else if (this.url) {
			if (!detectPlatform(this.url)) {
				this.notifications.info('Unsupported URL. Please use YouTube or TikTok.');
				return;
			}
			await this.handleUrlTranscribe(this.url);
		} else {
			this.notifications.info('Please select a file or enter a URL');
		}
	}

	private async handleFileTranscribe(file: TFile): Promise<void> {
		if (!Platform.isDesktop) {
			// No clipping on mobile -- transcribe full file
			this.close();
			await this.callbacks.onTranscribeFile(file);
			return;
		}

		// Attempt duration detection
		this.close();
		const durationResult = await detectLocalFileDuration(
			file,
			(f) => this.app.vault.readBinary(f),
			this.getSettings
		);

		const timeRange = await this.chooseTimeRange(durationResult);
		if (timeRange === 'cancelled') return;
		await this.callbacks.onTranscribeFile(file, timeRange);
	}

	private async handleUrlTranscribe(url: string): Promise<void> {
		if (!Platform.isDesktop) {
			this.close();
			await this.callbacks.onTranscribeUrl(url);
			return;
		}

		this.close();
		const durationResult = await detectUrlDuration(url, this.getSettings);

		const timeRange = await this.chooseTimeRange(durationResult);
		if (timeRange === 'cancelled') return;
		await this.callbacks.onTranscribeUrl(url, timeRange);
	}

	/**
	 * Ask the user what to transcribe via {@link TimeRangeModal}: a trim-bar
	 * slider when the duration is known, manual start/end inputs when
	 * detection failed. Media too short to clip skips the modal entirely.
	 * Returns the selected range, undefined for the full file, or
	 * `'cancelled'` when the user dismissed the modal (do nothing).
	 */
	private async chooseTimeRange(durationResult: {
		title: string;
		durationSeconds?: number;
	}): Promise<TimeRange | undefined | 'cancelled'> {
		const { title, durationSeconds } = durationResult;

		// Too short for clipping -- transcribe the full file directly.
		if (durationSeconds !== undefined && durationSeconds < MIN_SLIDER_DURATION) {
			return undefined;
		}

		const choice = await new TimeRangeModal(
			this.app,
			{ title, duration: durationSeconds },
			this.notifications
		).openAndChoose();

		switch (choice.kind) {
			case 'selection':
				return choice.range;
			case 'full':
				return undefined;
			case 'cancelled':
				return 'cancelled';
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
