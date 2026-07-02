import { Notice } from 'obsidian';
import { redactSecrets, redactError } from './redact';

export type NoticeLevel = 'info' | 'progress' | 'success' | 'warning' | 'error';

/**
 * Standardized message for a failed external-link content fetch. Used by both
 * Elaborate (proposer) and Summarize so the same underlying failure reads
 * identically wherever it surfaces; pass the result to {@link
 * NotificationManager.error} so it renders as one persistent error notice in
 * both features. `reason` is the specific cause — e.g. the thrown error's
 * message, an HTTP status, or `'page returned no readable text'` for a
 * successful-but-empty fetch.
 */
export function linkLoadError(source: string, reason: string): string {
	return `Could not load content from ${source}: ${reason}`;
}

/**
 * A single action button rendered on an actionable success/completion toast
 * (e.g. "Review"). `onClick` runs when the user presses the button; the toast
 * then hides itself.
 */
export interface NoticeAction {
	label: string;
	onClick: () => void;
}

export interface OperationHandle {
	/** Update the operation's status message */
	update(message: string): void;
	/** Update with progress counter (e.g., 3/5) */
	progress(current: number, total: number, label?: string): void;
	/**
	 * Mark operation as successfully finished. When `action` is supplied the
	 * completion toast renders an action button (e.g. "Review").
	 */
	finish(message?: string, action?: NoticeAction): void;
	/** Mark operation as failed */
	error(message: string): void;
	/** Whether the operation has been cancelled */
	readonly cancelled: boolean;
}

interface TrackedOperation {
	id: string;
	label: string;
	message: string;
	notice: Notice;
	/** Wrapper span — contains labelEl and dotsEl */
	textEl: HTMLElement;
	/** Span holding the static message text (e.g. "Synapse: Scanning") */
	labelEl: HTMLElement;
	/** Fixed-width span that holds the animated dots, preventing layout reflow */
	dotsEl: HTMLElement;
	state: 'running' | 'done' | 'error' | 'cancelled';
	ellipsisInterval: number | null;
}

/**
 * CSS class prefix. Styles for these classes live in styles.css
 * (section "Notification toasts"), which Obsidian loads and unloads
 * automatically with the plugin.
 */
const CLS = 'synapse-notice';

/**
 * Auto-dismiss (ms) for actionable success/completion toasts. Longer than the
 * plain 4s default so the user has time to click the action button before the
 * toast disappears.
 */
const ACTION_NOTICE_DURATION = 8000;

/**
 * Dedup window (ms) for fire-and-forget one-shot toasts (#396). A second
 * identical toast — same level AND message — requested within this window of
 * the first is suppressed, so a per-item loop (e.g. the per-image
 * "auto-downscaled" notice) or a quickly-repeated action can't flood the user
 * with a stack of identical toasts. Deliberately short so a genuinely later
 * recurrence of the same message still surfaces.
 */
const NOTICE_THROTTLE_MS = 3000;

/** Get the underlying DOM element from a Notice */
function getNoticeEl(notice: Notice): HTMLElement {
	return (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
}

/** Apply level styling to a Notice's DOM element */
function styleNotice(notice: Notice, level: NoticeLevel): void {
	const el = getNoticeEl(notice);
	if (!el) return;
	el.className = el.className
		.replace(new RegExp(`\\b${CLS}\\S*`, 'g'), '')
		.trim();
	el.classList.add(CLS, `${CLS}--${level}`);
}

/**
 * Prevent Obsidian's default click-to-dismiss on a Notice.
 * Blocks clicks on the notice background but allows clicks on
 * interactive elements (buttons) to pass through normally.
 */
function preventDismiss(notice: Notice): void {
	const el = getNoticeEl(notice);
	if (!el) return;
	el.classList.add(`${CLS}--no-dismiss`);
	el.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		// Let button clicks through — only block background/text clicks
		if (target.closest('button')) return;
		e.preventDefault();
		e.stopPropagation();
	}, true); // capture phase to beat Obsidian's handler
}

