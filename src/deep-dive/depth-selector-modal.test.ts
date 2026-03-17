import { describe, it, expect, vi } from 'vitest';

// Mock obsidian before importing the module under test
vi.mock('obsidian', () => {
	class SuggestModal {
		app: unknown;
		constructor(app: unknown) { this.app = app; }
		setPlaceholder() {}
		open() {}
		close() {}
		onClose() {}
	}
	return { SuggestModal };
});

import { DepthSelectorModal } from './depth-selector-modal';

describe('DepthSelectorModal', () => {
	const mockApp = {} as Parameters<typeof import('./depth-selector-modal').selectDepth>[0];

	it('getSuggestions returns depths 1-6', () => {
		const modal = new DepthSelectorModal(mockApp as never, 3, () => {});
		const suggestions = modal.getSuggestions();
		expect(suggestions).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('renderSuggestion marks the default depth', () => {
		const modal = new DepthSelectorModal(mockApp as never, 3, () => {});
		const el = { createEl: vi.fn() } as unknown as HTMLElement;

		modal.renderSuggestion(3, el);
		expect(el.createEl).toHaveBeenCalledWith('div', { text: 'Depth 3 (default)' });

		modal.renderSuggestion(2, el);
		expect(el.createEl).toHaveBeenCalledWith('div', { text: 'Depth 2' });
	});

	it('onChooseSuggestion calls the callback with the chosen depth', () => {
		const callback = vi.fn();
		const modal = new DepthSelectorModal(mockApp as never, 3, callback);

		modal.onChooseSuggestion(5);
		expect(callback).toHaveBeenCalledWith(5);
	});
});
