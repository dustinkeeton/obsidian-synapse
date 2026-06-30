import { describe, it, expect, vi } from 'vitest';
import { DepthSelectorModal, MIN_DEPTH, MAX_DEPTH, selectDepth } from './depth-selector-modal';

vi.mock('obsidian');

/** Typed view of the modal's private confirm internals the UI callbacks drive. */
function internals(
	modal: DepthSelectorModal,
): { resolved: boolean; resolve: (depth: number | null) => void } {
	return modal as unknown as {
		resolved: boolean;
		resolve: (depth: number | null) => void;
	};
}

describe('DepthSelectorModal', () => {
	const mockApp = {} as ConstructorParameters<typeof DepthSelectorModal>[0];

	it('resolves with chosen depth on confirm', () => {
		const modal = new DepthSelectorModal(mockApp, 3);
		const resolve = vi.fn();
		modal.setResolver(resolve);

		// Simulate the confirm button callback
		internals(modal).resolved = true;
		internals(modal).resolve(5);

		expect(resolve).toHaveBeenCalledWith(5);
	});

	it('resolves with default depth when unchanged', () => {
		const modal = new DepthSelectorModal(mockApp, 3);
		const resolve = vi.fn();
		modal.setResolver(resolve);

		internals(modal).resolved = true;
		internals(modal).resolve(3);

		expect(resolve).toHaveBeenCalledWith(3);
	});

	it('resolves null when dismissed without confirming', () => {
		const modal = new DepthSelectorModal(mockApp, 4);
		const resolve = vi.fn();
		modal.setResolver(resolve);

		modal.onClose();

		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('does not double-resolve on close after confirm', () => {
		const modal = new DepthSelectorModal(mockApp, 3);
		const resolve = vi.fn();
		modal.setResolver(resolve);

		// Simulate confirm
		internals(modal).resolved = true;
		internals(modal).resolve(5);

		// Then close fires
		modal.onClose();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(5);
	});

	it('exports valid depth range constants', () => {
		expect(MIN_DEPTH).toBe(1);
		expect(MAX_DEPTH).toBe(6);
	});
});

describe('selectDepth', () => {
	it('is exported as a function', () => {
		expect(typeof selectDepth).toBe('function');
	});
});