/** Strip trailing dots from a message so the ellipsis animation can manage them */
function stripTrailingDots(msg: string): string {
	return msg.replace(/\.+$/, '');
}

/**
 * Start an animated ellipsis on a dedicated dots element.
 * The dots element should be a fixed-width inline-block span
 * so that changing dot count does not cause the parent to reflow.
 * Returns an interval handle for cleanup.
 */
function startEllipsisOnEl(dotsEl: HTMLElement): number {
	let dotCount = 1;
	return window.setInterval(() => {
		dotCount = (dotCount % 3) + 1;
		dotsEl.textContent = '.'.repeat(dotCount);
	}, 400);
}

function stopEllipsis(intervalId: number | null): void {
	if (intervalId !== null) {
		window.clearInterval(intervalId);
	}
}

/**
 * Centralized notification manager. Tracks concurrent operations,
 * animates progress indicators, colour-codes by severity, and
 * provides confirmation snackbars and graceful cancellation.
 */
export class NotificationManager {
	private operations = new Map<string, TrackedOperation>();
	private statusBarEl: HTMLElement | null = null;
	private idCounter = 0;
	/**
	 * Last-shown timestamps for fire-and-forget one-shot toasts, keyed
	 * `${level}:${message}` (#396). Consulted by {@link isThrottled} to suppress
	 * an identical toast requested again within {@link NOTICE_THROTTLE_MS}.
	 * Cleared in {@link dispose}.
	 */
	private lastShown = new Map<string, number>();

	setStatusBarEl(el: HTMLElement): void {
		this.statusBarEl = el;
		this.updateStatusBar();
	}

	/**
	 * Tear down every in-flight operation: stop its animated-ellipsis interval and
	 * hide its notice. Called from the plugin's `onunload` so disabling Synapse
	 * while an operation is still running never leaves an orphaned 400ms
	 * `setInterval` firing against a detached toast (Obsidian lifecycle hygiene).
	 */
	dispose(): void {
		for (const op of this.operations.values()) {
			stopEllipsis(op.ellipsisInterval);
			op.ellipsisInterval = null;
			op.notice.hide();
		}
		this.operations.clear();
		// Drop dedup timestamps too, so a re-enabled plugin starts with a clean
		// throttle window rather than inheriting stale last-shown times (#396).
		this.lastShown.clear();
	}

