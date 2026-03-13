import { App, Modal, Notice, Setting, TFile } from 'obsidian';

export interface AudioEmbed {
	fileName: string;
	file: TFile;
	line: number;
}

export class NoteAudioModal extends Modal {
	private selected: Set<string>;
	private onTranscribe: (embeds: AudioEmbed[]) => Promise<void>;

	constructor(
		app: App,
		private embeds: AudioEmbed[],
		onTranscribe: (embeds: AudioEmbed[]) => Promise<void>
	) {
		super(app);
		this.selected = new Set(embeds.map(e => e.fileName));
		this.onTranscribe = onTranscribe;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Audio from Note' });
		contentEl.createEl('p', {
			text: `Found ${this.embeds.length} audio file(s). Select which to transcribe:`,
		});

		// Select all / none
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select All').onClick(() => {
					this.selected = new Set(this.embeds.map(e => e.fileName));
					this.renderCheckboxes(listEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select None').onClick(() => {
					this.selected.clear();
					this.renderCheckboxes(listEl);
				});
			});

		const listEl = contentEl.createDiv({ cls: 'auto-notes-audio-list' });
		this.renderCheckboxes(listEl);

		// Transcribe button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe Selected')
				.setCta()
				.onClick(async () => {
					const chosen = this.embeds.filter(e => this.selected.has(e.fileName));
					if (chosen.length === 0) {
						new Notice('Please select at least one audio file');
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
				.setName(embed.fileName)
				.addToggle((toggle) => {
					toggle
						.setValue(this.selected.has(embed.fileName))
						.onChange((val) => {
							if (val) {
								this.selected.add(embed.fileName);
							} else {
								this.selected.delete(embed.fileName);
							}
						});
				});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
