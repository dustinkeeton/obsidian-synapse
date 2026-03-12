import { App, Modal, Notice, Setting } from 'obsidian';
import { detectPlatform } from './url-detector';

export class VideoTranscriptionModal extends Modal {
	private url = '';
	private onTranscribe: (url: string) => Promise<void>;

	constructor(
		app: App,
		onTranscribe: (url: string) => Promise<void>
	) {
		super(app);
		this.onTranscribe = onTranscribe;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Video from URL' });

		const platformBadge = contentEl.createDiv({
			cls: 'auto-notes-platform-badge',
		});

		new Setting(contentEl)
			.setName('Video URL')
			.setDesc('YouTube or TikTok URL')
			.addText((text) => {
				text.setPlaceholder('https://youtube.com/watch?v=...');
				text.onChange((value) => {
					this.url = value;
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

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe')
				.setCta()
				.onClick(async () => {
					if (!this.url) {
						new Notice('Please enter a URL');
						return;
					}
					if (!detectPlatform(this.url)) {
						new Notice('Unsupported URL. Please use YouTube or TikTok.');
						return;
					}
					this.close();
					await this.onTranscribe(this.url);
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
