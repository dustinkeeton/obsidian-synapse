import { App, Modal, Notice, Setting } from 'obsidian';
import { SummarizeTarget } from './types';

export class SummarizeSelectionModal extends Modal {
	private selected: Set<string>;
	private onSummarize: (targets: SummarizeTarget[], combine: boolean) => Promise<void>;
	private combineAudio = false;

	constructor(
		app: App,
		private targets: SummarizeTarget[],
		onSummarize: (targets: SummarizeTarget[], combine: boolean) => Promise<void>,
		private canCombine = false
	) {
		super(app);
		this.selected = new Set(targets.map(t => `${t.type}:${t.line}:${t.source}`));
		this.onSummarize = onSummarize;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Summarize Content' });
		contentEl.createEl('p', {
			text: `Found ${this.targets.length} item(s) to summarize. Select which to process:`,
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select All').onClick(() => {
					this.selected = new Set(this.targets.map(t => `${t.type}:${t.line}:${t.source}`));
					this.renderCheckboxes(listEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select None').onClick(() => {
					this.selected.clear();
					this.renderCheckboxes(listEl);
				});
			});

		// Combine option (#214): shown only with 2+ audio targets and ffmpeg.
		if (this.canCombine) {
			new Setting(contentEl)
				.setName('Combine audio into one summary')
				.setDesc('Concatenate the selected audio files and produce a single continuous transcription and summary.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.combineAudio)
						.onChange((val) => {
							this.combineAudio = val;
						});
				});
		}

		const listEl = contentEl.createDiv({ cls: 'synapse-summarize-list' });
		this.renderCheckboxes(listEl);

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Summarize Selected')
				.setCta()
				.onClick(async () => {
					const keys = this.selected;
					const chosen = this.targets.filter(
						t => keys.has(`${t.type}:${t.line}:${t.source}`)
					);
					if (chosen.length === 0) {
						new Notice('Please select at least one item');
						return;
					}
					this.close();
					// Only combine when opted in AND 2+ audio targets are selected.
					const audioSelected = chosen.filter(t => t.type === 'audio').length;
					const combine = this.combineAudio && audioSelected >= 2;
					await this.onSummarize(chosen, combine);
				});
		});
	}

	private renderCheckboxes(container: HTMLElement): void {
		container.empty();
		for (const target of this.targets) {
			const key = `${target.type}:${target.line}:${target.source}`;

			let label: string;
			let desc: string | undefined;
			if (target.type === 'audio') {
				label = `Audio: ${target.source}`;
			} else if (target.type === 'transcription') {
				label = `Transcription: ${target.source}`;
			} else if (target.inEnrichmentSection && target.linkTitle) {
				label = `Reference: ${target.linkTitle}`;
				desc = `Creates [[${target.linkTitle}]] from ${target.source}`;
			} else {
				label = `URL: ${target.source}`;
			}

			const setting = new Setting(container)
				.setName(label)
				.addToggle((toggle) => {
					toggle
						.setValue(this.selected.has(key))
						.onChange((val) => {
							if (val) {
								this.selected.add(key);
							} else {
								this.selected.delete(key);
							}
						});
				});

			if (desc) {
				setting.setDesc(desc);
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
