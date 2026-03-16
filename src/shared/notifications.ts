import { Notice } from 'obsidian';

export type NoticeLevel = 'info' | 'progress' | 'success' | 'warning' | 'error';

export interface OperationHandle {
	/** Update the operation's status message */
	update(message: string): void;
	/** Update with progress counter (e.g., 3/5) */
	progress(current: number, total: number, label?: string): void;
	/** Mark operation as successfully finished */
	finish(message?: string): void;
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
	/** Span holding the static message text (e.g. "Auto Notes: Scanning") */
	labelEl: HTMLElement;
	/** Fixed-width span that holds the animated dots, preventing layout reflow */
	dotsEl: HTMLElement;
	state: 'running' | 'done' | 'error' | 'cancelled';
	ellipsisInterval: ReturnType<typeof setInterval> | null;
}

/** CSS class prefix */
const CLS = 'auto-notes-notice';

let stylesInjected = false;

function injectStyles(): void {
	if (stylesInjected) return;
	stylesInjected = true;

	if (typeof document === 'undefined') return;

	const style = document.createElement('style');
	style.id = 'auto-notes-notification-styles';
	style.textContent = `
		.${CLS} {
			border-left: 3px solid var(--text-muted);
			padding-left: 10px !important;
			transition: border-color 0.3s ease;
		}
		.${CLS}--info     { border-left-color: var(--text-muted); }
		.${CLS}--progress { border-left-color: var(--interactive-accent); }
		.${CLS}--success  { border-left-color: var(--color-green); }
		.${CLS}--warning  { border-left-color: var(--color-yellow); }
		.${CLS}--error    { border-left-color: var(--color-red); }

		/* Running operation layout */
		.${CLS}-op {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.${CLS}-op-text {
			flex: 1;
		}
		.${CLS}-op-dots {
			display: inline-block;
			min-width: 1.5ch;
			text-align: left;
		}
		.${CLS}-op-cancel {
			flex-shrink: 0;
			padding: 2px 10px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 11px;
			border: 1px solid var(--text-muted);
			background: transparent;
			color: var(--text-muted);
			transition: color 0.15s, border-color 0.15s;
		}
		.${CLS}-op-cancel:hover {
			color: var(--text-normal);
			border-color: var(--text-normal);
		}

		/* Prevent click-to-dismiss on running operations */
		.${CLS}--no-dismiss {
			cursor: default;
		}

		/* Confirmation snackbar buttons */
		.${CLS}-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
		}
		.${CLS}-actions button {
			padding: 2px 12px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
			border: 1px solid var(--background-modifier-border);
		}
		.${CLS}-actions button.mod-cta {
			background: var(--interactive-accent);
			color: var(--text-on-accent);
			border-color: var(--interactive-accent);
		}
		.${CLS}-actions button.mod-cancel {
			background: transparent;
			color: var(--text-muted);
		}
	`;
	document.head.appendChild(style);
}

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
function startEllipsisOnEl(dotsEl: HTMLElement): ReturnType<typeof setInterval> {
	let dotCount = 1;
	return globalThis.setInterval(() => {
		dotCount = (dotCount % 3) + 1;
		dotsEl.textContent = '.'.repeat(dotCount);
	}, 400);
}

function stopEllipsis(intervalId: ReturnType<typeof setInterval> | null): void {
	if (intervalId !== null) {
		globalThis.clearInterval(intervalId);
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

	constructor() {
		injectStyles();
	}

	setStatusBarEl(el: HTMLElement): void {
		this.statusBarEl = el;
		this.updateStatusBar();
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
			text: `Auto Notes: ${baseLabel}`,
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
				op.labelEl.textContent = `Auto Notes: ${base}`;
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
				op.labelEl.textContent = `Auto Notes: ${base}`;
				op.dotsEl.textContent = '';
				styleNotice(op.notice, 'progress');
				this.updateStatusBar();
			},

			finish: (message?: string) => {
				if (op.state !== 'running') return;
				this.completeOperation(opId, 'done', message || `${op.label} complete`, 'success', 4000);
			},

			error: (message: string) => {
				if (op.state !== 'running') return;
				this.completeOperation(opId, 'error', message, 'error', 8000);
				console.error(`[Auto Notes] ${op.label}:`, message);
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

			el.createEl('div', { text: `Auto Notes: ${message}` });

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

	/** Show a one-shot informational notice (not tracked, dismissible) */
	info(message: string, duration = 4000): void {
		const notice = new Notice(`Auto Notes: ${message}`, duration);
		styleNotice(notice, 'info');
	}

	/** Show a one-shot success notice (dismissible) */
	success(message: string, duration = 4000): void {
		const notice = new Notice(`Auto Notes: ${message}`, duration);
		styleNotice(notice, 'success');
	}

	/** Show a one-shot error notice (dismissible, stays longer) */
	notifyError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		const redacted = message.replace(
			/(?:sk-|key-|dg-|anthropic-|Bearer\s+|Token\s+)[A-Za-z0-9_-]{8,}/g,
			'[REDACTED]'
		);
		const notice = new Notice(`Auto Notes: ${context} — ${redacted}`, 8000);
		styleNotice(notice, 'error');
		console.error(`[Auto Notes] ${context}:`, redacted);
	}

	private completeOperation(
		id: string,
		newState: TrackedOperation['state'],
		message: string,
		level: NoticeLevel,
		duration: number
	): void {
		const op = this.operations.get(id);
		if (!op) return;
		op.state = newState;
		stopEllipsis(op.ellipsisInterval);
		op.notice.hide();
		// Completion/error/cancel notices are normal dismissible toasts
		const notice = new Notice(`Auto Notes: ${message}`, duration);
		styleNotice(notice, level);
		this.operations.delete(id);
		this.updateStatusBar();
	}

	private updateStatusBar(): void {
		if (!this.statusBarEl) return;

		const running = [...this.operations.values()].filter(
			(op) => op.state === 'running'
		);

		if (running.length === 0) {
			this.statusBarEl.setText('Auto Notes');
		} else if (running.length === 1) {
			this.statusBarEl.setText(`Auto Notes: ${running[0].message}`);
		} else {
			this.statusBarEl.setText(`Auto Notes: ${running.length} tasks running`);
		}
	}
}
