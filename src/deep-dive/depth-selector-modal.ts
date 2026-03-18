import { App, Modal, Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared/slider-helper';

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

		addEnhancedSlider(
			new Setting(sliderContainer)
				.setName('Recursion Depth')
				.setDesc('How many generations of topics to explore'),
				{
					min: MIN_DEPTH,
					max: MAX_DEPTH,
					step: 1,
					value: this.selectedDepth,
					showTicks: true,
					onChange: async (value) => {
						this.selectedDepth = value;
					},
				}
				
		);

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
