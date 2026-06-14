import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { fireAndForget } from './fire-and-forget';
import type { NotificationManager } from './notifications';

// Wrap the obsidian mock's `Notice` as a spy constructor so we can assert that
// (and how) a user-facing notice was shown. Everything else falls through to
// the centralized mock (src/__mocks__/obsidian.ts) via importOriginal.
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: vi.fn(function (this: unknown, message?: unknown, duration?: unknown) {
			// Delegate to the real mock Notice so instance shape stays intact.
			return new actual.Notice(message as string, duration as number);
		}),
	};
});

/**
 * `fireAndForget` deliberately does not return the promise it observes, so its
 * rejection handling runs on the microtask queue. Flushing the queue lets the
 * `.catch` settle before assertions. Two `await`s cover the extra microtask the
 * notification-manager path adds.
 */
async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe('fireAndForget', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.mocked(Notice).mockClear();
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	describe('when the promise resolves', () => {
		it('shows no Notice and logs no error', async () => {
			fireAndForget(Promise.resolve('ok'), 'Enrich note');
			await flushMicrotasks();

			expect(Notice).not.toHaveBeenCalled();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('returns void (does not return the observed promise)', () => {
			const result = fireAndForget(Promise.resolve(), 'Enrich note');
			expect(result).toBeUndefined();
		});
	});

	describe('when the promise rejects (no notification manager)', () => {
		it('shows a Notice and logs console.error with the label', async () => {
			const err = new Error('boom');
			fireAndForget(Promise.reject(err), 'Enrich note');
			await flushMicrotasks();

			expect(Notice).toHaveBeenCalledTimes(1);
			expect(String(vi.mocked(Notice).mock.calls[0][0])).toContain('Enrich note');

			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
			const [message, loggedErr] = consoleErrorSpy.mock.calls[0];
			expect(message).toContain('Enrich note');
			expect(message).toContain('[Synapse]');
			expect(loggedErr).toBe(err);
		});

		it('does not let the rejection escape as an unhandled rejection', async () => {
			// If fireAndForget failed to attach a handler, this rejected promise
			// would surface as an unhandled rejection and fail the test run.
			expect(() =>
				fireAndForget(Promise.reject(new Error('swallowed')), 'Check title'),
			).not.toThrow();
			await flushMicrotasks();
			expect(consoleErrorSpy).toHaveBeenCalled();
		});
	});

	describe('when the promise rejects (with notification manager)', () => {
		it('routes through notifyError with the label and skips the plain Notice', async () => {
			const err = new Error('boom');
			const notifyError = vi.fn();
			const notifications = { notifyError } as unknown as NotificationManager;

			fireAndForget(Promise.reject(err), 'Organize note', { notifications });
			await flushMicrotasks();

			// The manager owns both the user-facing toast and the console log,
			// so fireAndForget must not also construct a plain Notice.
			expect(Notice).not.toHaveBeenCalled();
			expect(notifyError).toHaveBeenCalledTimes(1);
			expect(notifyError).toHaveBeenCalledWith('Organize note', err);
		});
	});

	describe('background mode', () => {
		it('logs console.error with the label but shows no Notice', async () => {
			const err = new Error('boom');
			const notifyError = vi.fn();
			const notifications = { notifyError } as unknown as NotificationManager;

			fireAndForget(Promise.reject(err), 'Refresh sidebar', {
				notifications,
				background: true,
			});
			await flushMicrotasks();

			expect(Notice).not.toHaveBeenCalled();
			expect(notifyError).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Refresh sidebar');
		});

		it('does not show a Notice even without a notification manager', async () => {
			fireAndForget(Promise.reject(new Error('boom')), 'Reveal leaf', {
				background: true,
			});
			await flushMicrotasks();

			expect(Notice).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		});
	});
});
