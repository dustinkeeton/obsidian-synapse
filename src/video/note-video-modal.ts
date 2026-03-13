import { App, Modal, Notice, Setting } from 'obsidian';
import { VideoUrlEmbed } from './types';

export class NoteVideoModal extends Modal {
	private selected: Set<string>;
	private onTranscribe: (embeds: VideoUrlEmbed[]) => Promise<void>;

	constructor(
		app: App,
		private embeds: VideoUrlEmbed[],
		onTranscribe: (embeds: VideoUrlEmbed[]) => Promise<void>
	) {
		super(app);
		this.selected = new Set(embeds.map(e => e.url));
		this.onTranscribe = onTranscribe;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Video URLs from Note' });
		contentEl.createEl('p', {
			text: `Found ${this.embeds.length} video URL(s). Select which to transcribe:`,
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select All').onClick(() => {
					this.selected = new Set(this.embeds.map(e => e.url));
					this.renderCheckboxes(listEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select None').onClick(() => {
					this.selected.clear();
					this.renderCheckboxes(listEl);
				});
			});

		const listEl = contentEl.createDiv({ cls: 'auto-notes-video-list' });
		this.renderCheckboxes(listEl);

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe Selected')
				.setCta()
				.onClick(async () => {
					const chosen = this.embeds.filter(e => this.selected.has(e.url));
					if (chosen.length === 0) {
						new Notice('Please select at least one video URL');
						return;
					}
					this.close();
					await this.onTranscribe(chosen);
				});
		});
	}

	private renderCheckboxes(container: HTMLElement): void {
		container.empty();
		for (const embed of this.embeds) {
			new Setting(container)
				.setName(`${embed.platform}: ${embed.url}`)
				.addToggle((toggle) => {
					toggle
						.setValue(this.selected.has(embed.url))
						.onChange((val) => {
							if (val) {
								this.selected.add(embed.url);
							} else {
								this.selected.delete(embed.url);
							}
						});
				});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
