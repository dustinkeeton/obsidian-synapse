import { describe, it, expect, vi } from 'vitest';
import { ConfirmModal } from './confirm-modal';

// No vi.mock('obsidian') here: the vitest.config alias already resolves
// 'obsidian' to the manual mock (src/__mocks__/obsidian.ts), which gives Modal
// real `open`/`close` instance methods. Auto-mocking would strip those, breaking
// openAndConfirm()/settle().

/**
 * Reach into the modal's confirm internals the button callbacks drive. Mirrors
 * the DepthSelectorModal test: `onOpen` isn't exercised (the Modal mock's
 * `contentEl` is a bare stub), so the confirm/cancel paths are driven through
 * the private `settle` and the public `onClose`.
 */
function internals(modal: ConfirmModal): {
	resolved: boolean;
	resolve: (confirmed: boolean) => void;
	settle: (confirmed: boolean) => void;
} {
	return modal as unknown as {
		resolved: boolean;
		resolve: (confirmed: boolean) => void;
		settle: (confirmed: boolean) => void;
	};
}

describe('ConfirmModal', () => {
	const mockApp = {} as ConstructorParameters<typeof ConfirmModal>[0];
	const opts = { title: 'Reset audio transcription?', message: 'Are you sure?' };

	it('resolves true when the confirm action settles', async () => {
		const modal = new ConfirmModal(mockApp, opts);
		const promise = modal.openAndConfirm();

		internals(modal).settle(true);

		await expect(promise).resolves.toBe(true);
	});

	it('resolves false when the cancel action settles', async () => {
		const modal = new ConfirmModal(mockApp, opts);
		const promise = modal.openAndConfirm();

		internals(modal).settle(false);

		await expect(promise).resolves.toBe(false);
	});

	it('resolves false when dismissed without choosing (onClose)', async () => {
		const modal = new ConfirmModal(mockApp, opts);
		const promise = modal.openAndConfirm();

		modal.onClose();

		await expect(promise).resolves.toBe(false);
	});

	it('does not double-resolve when closed after a confirm', () => {
		const modal = new ConfirmModal(mockApp, opts);
		const resolve = vi.fn();
		internals(modal).resolve = resolve;

		internals(modal).settle(true);
		modal.onClose();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(true);
	});

	it('closes the modal once a choice is made', () => {
		const modal = new ConfirmModal(mockApp, opts);

		internals(modal).settle(true);

		expect(modal.close as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
	});
});
