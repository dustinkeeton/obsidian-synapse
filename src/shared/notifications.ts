import { Notice } from 'obsidian';

export type NoticeLevel = 'info' | 'progress' | 'success' | 'warning' | 'error';

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
				this.completeOperation(opId, 'error', message, 'error', 8000);
				console.error(`[Synapse] ${op.label}:`, message);
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
	 * Show a one-shot informational notice (not tracked, dismissible).
	 * When `action` is supplied the toast renders an action button (e.g. "Review").
	 */
	info(message: string, duration = 4000, action?: NoticeAction): void {
		if (action) {
			this.showActionNotice(message, 'info', Math.max(duration, ACTION_NOTICE_DURATION), action);
			return;
		}
		const notice = new Notice(`Synapse: ${message}`, duration);
		styleNotice(notice, 'info');
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
		const notice = new Notice(`Synapse: ${message}`, duration);
		styleNotice(notice, 'success');
	}

	/**
	 * Build an interactive one-shot notice carrying a single action button.
	 * Mirrors the confirm() snackbar markup: a message div plus an actions
	 * container holding one `.mod-cta` button. The notice blocks background
	 * click-to-dismiss, but the button click passes through (preventDismiss
	 * lets button targets through), runs the action, and hides the toast.
	 */
	private showActionNotice(
		message: string,
		level: NoticeLevel,
		duration: number,
		action: NoticeAction
	): void {
		const notice = new Notice('', duration);
		styleNotice(notice, level);
		preventDismiss(notice);

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

	/** Show a one-shot error notice (dismissible, stays longer) */
	notifyError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		const redacted = message.replace(
			/(?:sk-|key-|dg-|anthropic-|Bearer\s+|Token\s+)[A-Za-z0-9_-]{8,}/g,
			'[REDACTED]'
		);
		const notice = new Notice(`Synapse: ${context} — ${redacted}`, 8000);
		styleNotice(notice, 'error');
		console.error(`[Synapse] ${context}:`, redacted);
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
