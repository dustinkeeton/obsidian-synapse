import { App, Modal, Notice, Setting } from 'obsidian';
import { SummarizeTarget } from './types';

export interface SummarizeModalDefaults {
	/** Default state of the "Include note content" toggle (#367). */
	includeNoteContent: boolean;
	/** Default state of the "Combine into one summary" toggle (#367). */
	combineSummaries: boolean;
}

export class SummarizeSelectionModal extends Modal {
	private selected: Set<string>;
	private onSummarize: (targets: SummarizeTarget[], combine: boolean) => Promise<void>;
	private noteContentTarget: SummarizeTarget | null;
	private refTargets: SummarizeTarget[];
	private includeNote: boolean;
	private combine: boolean;

	constructor(
		app: App,
		targets: SummarizeTarget[],
		onSummarize: (targets: SummarizeTarget[], combine: boolean) => Promise<void>,
		defaults: SummarizeModalDefaults
	) {
		super(app);
		// The note's own prose (#367) is presented as a dedicated toggle rather
		// than a checkbox in the reference list.
		this.noteContentTarget = targets.find(t => t.type === 'note-content') ?? null;
		this.refTargets = targets.filter(t => t.type !== 'note-content');
		this.selected = new Set(this.refTargets.map(t => `${t.type}:${t.line}:${t.source}`));
		this.includeNote = defaults.includeNoteContent;
		this.combine = defaults.combineSummaries;
		this.onSummarize = onSummarize;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const total = this.refTargets.length + (this.noteContentTarget ? 1 : 0);
		contentEl.createEl('h2', { text: 'Summarize content' });
		contentEl.createEl('p', {
			text: `Found ${total} item(s) to summarize. Select which to process:`,
		});

		// The note's own prose (#367).
		if (this.noteContentTarget) {
			new Setting(contentEl)
				.setName('Include note content')
				.setDesc("Summarize the note's own prose in addition to its references.")
				.addToggle((toggle) => {
					toggle
						.setValue(this.includeNote)
						.onChange((val) => {
							this.includeNote = val;
						});
				});
		}

		// Combine vs. per-item summaries (#367). The modal only appears for 2+
		// items, so combining is always applicable here.
		new Setting(contentEl)
			.setName('Combine into one summary')
			.setDesc('Produce a single combined summary instead of one per item.')
			.addToggle((toggle) => {
				toggle
					.setValue(this.combine)
					.onChange((val) => {
						this.combine = val;
					});
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select all').onClick(() => {
					this.selected = new Set(this.refTargets.map(t => `${t.type}:${t.line}:${t.source}`));
					this.renderCheckboxes(listEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select none').onClick(() => {
					this.selected.clear();
					this.renderCheckboxes(listEl);
				});
			});

		const listEl = contentEl.createDiv({ cls: 'synapse-summarize-list' });
		this.renderCheckboxes(listEl);

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Summarize selected')
				.setCta()
				.onClick(async () => {
					const chosen = this.collectChosen();
					if (chosen.length === 0) {
						new Notice('Please select at least one item');
						return;
					}
					this.close();
					await this.onSummarize(chosen, this.combine);
				});
		});
	}

	/** Reference targets the user checked, plus note content if its toggle is on. */
	private collectChosen(): SummarizeTarget[] {
		const chosen = this.refTargets.filter(
			t => this.selected.has(`${t.type}:${t.line}:${t.source}`)
		);
		if (this.noteContentTarget && this.includeNote) {
			chosen.push(this.noteContentTarget);
		}
		return chosen;
	}

	private renderCheckboxes(container: HTMLElement): void {
		container.empty();
		for (const target of this.refTargets) {
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
