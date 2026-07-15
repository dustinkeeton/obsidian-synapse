import { Notice } from 'obsidian';
import type { TimeRange } from '../shared';
import { TimeRangeSlider } from './time-range-slider';

/** CSS class prefix */
const CLS = 'synapse-notice';

/**
 * Options for the time-range confirmation toast.
 */
export interface TimeRangeToastOptions {
	/** Media title or filename to display. */
	title: string;
	/** Total media duration in seconds. */
	duration: number;
}

/**
 * Get the underlying DOM element from a Notice (Obsidian internal).
 */
function getNoticeEl(notice: Notice): HTMLElement {
	return (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
}

/**
 * Prevent Obsidian's default click-to-dismiss on a Notice.
 * Blocks clicks on the notice background but allows clicks on
 * interactive elements (buttons, inputs) to pass through normally.
 */
function preventDismiss(notice: Notice): void {
	const el = getNoticeEl(notice);
	if (!el) return;
	el.classList.add(`${CLS}--no-dismiss`);
	el.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		if (target.closest('button') || target.closest('input')) return;
		e.preventDefault();
		e.stopPropagation();
	}, true);
}

/**
 * Show a confirmation toast with a dual-handle time-range slider.
 *
 * The toast presents:
 * - The media title
 * - A TimeRangeSlider spanning the full duration
 * - "Transcribe Selection" and "Full File" buttons
 *
 * Returns a Promise that resolves to:
 * - A TimeRange if the user selects a sub-range and clicks "Transcribe Selection"
 * - undefined if the user clicks "Full File" or closes the toast
 */
export function showTimeRangeToast(
	options: TimeRangeToastOptions
): Promise<TimeRange | undefined> {
	return new Promise((resolve) => {
		let resolved = false;

		const notice = new Notice('', 0);
		const el = getNoticeEl(notice);
		if (!el) {
			resolve(undefined);
			return;
		}

		// Style as an info-level notice
		el.classList.add(CLS, `${CLS}--info`, `${CLS}--time-range`);
		preventDismiss(notice);
		el.empty();

		// Source eyebrow + media title (title clamps to two lines in CSS)
		el.createDiv({
			cls: `${CLS}-time-range-eyebrow`,
			text: 'Synapse · Transcribe',
		});
		el.createDiv({
			cls: `${CLS}-time-range-title`,
			text: options.title,
		});

		// Slider container
		const sliderContainer = el.createDiv({ cls: `${CLS}-time-range-slider` });

		let selectedStart = 0;
		let selectedEnd = options.duration;

		new TimeRangeSlider(sliderContainer, {
			duration: options.duration,
			onChange: (start, end) => {
				selectedStart = start;
				selectedEnd = end;
			},
		});

		// Buttons row — quiet action first, primary action on the right
		const actions = el.createDiv({ cls: `${CLS}-actions` });

		const fullBtn = actions.createEl('button', {
			text: 'Full file',
			cls: 'mod-cancel',
		});
		fullBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (resolved) return;
			resolved = true;
			notice.hide();
			resolve(undefined);
		});

		const selectionBtn = actions.createEl('button', {
			text: 'Transcribe selection',
			cls: 'mod-cta',
		});
		selectionBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (resolved) return;
			resolved = true;
			notice.hide();
			// Only return a range if the user actually adjusted the selection
			// (not the full file)
			if (selectedStart === 0 && selectedEnd === options.duration) {
				resolve(undefined);
			} else {
				resolve({ startSeconds: selectedStart, endSeconds: selectedEnd });
			}
		});
	});
}
