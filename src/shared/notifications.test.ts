import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { NotificationManager } from './notifications';

/** Recursively locate the first element with the given tagName in a stub tree. */
function findByTag(el: any, tagName: string): any | null {
	for (const child of el.children ?? []) {
		if (child.tagName === tagName) return child;
		const nested = findByTag(child, tagName);
		if (nested) return nested;
	}
	return null;
}

/** Recursively locate the first <button> element in a stub-element tree. */
function findButton(el: any): any | null {
	return findByTag(el, 'BUTTON');
}

/** The SVG progress overlay rendered on an operation toast's Cancel button. */
function findProgressOverlay(noticeEl: any): any | null {
	return findByTag(noticeEl, 'SVG');
}

/** The determinate fill <rect> (first child of the overlay). */
function fillRect(overlay: any): any {
	return overlay.children?.[0];
}

/** The most recently constructed Notice (the visible completion/success toast). */
function lastNotice(): any {
	return (Notice as unknown as { instances: any[] }).instances.at(-1);
}

describe('NotificationManager', () => {
	let manager: NotificationManager;

	beforeEach(() => {
		manager = new NotificationManager();
		(Notice as unknown as { instances: any[] }).instances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('startOperation', () => {
		it('returns a handle with cancelled = false initially', () => {
			const handle = manager.startOperation('Testing');
			expect(handle.cancelled).toBe(false);
		});

		it('replaces an existing operation with the same id', () => {
			const handle1 = manager.startOperation('First', 'op-1');
			const handle2 = manager.startOperation('Second', 'op-1');
			expect(handle2.cancelled).toBe(false);
		});
	});

	describe('cancellation', () => {
		it('sets cancelled to true when cancelOperation is called', () => {
			const handle = manager.startOperation('Work', 'cancel-test');
			expect(handle.cancelled).toBe(false);
			manager.cancelOperation('cancel-test');
			expect(handle.cancelled).toBe(true);
		});

		it('ignores cancel for non-existent operation', () => {
			expect(() => manager.cancelOperation('does-not-exist')).not.toThrow();
		});

		it('ignores cancel for already-finished operation', () => {
			const handle = manager.startOperation('Done', 'finish-test');
			handle.finish('Complete');
			manager.cancelOperation('finish-test');
			expect(handle.cancelled).toBe(false);
		});

		it('prevents finish after cancel', () => {
			const handle = manager.startOperation('Work', 'cancel-first');
			manager.cancelOperation('cancel-first');
			handle.finish('Should not show');
			expect(handle.cancelled).toBe(true);
		});

		it('prevents error after cancel', () => {
			const handle = manager.startOperation('Work', 'cancel-err');
			manager.cancelOperation('cancel-err');
			handle.error('Should not show');
			expect(handle.cancelled).toBe(true);
		});
	});

	describe('finish', () => {
		it('prevents further updates after finish', () => {
			const handle = manager.startOperation('Work', 'finish-lock');
			handle.finish('Done');
			handle.update('Should not work');
			handle.progress(1, 2);
			handle.error('Should not show');
		});
	});

	describe('error', () => {
		it('prevents further updates after error', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const handle = manager.startOperation('Work', 'error-lock');
			handle.error('Failed');
			handle.update('Should not work');
			handle.finish('Should not show');
			consoleSpy.mockRestore();
		});
	});

	describe('status bar', () => {
		it('shows idle text when no operations are running', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			expect((mockEl as any).setText).toHaveBeenCalledWith('Synapse');
		});

		it('shows operation label when one operation is running', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			manager.startOperation('Scanning vault', 'sb-test');
			expect((mockEl as any).setText).toHaveBeenCalledWith(
				'Synapse: Scanning vault'
			);
		});

		it('shows task count when multiple operations are running', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			manager.startOperation('Op A', 'sb-a');
			manager.startOperation('Op B', 'sb-b');
			expect((mockEl as any).setText).toHaveBeenCalledWith(
				'Synapse: 2 tasks running'
			);
		});

		it('returns to idle after operations finish', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			const handle = manager.startOperation('Work', 'sb-done');
			handle.finish();
			expect((mockEl as any).setText).toHaveBeenLastCalledWith('Synapse');
		});
	});

	describe('action button (#340)', () => {
		it('success renders a button labelled by the action and wires its click', () => {
			const onClick = vi.fn();
			manager.success('Title proposal ready', undefined, { label: 'Review', onClick });

			const notice = lastNotice();
			const button = findButton(notice.noticeEl);
			expect(button).not.toBeNull();
			expect(button.textContent).toBe('Review');
			expect(button.classList.contains('mod-cta')).toBe(true);

			// Clicking invokes the handler exactly once, then hides the toast.
			button.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
			expect(onClick).toHaveBeenCalledTimes(1);
			expect(notice.hide).toHaveBeenCalledTimes(1);
		});

		it('success without an action renders no button (regression guard)', () => {
			manager.success('Done!');
			expect(findButton(lastNotice().noticeEl)).toBeNull();
		});

		it('finish renders an action button when an action is supplied', () => {
			const onClick = vi.fn();
			const handle = manager.startOperation('Generating', 'op-action');
			handle.finish('Generated 3 proposals', { label: 'Review', onClick });

			const notice = lastNotice();
			const button = findButton(notice.noticeEl);
			expect(button?.textContent).toBe('Review');

			button.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
			expect(onClick).toHaveBeenCalledTimes(1);
			expect(notice.hide).toHaveBeenCalledTimes(1);
		});

		it('finish without an action renders no button (regression guard)', () => {
			const handle = manager.startOperation('Working', 'op-plain');
			handle.finish('Done');
			expect(findButton(lastNotice().noticeEl)).toBeNull();
		});
	});

	describe('cancel-button progress border (#269)', () => {
		/** The Notice backing the *running* operation toast (first one created). */
		function runningNotice(): any {
			return (Notice as unknown as { instances: any[] }).instances[0];
		}

		it('renders an SVG progress overlay on the Cancel button when an operation starts', () => {
			manager.startOperation('Scanning', 'op-overlay');
			const cancelBtn = findButton(runningNotice().noticeEl);
			expect(cancelBtn?.textContent).toBe('Cancel');

			const overlay = findProgressOverlay(runningNotice().noticeEl);
			expect(overlay).not.toBeNull();
			// The overlay is a child of the Cancel button (so it traces its border)…
			expect(findProgressOverlay(cancelBtn)).toBe(overlay);
			// …and must not swallow clicks meant for the button.
			expect(overlay.classList.contains('synapse-notice-op-progress')).toBe(true);
		});

		it('starts in indeterminate (orbiting) mode before any progress() call', () => {
			manager.startOperation('Working', 'op-indeterminate');
			const overlay = findProgressOverlay(runningNotice().noticeEl);
			expect(overlay.classList.contains('is-indeterminate')).toBe(true);
			expect(overlay.classList.contains('is-determinate')).toBe(false);
		});

		it('switches to determinate fill on the first progress() call', () => {
			const handle = manager.startOperation('Working', 'op-switch');
			const overlay = findProgressOverlay(runningNotice().noticeEl);
			expect(overlay.classList.contains('is-indeterminate')).toBe(true);

			handle.progress(1, 4);
			expect(overlay.classList.contains('is-determinate')).toBe(true);
			expect(overlay.classList.contains('is-indeterminate')).toBe(false);
		});

		it('maps current/total to the fill via stroke-dashoffset (1/4 → 75)', () => {
			const handle = manager.startOperation('Working', 'op-fill');
			const overlay = findProgressOverlay(runningNotice().noticeEl);

			handle.progress(1, 4);
			// pathLength is normalized to 100; offset = 100 * (1 - current/total).
			expect(fillRect(overlay).getAttribute('stroke-dashoffset')).toBe('75');

			handle.progress(3, 4);
			expect(fillRect(overlay).getAttribute('stroke-dashoffset')).toBe('25');

			handle.progress(4, 4);
			expect(fillRect(overlay).getAttribute('stroke-dashoffset')).toBe('0');
		});

		it('reverts to indeterminate when update() restarts the ellipsis', () => {
			const handle = manager.startOperation('Working', 'op-revert');
			const overlay = findProgressOverlay(runningNotice().noticeEl);

			handle.progress(2, 4);
			expect(overlay.classList.contains('is-determinate')).toBe(true);

			handle.update('Re-scanning');
			expect(overlay.classList.contains('is-indeterminate')).toBe(true);
			expect(overlay.classList.contains('is-determinate')).toBe(false);
		});

		it('keeps the fill empty when total is zero (no division by zero)', () => {
			const handle = manager.startOperation('Working', 'op-zero');
			const overlay = findProgressOverlay(runningNotice().noticeEl);
			handle.progress(0, 0);
			expect(fillRect(overlay).getAttribute('stroke-dashoffset')).toBe('100');
		});

		it('tears the overlay down off the Cancel button on finish', () => {
			const handle = manager.startOperation('Working', 'op-finish');
			const notice = runningNotice();
			expect(findProgressOverlay(notice.noticeEl)).not.toBeNull();

			handle.finish('Done');
			expect(findProgressOverlay(notice.noticeEl)).toBeNull();
		});

		it('tears the overlay down on error', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const handle = manager.startOperation('Working', 'op-err');
			const notice = runningNotice();
			expect(findProgressOverlay(notice.noticeEl)).not.toBeNull();

			handle.error('Boom');
			expect(findProgressOverlay(notice.noticeEl)).toBeNull();
			consoleSpy.mockRestore();
		});

		it('tears the overlay down on cancel', () => {
			manager.startOperation('Working', 'op-cancel-teardown');
			const notice = runningNotice();
			expect(findProgressOverlay(notice.noticeEl)).not.toBeNull();

			manager.cancelOperation('op-cancel-teardown');
			expect(findProgressOverlay(notice.noticeEl)).toBeNull();
		});
	});

	describe('info and notifyError', () => {
		it('info does not throw', () => {
			expect(() => manager.info('Test message')).not.toThrow();
		});

		it('success does not throw', () => {
			expect(() => manager.success('Done!')).not.toThrow();
		});

		it('notifyError redacts API keys', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			manager.notifyError('API call', new Error('Failed with sk-1234567890abcdef'));
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('[Synapse]'),
				expect.stringContaining('[REDACTED]')
			);
			consoleSpy.mockRestore();
		});
	});
});
