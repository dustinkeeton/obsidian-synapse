import { App, Modal, Notice, Platform, Setting, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AUDIO_EXTENSIONS } from '../audio';
import { detectPlatform } from '../video';
import { validateTimeRange, isPathExcluded } from '../shared';
import type { TimeRange, NotificationManager } from '../shared';
import {
	detectLocalFileDuration,
	detectUrlDuration,
	MIN_SLIDER_DURATION,
} from './duration-detector';
import { showTimeRangeToast } from './time-range-toast';

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

		// URL section (desktop only -- video transcription requires yt-dlp + ffmpeg)
		if (this.enabledModules.video && Platform.isDesktop) {
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

		if (
			durationResult.durationSeconds !== undefined &&
			durationResult.durationSeconds >= MIN_SLIDER_DURATION
		) {
			const timeRange = await showTimeRangeToast({
				title: durationResult.title,
				duration: durationResult.durationSeconds,
			});
			await this.callbacks.onTranscribeFile(file, timeRange);
		} else if (durationResult.durationSeconds !== undefined) {
			// Too short for slider -- transcribe full file
			await this.callbacks.onTranscribeFile(file);
		} else {
			// Duration unknown -- show fallback text input toast
			const timeRange = await this.showFallbackTextInputToast(
				durationResult.title
			);
			await this.callbacks.onTranscribeFile(file, timeRange);
		}
	}

	private async handleUrlTranscribe(url: string): Promise<void> {
		if (!Platform.isDesktop) {
			this.close();
			await this.callbacks.onTranscribeUrl(url);
			return;
		}

		this.close();
		const durationResult = await detectUrlDuration(url, this.getSettings);

		if (
			durationResult.durationSeconds !== undefined &&
			durationResult.durationSeconds >= MIN_SLIDER_DURATION
		) {
			const timeRange = await showTimeRangeToast({
				title: durationResult.title,
				duration: durationResult.durationSeconds,
			});
			await this.callbacks.onTranscribeUrl(url, timeRange);
		} else if (durationResult.durationSeconds !== undefined) {
			// Too short for slider -- transcribe full file
			await this.callbacks.onTranscribeUrl(url);
		} else {
			// Duration unknown -- show fallback text input toast
			const timeRange = await this.showFallbackTextInputToast(
				durationResult.title
			);
			await this.callbacks.onTranscribeUrl(url, timeRange);
		}
	}

	/**
	 * Show a fallback Notice-based toast with text inputs for start/end times.
	 * Used when duration detection fails (e.g. missing ffprobe, corrupt file).
	 */
	private showFallbackTextInputToast(
		title: string
	): Promise<TimeRange | undefined> {
		return new Promise((resolve) => {
			let resolved = false;
			let startValue = '';
			let endValue = '';

			const notice = new Notice('', 0);
			const el = (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
			if (!el) {
				resolve(undefined);
				return;
			}

			el.classList.add('synapse-notice', 'synapse-notice--info', 'synapse-notice--no-dismiss');
			el.addEventListener('click', (e) => {
				const target = e.target as HTMLElement;
				if (target.closest('button') || target.closest('input')) return;
				e.preventDefault();
				e.stopPropagation();
			}, true);
			el.empty();

			el.createDiv({
				cls: 'synapse-notice-time-range-title',
				text: `Synapse: Clip "${title}" (optional)`,
			});

			const desc = el.createDiv({ cls: 'synapse-notice-time-range-desc' });
			desc.textContent = 'Duration unknown. Enter timestamps manually (HH:MM:SS or MM:SS):';

			const inputRow = el.createDiv({ cls: 'synapse-notice-time-range-inputs' });
			const startInput = inputRow.createEl('input', {
				attr: { type: 'text', placeholder: 'Start (00:00)', 'aria-label': 'Start time' },
				cls: 'synapse-notice-time-input',
			});
			inputRow.createSpan({ text: ' \u2013 ' });
			const endInput = inputRow.createEl('input', {
				attr: { type: 'text', placeholder: 'End (00:00)', 'aria-label': 'End time' },
				cls: 'synapse-notice-time-input',
			});

			startInput.addEventListener('input', () => { startValue = startInput.value; });
			endInput.addEventListener('input', () => { endValue = endInput.value; });

			const actions = el.createDiv({ cls: 'synapse-notice-actions' });

			const clipBtn = actions.createEl('button', {
				text: 'Transcribe selection',
				cls: 'mod-cta',
			});
			clipBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (resolved) return;
				if (!startValue || !endValue) {
					this.notifications.info('Both start and end times are required');
					return;
				}
				try {
					const range = validateTimeRange(startValue, endValue);
					resolved = true;
					notice.hide();
					resolve(range);
				} catch (err) {
					this.notifications.info(err instanceof Error ? err.message : String(err));
				}
			});

			const fullBtn = actions.createEl('button', {
				text: 'Full file',
				cls: 'mod-cancel',
			});
			fullBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (resolved) return;
				resolved = true;
				notice.hide();
				resolve(undefined);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
