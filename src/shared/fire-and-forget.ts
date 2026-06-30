import { Notice } from 'obsidian';
import type { NotificationManager } from './notifications';
import { redactError } from './redact';

/**
 * Options for {@link fireAndForget}.
 */
export interface FireAndForgetOptions {
	/**
	 * Notification manager used to surface rejections to the user. When provided,
	 * a rejection routes through {@link NotificationManager.notifyError} (which
	 * redacts secrets, shows a styled toast, and logs to the console) so the
	 * failure is visible and consistent with the rest of the plugin.
	 *
	 * When omitted, a plain `Notice` is shown and the error is logged via
	 * `console.error`.
	 */
	notifications?: NotificationManager;
	/**
	 * Background mode: suppress the user-facing toast and only log to the console.
	 * Use for deliberate background work where a visible error would be noise
	 * (e.g. a sidebar refresh, revealing a leaf). Defaults to `false`.
	 */
	background?: boolean;
}

/**
 * Attach rejection handling to a promise that is intentionally not awaited.
 *
 * Obsidian flagged a class of unhandled promise rejections that silently
 * swallowed failures. `fireAndForget` is the single convention for handling
 * those dropped promises across the plugin: it preserves fire-and-forget
 * semantics (the call stays non-blocking — it never returns the promise) while
 * guaranteeing a rejection is surfaced rather than lost.
 *
 * On rejection it surfaces a user-facing error (via the notification manager
 * when supplied, otherwise a plain `Notice`) and logs to the console with the
 * `[Synapse]` prefix and the supplied `label`. In background mode the toast is
 * suppressed and only the console log is emitted.
 *
 * @param promise the promise to observe; its resolved value is ignored.
 * @param label   a short, human-readable description of the work, used in both
 *                the user-facing message and the console log (e.g.
 *                `'Enrich note'`).
 * @param options optional notification manager and/or background flag.
 */
export function fireAndForget(
	promise: Promise<unknown>,
	label: string,
	options: FireAndForgetOptions = {},
): void {
	void promise.catch((err: unknown) => {
		// Background work: log only, never surface a toast. Redact the error
		// before the console sink — logging a raw error here would bypass
		// redact.ts (the single source of truth), the one spot a secret echoed
		// into an error could still leak to the console.
		if (options.background) {
			console.error(`[Synapse] ${label} failed`, redactError(err));
			return;
		}
		// Prefer the notification manager — it redacts secrets from the error,
		// shows a styled toast, AND logs to the console (with `label` as context).
		if (options.notifications) {
			options.notifications.notifyError(label, err);
			return;
		}
		// Fallback when no manager is available: plain notice + console log.
		// Redact the error before logging (single-source-of-truth contract).
		new Notice(`Synapse: ${label} failed`);
		console.error(`[Synapse] ${label} failed`, redactError(err));
	});
}
