import { App, Modal, Notice, Platform, Setting, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AUDIO_EXTENSIONS } from '../audio';
import { detectPlatform } from '../video';
import { validateTimeRange } from '../shared/validation';
import type { TimeRange } from '../shared/validation';

export class UnifiedTranscriptionModal extends Modal {
	private selectedFile: TFile | null = null;
	private url = '';
	private startTime = '';
	private endTime = '';

	constructor(
		app: App,
		private getSettings: () => SynapseSettings,
		private enabledModules: { audio: boolean; video: boolean },
		private callbacks: {
			onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
			onTranscribeUrl: (url: string, timeRange?: TimeRange) => Promise<void>;
		}
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Media' });

		// Local File section
		if (this.enabledModules.audio || this.enabledModules.video) {
			const audioFiles = this.app.vault
				.getFiles()
				.filter((f) => AUDIO_EXTENSIONS.test(f.name));

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
			const settings = this.getSettings().audio.postProcessing;
			const ppStatus = settings.enabled
				? 'Enabled (configure in settings)'
				: 'Disabled';
			new Setting(contentEl)
				.setName('Post-processing')
				.setDesc(ppStatus);
		}

		// URL section (desktop only — video transcription requires yt-dlp + ffmpeg)
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

		// Time Range section (desktop only — requires ffmpeg)
		if (Platform.isDesktop) {
			contentEl.createEl('h3', { text: 'Time Range (optional)' });

			new Setting(contentEl)
				.setName('Start time')
				.setDesc('Format: HH:MM:SS or MM:SS. Leave blank for full file.')
				.addText((text) => {
					text.setPlaceholder('00:00:00');
					text.onChange((value) => { this.startTime = value; });
				});

			new Setting(contentEl)
				.setName('End time')
				.addText((text) => {
					text.setPlaceholder('00:00:00');
					text.onChange((value) => { this.endTime = value; });
				});
		}

		// Transcribe button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe')
				.setCta()
				.onClick(async () => {
					// Validate time range if provided
					let timeRange: TimeRange | undefined;
					if (this.startTime || this.endTime) {
						if (!this.startTime || !this.endTime) {
							new Notice('Both start and end times are required');
							return;
						}
						try {
							timeRange = validateTimeRange(this.startTime, this.endTime);
						} catch (error) {
							new Notice(error instanceof Error ? error.message : String(error));
							return;
						}
					}

					if (this.selectedFile) {
						this.close();
						await this.callbacks.onTranscribeFile(this.selectedFile, timeRange);
					} else if (this.url) {
						if (!detectPlatform(this.url)) {
							new Notice('Unsupported URL. Please use YouTube or TikTok.');
							return;
						}
						this.close();
						await this.callbacks.onTranscribeUrl(this.url, timeRange);
					} else {
						new Notice('Please select a file or enter a URL');
					}
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
