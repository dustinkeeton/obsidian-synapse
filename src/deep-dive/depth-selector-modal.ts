import { App, Modal, Setting } from 'obsidian';

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 6;

export class DepthSelectorModal extends Modal {
	private selectedDepth: number;
	private defaultDepth: number;
	private resolved = false;
	private resolve: (depth: number | null) => void = () => {};

	constructor(app: App, defaultDepth: number) {
		super(app);
		this.defaultDepth = defaultDepth;
		this.selectedDepth = defaultDepth;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('auto-notes-depth-selector');

		contentEl.createEl('h3', { text: 'Select recursion depth' });

		// Slider with tick labels
		const sliderContainer = contentEl.createDiv({ cls: 'auto-notes-depth-slider' });

		const valueDisplay = sliderContainer.createEl('span', {
			cls: 'auto-notes-depth-value',
			text: this.formatLabel(this.selectedDepth),
		});

		new Setting(sliderContainer)
			.setName('')
			.addSlider((slider) => {
				slider
					.setLimits(MIN_DEPTH, MAX_DEPTH, 1)
					.setValue(this.selectedDepth)
					.setDynamicTooltip()
					.onChange((value) => {
						this.selectedDepth = value;
						valueDisplay.textContent = this.formatLabel(value);
					});
			});

		// Tick labels row
		const tickRow = sliderContainer.createDiv({ cls: 'auto-notes-depth-ticks' });
		for (let i = MIN_DEPTH; i <= MAX_DEPTH; i++) {
			tickRow.createEl('span', {
				text: String(i),
				cls: 'auto-notes-depth-tick',
			});
		}

		// Confirm / Cancel buttons
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Cancel').onClick(() => {
					this.resolved = true;
					this.resolve(null);
					this.close();
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Confirm')
					.setCta()
					.onClick(() => {
						this.resolved = true;
						this.resolve(this.selectedDepth);
						this.close();
					});
			});
	}

	onClose(): void {
		this.contentEl?.empty();
		if (!this.resolved) {
			this.resolve(null);
		}
	}

	/** Attach the promise resolver before opening. */
	setResolver(resolve: (depth: number | null) => void): void {
		this.resolve = resolve;
	}

	private formatLabel(depth: number): string {
		return depth === this.defaultDepth
			? `Depth ${depth} (default)`
			: `Depth ${depth}`;
	}
}

/**
 * Show a depth-selection modal and return the chosen depth.
 * Returns null if the user dismisses the modal without choosing.
 */
export function selectDepth(app: App, defaultDepth: number): Promise<number | null> {
	return new Promise((resolve) => {
		const modal = new DepthSelectorModal(app, defaultDepth);
		modal.setResolver(resolve);
		modal.open();
	});
}
