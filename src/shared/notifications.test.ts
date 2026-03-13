import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from './notifications';

describe('NotificationManager', () => {
	let manager: NotificationManager;

	beforeEach(() => {
		manager = new NotificationManager();
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
			expect((mockEl as any).setText).toHaveBeenCalledWith('Auto Notes');
		});

		it('shows operation label when one operation is running', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			manager.startOperation('Scanning vault', 'sb-test');
			expect((mockEl as any).setText).toHaveBeenCalledWith(
				'Auto Notes: Scanning vault'
			);
		});

		it('shows task count when multiple operations are running', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			manager.startOperation('Op A', 'sb-a');
			manager.startOperation('Op B', 'sb-b');
			expect((mockEl as any).setText).toHaveBeenCalledWith(
				'Auto Notes: 2 tasks running'
			);
		});

		it('returns to idle after operations finish', () => {
			const mockEl = { setText: vi.fn() } as unknown as HTMLElement;
			manager.setStatusBarEl(mockEl);
			const handle = manager.startOperation('Work', 'sb-done');
			handle.finish();
			expect((mockEl as any).setText).toHaveBeenLastCalledWith('Auto Notes');
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
				expect.stringContaining('[Auto Notes]'),
				expect.stringContaining('[REDACTED]')
			);
			consoleSpy.mockRestore();
		});
	});
});
