import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { NotificationManager } from './notifications';

/** Recursively locate the first <button> element in a stub-element tree. */
function findButton(el: any): any | null {
	for (const child of el.children ?? []) {
		if (child.tagName === 'BUTTON') return child;
		const nested = findButton(child);
		if (nested) return nested;
	}
	return null;
}

/** The most recently constructed Notice (the visible completion/success toast). */
function lastNotice(): any {
	return (Notice as unknown as { instances: any[] }).instances.at(-1);
}

/**
 * Drain the microtask queue (via a 0ms macrotask) so a click handler's clipboard
 * promise chain (writeText().then()/.catch() → info()) has run before we assert
 * on the resulting confirmation toast.
 */
function flushAsync(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('NotificationManager', () => {
	let manager: NotificationManager;

	beforeEach(() => {
		manager = new NotificationManager();
		(Notice as unknown as { instances: any[] }).instances.length = 0;
		// Error toasts copy to the clipboard on click; the node test env has no
		// navigator.clipboard, so stub a resolving one. Individual tests can
		// override writeText (e.g. mockRejectedValueOnce) to exercise failure.
		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
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

	describe('error toasts (#359)', () => {
		/** Silence the console.error that every error path emits. */
		function silenceConsole() {
			return vi.spyOn(console, 'error').mockImplementation(() => {});
		}
		/** The stubbed clipboard writer (see top-level beforeEach). */
		function writeText() {
			return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
		}

		it('builds a persistent (duration 0) error toast on op.error()', () => {
			const consoleSpy = silenceConsole();
			manager.startOperation('Work', 'err-persist').error('Boom');
			// duration 0 → Obsidian never auto-hides it; it stays until clicked.
			expect(lastNotice().duration).toBe(0);
			consoleSpy.mockRestore();
		});

		it('styles the error toast with synapse-notice--error', () => {
			const consoleSpy = silenceConsole();
			manager.startOperation('Work', 'err-style').error('Boom');
			expect(lastNotice().noticeEl.classList.contains('synapse-notice--error')).toBe(true);
			consoleSpy.mockRestore();
		});

		it('keeps the error toast click-dismissible (no --no-dismiss class)', () => {
			const consoleSpy = silenceConsole();
			manager.startOperation('Work', 'err-dismiss').error('Boom');
			// Running/confirmation toasts carry --no-dismiss; error toasts must not.
			expect(lastNotice().noticeEl.classList.contains('synapse-notice--no-dismiss')).toBe(false);
			consoleSpy.mockRestore();
		});

		it('clicking copies the redacted text to the clipboard and hides the toast', () => {
			const consoleSpy = silenceConsole();
			manager.notifyError('API call', new Error('boom sk-1234567890abcdef'));
			const notice = lastNotice();

			notice.noticeEl.dispatchEvent({ type: 'click' });

			expect(notice.hide).toHaveBeenCalledTimes(1);
			expect(writeText()).toHaveBeenCalledTimes(1);
			const copied = writeText().mock.calls[0][0];
			expect(copied).toContain('[REDACTED]');
			expect(copied).not.toContain('sk-1234567890abcdef');
			consoleSpy.mockRestore();
		});

		it('shows a brief confirmation toast after a successful copy', async () => {
			const consoleSpy = silenceConsole();
			manager.notifyError('API call', new Error('kaboom'));
			lastNotice().noticeEl.dispatchEvent({ type: 'click' });

			await flushAsync(); // let writeText().then() → info() run

			expect(lastNotice().noticeEl.textContent).toContain('Error copied to clipboard');
			consoleSpy.mockRestore();
		});

		it('falls back to a "couldn\'t copy" notice when the clipboard write rejects', async () => {
			const consoleSpy = silenceConsole();
			writeText().mockRejectedValueOnce(new Error('document not focused'));
			manager.notifyError('API call', new Error('kaboom'));
			lastNotice().noticeEl.dispatchEvent({ type: 'click' });

			await flushAsync(); // let writeText().catch() → info() run

			expect(lastNotice().noticeEl.textContent).toContain("Couldn't copy");
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Could not copy error to clipboard'),
				expect.anything()
			);
			consoleSpy.mockRestore();
		});
	});
});
