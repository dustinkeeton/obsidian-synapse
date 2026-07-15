import { App, Modal } from 'obsidian';
import { validateTimeRange } from '../shared';
import type { NotificationManager, TimeRange } from '../shared';
import { TimeRangeSlider } from './time-range-slider';

/** CSS class prefix. */
const CLS = 'synapse-time-range-modal';

/** What the user decided in the {@link TimeRangeModal}. */
export type TimeRangeChoice =
	/** Transcribe only the selected range. */
	| { kind: 'selection'; range: TimeRange }
	/** Transcribe the whole file. */
	| { kind: 'full' }
	/** Dismissed (Escape / click-away / ✕) — do nothing. */
	| { kind: 'cancelled' };

export interface TimeRangeModalOptions {
	/** Media title or filename to display. */
	title: string;
	/**
	 * Total media duration in seconds. When undefined (duration detection
	 * failed), the modal falls back to manual start/end time inputs.
	 */
	duration?: number;
}

/**
 * Modal asking the user what part of the media to transcribe — the follow-up
 * decision the transcribe flow blocks on, so it gets a first-class modal
 * (front and center, not a dismissible toast).
 *
 * With a known duration it shows the trim-bar {@link TimeRangeSlider}; with
 * an unknown duration it shows manual start/end inputs. Modeled on
 * ConfirmModal: a `resolved` flag plus the pending `resolve` so a dismiss
 * (Escape / click-away) settles exactly once — as `cancelled`, which callers
 * treat as "do nothing" rather than silently transcribing the whole file.
 */
export class TimeRangeModal extends Modal {
	private resolved = false;
	private resolve: (choice: TimeRangeChoice) => void = () => {};

	private selectedStart = 0;
	private selectedEnd: number;

	constructor(
		app: App,
		private readonly options: TimeRangeModalOptions,
		private readonly notifications: NotificationManager
	) {
		super(app);
		this.selectedEnd = options.duration ?? 0;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass(CLS);

		contentEl.createEl('h3', { text: 'Choose what to transcribe' });
		contentEl.createDiv({ cls: `${CLS}-media-title`, text: this.options.title });

		if (this.options.duration !== undefined) {
			this.renderSlider(contentEl, this.options.duration);
		} else {
			this.renderManualInputs(contentEl);
		}
	}

	onClose(): void {
		this.contentEl?.empty();
		// A dismiss that never hit a button means "do nothing".
		if (!this.resolved) {
			this.resolve({ kind: 'cancelled' });
		}
	}

	/** Open the modal and resolve to the user's choice. */
	openAndChoose(): Promise<TimeRangeChoice> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	/** Settle the pending promise once and close the modal. */
	private settle(choice: TimeRangeChoice): void {
		this.resolved = true;
		this.resolve(choice);
		this.close();
	}

	/** Known duration: trim-bar slider + live start/end labels. */
	private renderSlider(contentEl: HTMLElement, duration: number): void {
		new TimeRangeSlider(contentEl, {
			duration,
			onChange: (start, end) => {
				this.selectedStart = start;
				this.selectedEnd = end;
			},
		});

		this.renderButtons(contentEl, () => {
			// An untouched (full-range) selection is just the full file.
			if (this.selectedStart === 0 && this.selectedEnd === duration) {
				return { kind: 'full' };
			}
			return {
				kind: 'selection',
				range: { startSeconds: this.selectedStart, endSeconds: this.selectedEnd },
			};
		});
	}

	/** Unknown duration: manual start/end time inputs. */
	private renderManualInputs(contentEl: HTMLElement): void {
		contentEl.createDiv({
			cls: `${CLS}-desc`,
			text: 'Duration unknown — enter start and end times (HH:MM:SS or MM:SS).',
		});

		const inputRow = contentEl.createDiv({ cls: `${CLS}-inputs` });
		const startInput = inputRow.createEl('input', {
			attr: { type: 'text', placeholder: 'Start (00:00)', 'aria-label': 'Start time' },
			cls: `${CLS}-time-input`,
		});
		inputRow.createSpan({ text: ' – ' });
		const endInput = inputRow.createEl('input', {
			attr: { type: 'text', placeholder: 'End (00:00)', 'aria-label': 'End time' },
			cls: `${CLS}-time-input`,
		});

		this.renderButtons(contentEl, () => {
			if (!startInput.value || !endInput.value) {
				this.notifications.info('Both start and end times are required');
				return null;
			}
			try {
				return { kind: 'selection', range: validateTimeRange(startInput.value, endInput.value) };
			} catch (err) {
				this.notifications.info(err instanceof Error ? err.message : String(err));
				return null;
			}
		});
	}

	/**
	 * Shared button row: quiet "Full file", primary "Transcribe selection".
	 * `selectionChoice` computes the primary button's outcome — returning null
	 * keeps the modal open (validation failed).
	 */
	private renderButtons(
		contentEl: HTMLElement,
		selectionChoice: () => TimeRangeChoice | null
	): void {
		// Raw createEl DOM (not Setting.addButton) so the row stays exercisable
		// under the test mock; the native modal-button-container class keeps
		// Obsidian's standard modal button styling.
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });

		const fullBtn = buttons.createEl('button', { text: 'Full file' });
		fullBtn.addEventListener('click', () => this.settle({ kind: 'full' }));

		const selectionBtn = buttons.createEl('button', {
			text: 'Transcribe selection',
			cls: 'mod-cta',
		});
		selectionBtn.addEventListener('click', () => {
			const choice = selectionChoice();
			if (choice) this.settle(choice);
		});
	}
}