	/**
	 * Begin a tracked operation. Returns a handle for updating progress.
	 * The notice is non-dismissible and includes a Cancel button.
	 */
	startOperation(label: string, id?: string): OperationHandle {
		const opId = id ?? `op-${++this.idCounter}`;

		// Clean up existing operation with same id
		const existing = this.operations.get(opId);
		if (existing) {
			stopEllipsis(existing.ellipsisInterval);
			existing.notice.hide();
		}

		const baseLabel = stripTrailingDots(label);

		// Create a persistent notice and take over its DOM
		const notice = new Notice('', 0);
		styleNotice(notice, 'progress');
		preventDismiss(notice);

		const el = getNoticeEl(notice);
		el.empty();

		// Build: [label][dots] [Cancel]
		// The dots span has a fixed min-width so dot-count changes
		// do not cause the toast to reflow horizontally.
		const row = el.createDiv({ cls: `${CLS}-op` });
		const textEl = row.createEl('span', { cls: `${CLS}-op-text` });
		const labelEl = textEl.createEl('span', {
			text: `Synapse: ${baseLabel}`,
		});
		const dotsEl = textEl.createEl('span', {
			cls: `${CLS}-op-dots`,
			text: '.',
		});
		const cancelBtn = row.createEl('button', {
			cls: `${CLS}-op-cancel`,
			text: 'Cancel',
		});
		cancelBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.cancelOperation(opId);
		});

		const ellipsisInterval = startEllipsisOnEl(dotsEl);

		const op: TrackedOperation = {
			id: opId,
			label: baseLabel,
			message: baseLabel,
			notice,
			textEl,
			labelEl,
			dotsEl,
			state: 'running',
			ellipsisInterval,
		};
		this.operations.set(opId, op);
		this.updateStatusBar();

		const handle: OperationHandle = {
			get cancelled() {
				return op.state === 'cancelled';
			},

			update: (message: string) => {
				if (op.state !== 'running') return;
				const base = stripTrailingDots(message);
				op.message = base;
				op.labelEl.textContent = `Synapse: ${base}`;
				op.dotsEl.textContent = '.';
				stopEllipsis(op.ellipsisInterval);
				op.ellipsisInterval = startEllipsisOnEl(op.dotsEl);
				this.updateStatusBar();
			},

			progress: (current: number, total: number, progressLabel?: string) => {
				if (op.state !== 'running') return;
				const base = progressLabel
					? `${stripTrailingDots(progressLabel)} (${current}/${total})`
					: `${op.label} (${current}/${total})`;
				op.message = base;
				// Progress counters don't need animated dots
				stopEllipsis(op.ellipsisInterval);
				op.ellipsisInterval = null;
				op.labelEl.textContent = `Synapse: ${base}`;
				op.dotsEl.textContent = '';
				styleNotice(op.notice, 'progress');
				this.updateStatusBar();
			},

			finish: (message?: string, action?: NoticeAction) => {
				if (op.state !== 'running') return;
				this.completeOperation(
					opId,
					'done',
					message || `${op.label} complete`,
					'success',
					action ? ACTION_NOTICE_DURATION : 4000,
					action
				);
			},

			error: (message: string) => {
				if (op.state !== 'running') return;
				// Duration is ignored for errors (showErrorNotice forces persist);
				// pass 0 to document the persist-until-dismissed intent.
				this.completeOperation(opId, 'error', message, 'error', 0);
				// Redact before the console sink too: the toast (via showErrorNotice)
				// is already redacted, so logging the SAME message raw here would be
				// the one spot a key echoed into an operation error could still leak.
				// Matches notifyError below — redact.ts is the single source of truth.
				console.error(`[Synapse] ${op.label}:`, redactSecrets(message));
			},
		};

		return handle;
	}

	/**
	 * Show a confirmation snackbar with Proceed / Cancel buttons.
	 * Non-dismissible — user must choose an action.
	 */
	confirm(message: string, options?: {
		proceedLabel?: string;
		cancelLabel?: string;
		level?: NoticeLevel;
	}): Promise<boolean> {
		return new Promise((resolve) => {
			const notice = new Notice('', 0);
			styleNotice(notice, options?.level ?? 'warning');
			preventDismiss(notice);

			const el = getNoticeEl(notice);
			el.empty();

			el.createEl('div', { text: `Synapse: ${message}` });

			const actions = el.createDiv({ cls: `${CLS}-actions` });

			const proceedBtn = actions.createEl('button', {
				text: options?.proceedLabel ?? 'Proceed',
				cls: 'mod-cta',
			});
			proceedBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				notice.hide();
				resolve(true);
			});

			const cancelBtn = actions.createEl('button', {
				text: options?.cancelLabel ?? 'Cancel',
				cls: 'mod-cancel',
			});
			cancelBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				notice.hide();
				resolve(false);
			});
		});
	}

	/**
	 * Cancel a running operation by id. Sets state to cancelled so the
	 * operation's loop can check `handle.cancelled` and bail out.
	 */
	cancelOperation(id: string): void {
		const op = this.operations.get(id);
		if (!op || op.state !== 'running') return;
		this.completeOperation(id, 'cancelled', 'Operation cancelled', 'warning', 4000);
	}

	/**
	 * Equal-message throttle for fire-and-forget one-shot toasts (#396). Returns
	 * true when an identical toast — same `level` AND `message` — was shown within
	 * {@link NOTICE_THROTTLE_MS}, signalling the caller to SUPPRESS the new toast.
	 * Otherwise records `Date.now()` for this key and returns false so the caller
	 * proceeds to build the Notice. Keyed on `${level}:${message}` so the same
	 * text at different severities (e.g. info vs error) never collapses into one.
	 *
	 * Only the fire-and-forget one-shot entry points (info/success/error without
	 * an action) consult this. Tracked-operation toasts, confirm(), and
	 * interactive action notices (showActionNotice/infoSticky) deliberately do
	 * NOT — their stateful/lifecycle behavior must never be silently dropped.
	 *
	 * `Date.now()` is the time source: correct in production, and vitest fake
	 * timers mock it so tests can advance deterministically across the window.
	 */
	private isThrottled(level: NoticeLevel, message: string): boolean {
		const key = `${level}:${message}`;
		const now = Date.now();
		const last = this.lastShown.get(key);
		if (last !== undefined && now - last < NOTICE_THROTTLE_MS) {
			return true;
		}
		this.lastShown.set(key, now);
		return false;
	}

	/**
	 * Show a one-shot informational notice (not tracked, dismissible).
	 * When `action` is supplied the toast renders an action button (e.g. "Review").
	 */
	info(message: string, duration = 4000, action?: NoticeAction): void {
		if (action) {
			this.showActionNotice(message, 'info', Math.max(duration, ACTION_NOTICE_DURATION), action);
			return;
		}
		// Suppress an identical info toast fired again within the dedup window
		// (#396) — e.g. the same per-image message emitted once per loop iteration.
		if (this.isThrottled('info', message)) return;
		const notice = new Notice(`Synapse: ${message}`, duration);
		styleNotice(notice, 'info');
	}

	/**
	 * Show a STICKY informational notice carrying a single action button (#365).
	 * Unlike {@link info}/{@link success} with an action — which floor the
	 * duration (~8s) and then auto-dismiss — this stays up until the user clicks
	 * the action OR clicks the toast to dismiss it (duration 0, no preventDismiss).
	 * Used for the "update available" prompt, which must persist until acted on.
	 */
	infoSticky(message: string, action: NoticeAction): void {
		this.showActionNotice(message, 'info', 0, action, { dismissible: true });
	}

	/**
	 * Show a one-shot success notice (dismissible). When `action` is supplied the
	 * toast renders an action button (e.g. "Review") and stays up longer.
	 */
	success(message: string, duration = 4000, action?: NoticeAction): void {
		if (action) {
			this.showActionNotice(message, 'success', Math.max(duration, ACTION_NOTICE_DURATION), action);
			return;
		}
		// Suppress an identical success toast fired again within the dedup window (#396).
		if (this.isThrottled('success', message)) return;
		const notice = new Notice(`Synapse: ${message}`, duration);
		styleNotice(notice, 'success');
	}

	/**
	 * Surface a one-shot error from a fully composed message. The toast is
	 * persistent (stays until clicked) and copies its redacted text to the
	 * clipboard on dismiss — see {@link showErrorNotice}. Use this when you
	 * already have the message text; use {@link notifyError} when you have an
	 * error object plus a context label.
	 */
	error(message: string): void {
		// Throttle is applied HERE — at the one-shot error entry point — not inside
		// showErrorNotice (#396). That keeps tracked-operation error toasts (via
		// completeOperation) and contextual notifyError() unthrottled, since both
		// reach showErrorNotice directly and are exempt per the dedup design.
		if (this.isThrottled('error', message)) return;
		this.showErrorNotice(message);
	}

	/**
	 * Build an interactive one-shot notice carrying a single action button.
	 * Mirrors the confirm() snackbar markup: a message div plus an actions
	 * container holding one `.mod-cta` button. The notice blocks background
	 * click-to-dismiss, but the button click passes through (preventDismiss
	 * lets button targets through), runs the action, and hides the toast.
	 *
	 * `options.dismissible` (used by {@link infoSticky}) skips preventDismiss so
	 * a click anywhere on the toast also dismisses it — the right behavior for a
	 * persistent (duration 0) prompt the user may want to wave away.
	 */
	private showActionNotice(
		message: string,
		level: NoticeLevel,
		duration: number,
		action: NoticeAction,
		options?: { dismissible?: boolean }
	): void {
		const notice = new Notice('', duration);
		styleNotice(notice, level);
		if (!options?.dismissible) preventDismiss(notice);

		const el = getNoticeEl(notice);
		el.empty();

		el.createEl('div', { text: `Synapse: ${message}` });

		const actions = el.createDiv({ cls: `${CLS}-actions` });
		const button = actions.createEl('button', {
			text: action.label,
			cls: 'mod-cta',
		});
		button.addEventListener('click', (e) => {
			e.stopPropagation();
			action.onClick();
			notice.hide();
		});
	}

	/**
	 * Render a persistent, click-to-dismiss error toast. The single shared sink
	 * for every error path (operation errors via completeOperation, notifyError,
	 * and the public error()), so error styling, persistence, secret redaction,
	 * and copy-on-dismiss all live in exactly one place.
	 *
	 * Unlike running-operation and confirmation toasts, error toasts are NOT
	 * preventDismiss()'d — clicking is how the user dismisses them. The same
	 * click copies the (redacted) text to the clipboard for bug reports; the
	 * copy is best-effort and never blocks dismissal.
	 */
	private showErrorNotice(message: string): void {
		const redacted = redactSecrets(message);
		// Duration 0 → Obsidian never auto-hides it; it persists until clicked.
		const notice = new Notice(`Synapse: ${redacted}`, 0);
		styleNotice(notice, 'error');
		const el = getNoticeEl(notice);
		if (!el) return;
		// Attach to the `.notice` container so the whole toast — the full surface
		// the error wash + pointer cursor cover — copies on click. noticeEl is the
		// inner `.notice-message` in current Obsidian; fall back to it when there
		// is no container (e.g. the test mock).
		const clickTarget = el.closest('.notice') ?? el;
		clickTarget.addEventListener('click', () => {
			// Always dismiss on click, even if the clipboard write fails.
			notice.hide();
			navigator.clipboard.writeText(redacted)
				.then(() => this.info('Error copied to clipboard'))
				.catch((err) => {
					console.error('[Synapse] Could not copy error to clipboard:', redactError(err));
					this.info("Couldn't copy error to clipboard");
				});
		});
	}

	/**
	 * Surface an error (object + context label) as a persistent, copyable error
	 * toast. Routes through {@link showErrorNotice} so the displayed and copied
	 * text are redacted by the canonical redactor; also logs the redacted message.
	 */
	notifyError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.showErrorNotice(`${context} — ${message}`);
		console.error(`[Synapse] ${context}:`, redactSecrets(message));
	}

	private completeOperation(
		id: string,
		newState: TrackedOperation['state'],
		message: string,
		level: NoticeLevel,
		duration: number,
		action?: NoticeAction
	): void {
		const op = this.operations.get(id);
		if (!op) return;
		op.state = newState;
		stopEllipsis(op.ellipsisInterval);
		op.notice.hide();
		// Completion/error/cancel notices are normal dismissible toasts. When an
		// action is supplied, build an interactive notice with a single button;
		// otherwise keep the plain (unchanged) path.
		if (action) {
			this.showActionNotice(message, level, duration, action);
		} else if (level === 'error') {
			// Error completions get the persistent, copy-on-dismiss treatment.
			this.showErrorNotice(message);
		} else {
			const notice = new Notice(`Synapse: ${message}`, duration);
			styleNotice(notice, level);
		}
		this.operations.delete(id);
		this.updateStatusBar();
	}

	private updateStatusBar(): void {
		if (!this.statusBarEl) return;

		const running = [...this.operations.values()].filter(
			(op) => op.state === 'running'
		);

		if (running.length === 0) {
			this.statusBarEl.setText('Synapse');
		} else if (running.length === 1) {
			this.statusBarEl.setText(`Synapse: ${running[0].message}`);
		} else {
			this.statusBarEl.setText(`Synapse: ${running.length} tasks running`);
		}
	}
}
