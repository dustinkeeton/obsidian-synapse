import { App, Modal, Notice, Setting } from 'obsidian';
import { SummarizeTarget } from './types';

export class SummarizeSelectionModal extends Modal {
	private selected: Set<string>;
	private onSummarize: (targets: SummarizeTarget[]) => Promise<void>;

	constructor(
		app: App,
		private targets: SummarizeTarget[],
		onSummarize: (targets: SummarizeTarget[]) => Promise<void>
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

		const listEl = contentEl.createDiv({ cls: 'auto-notes-summarize-list' });
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
					await this.onSummarize(chosen);
				});
		});
	}

	private renderCheckboxes(container: HTMLElement): void {
		container.empty();
		for (const target of this.targets) {
			const key = `${target.type}:${target.line}:${target.source}`;

			let label: string;
			let desc: string | undefined;
			if (target.type === 'transcription') {
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
