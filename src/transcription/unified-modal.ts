import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { AUDIO_EXTENSIONS } from '../audio';
import { detectPlatform } from '../video';

export class UnifiedTranscriptionModal extends Modal {
	private selectedFile: TFile | null = null;
	private url = '';

	constructor(
		app: App,
		private getSettings: () => AutoNotesSettings,
		private enabledModules: { audio: boolean; video: boolean },
		private callbacks: {
			onTranscribeFile: (file: TFile) => Promise<void>;
			onTranscribeUrl: (url: string) => Promise<void>;
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

		// URL section
		if (this.enabledModules.video) {
			const platformBadge = contentEl.createDiv({
				cls: 'auto-notes-platform-badge',
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
					if (this.selectedFile) {
						this.close();
						await this.callbacks.onTranscribeFile(this.selectedFile);
					} else if (this.url) {
						if (!detectPlatform(this.url)) {
							new Notice('Unsupported URL. Please use YouTube or TikTok.');
							return;
						}
						this.close();
						await this.callbacks.onTranscribeUrl(this.url);
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
