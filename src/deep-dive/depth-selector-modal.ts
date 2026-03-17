import { App, SuggestModal } from 'obsidian';

const DEPTH_OPTIONS = [1, 2, 3, 4, 5, 6];

export class DepthSelectorModal extends SuggestModal<number> {
	private onChooseDepth: (depth: number) => void;
	private defaultDepth: number;

	constructor(app: App, defaultDepth: number, onChoose: (depth: number) => void) {
		super(app);
		this.defaultDepth = defaultDepth;
		this.onChooseDepth = onChoose;
		this.setPlaceholder('Select recursion depth');
	}

	getSuggestions(): number[] {
		return DEPTH_OPTIONS;
	}

	renderSuggestion(depth: number, el: HTMLElement): void {
		const label = depth === this.defaultDepth
			? `Depth ${depth} (default)`
			: `Depth ${depth}`;
		el.createEl('div', { text: label });
	}

	onChooseSuggestion(depth: number): void {
		this.onChooseDepth(depth);
	}
}

/**
 * Show a depth-selection modal and return the chosen depth.
 * Returns null if the user dismisses the modal without choosing.
 */
export function selectDepth(app: App, defaultDepth: number): Promise<number | null> {
	return new Promise((resolve) => {
		const modal = new DepthSelectorModal(app, defaultDepth, (depth) => {
			resolve(depth);
		});

		// Handle dismissal (Escape / clicking outside)
		const origOnClose = modal.onClose.bind(modal);
		let chosen = false;
		const origOnChoose = modal.onChooseSuggestion.bind(modal);
		modal.onChooseSuggestion = (depth: number) => {
			chosen = true;
			origOnChoose(depth);
		};
		modal.onClose = () => {
			origOnClose();
			if (!chosen) {
				resolve(null);
			}
		};

		modal.open();
	});
}
