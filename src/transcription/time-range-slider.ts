import { formatTimestamp } from './duration-detector';

/** CSS class prefix for the time-range slider */
const CLS = 'synapse-time-range';

/**
 * Options for creating a TimeRangeSlider.
 */
export interface TimeRangeSliderOptions {
	/** Total media duration in seconds. */
	duration: number;
	/** Initial start position in seconds. Defaults to 0. */
	initialStart?: number;
	/** Initial end position in seconds. Defaults to duration. */
	initialEnd?: number;
	/** Callback fired whenever the selected range changes. */
	onChange?: (start: number, end: number) => void;
}

/**
 * A dual-handle range slider for selecting a time range within a known duration.
 *
 * Uses two native HTML range inputs overlaid on a shared track. The track's
 * selected region is visually highlighted. Timestamp labels update live as
 * handles move.
 *
 * This is a pure DOM component with no Obsidian dependencies beyond the
 * Obsidian-provided `createEl`/`createDiv` helpers on HTMLElement.
 */
export class TimeRangeSlider {
	/** The root container element. */
	readonly containerEl: HTMLElement;

	private startInput: HTMLInputElement;
	private endInput: HTMLInputElement;
	private trackHighlight: HTMLElement;
	private startLabel: HTMLElement;
	private endLabel: HTMLElement;

	private _start: number;
	private _end: number;
	private readonly duration: number;
	private readonly onChange?: (start: number, end: number) => void;

	constructor(parentEl: HTMLElement, options: TimeRangeSliderOptions) {
		this.duration = options.duration;
		this._start = options.initialStart ?? 0;
		this._end = options.initialEnd ?? options.duration;
		this.onChange = options.onChange;

		// Step size: 1 second for media under 10 minutes, 5 seconds otherwise
		const step = this.duration <= 600 ? 1 : 5;

		// Root container
		this.containerEl = parentEl.createDiv({ cls: `${CLS}-container` });

		// Track wrapper for overlapping range inputs
		const trackWrapper = this.containerEl.createDiv({ cls: `${CLS}-track-wrapper` });

		// Highlighted region on the track
		this.trackHighlight = trackWrapper.createDiv({ cls: `${CLS}-track-highlight` });

		// Start handle (lower range input)
		this.startInput = trackWrapper.createEl('input', {
			cls: `${CLS}-input ${CLS}-input-start`,
			attr: {
				type: 'range',
				min: '0',
				max: String(this.duration),
				step: String(step),
				value: String(this._start),
				'aria-label': 'Start time',
			},
		});

		// End handle (upper range input)
		this.endInput = trackWrapper.createEl('input', {
			cls: `${CLS}-input ${CLS}-input-end`,
			attr: {
				type: 'range',
				min: '0',
				max: String(this.duration),
				step: String(step),
				value: String(this._end),
				'aria-label': 'End time',
			},
		});

		// Labels row: live start/end timestamps under their handles. No extra
		// readout or total-duration label — the endpoints already say it all.
		const labelsRow = this.containerEl.createDiv({ cls: `${CLS}-labels` });
		this.startLabel = labelsRow.createSpan({ cls: `${CLS}-label-start` });
		this.endLabel = labelsRow.createSpan({ cls: `${CLS}-label-end` });

		// Wire up event handlers
		this.startInput.addEventListener('input', () => this.onStartChange());
		this.endInput.addEventListener('input', () => this.onEndChange());

		// Initial render
		this.updateDisplay();
	}

	/** Get the current start position in seconds. */
	get start(): number {
		return this._start;
	}

	/** Get the current end position in seconds. */
	get end(): number {
		return this._end;
	}

	private onStartChange(): void {
		let val = parseInt(this.startInput.value, 10);
		// Prevent start from crossing past end
		if (val >= this._end) {
			val = Math.max(0, this._end - 1);
			this.startInput.value = String(val);
		}
		this._start = val;
		this.updateDisplay();
		this.onChange?.(this._start, this._end);
	}

	private onEndChange(): void {
		let val = parseInt(this.endInput.value, 10);
		// Prevent end from crossing before start
		if (val <= this._start) {
			val = Math.min(this.duration, this._start + 1);
			this.endInput.value = String(val);
		}
		this._end = val;
		this.updateDisplay();
		this.onChange?.(this._start, this._end);
	}

	private updateDisplay(): void {
		// Update timestamp labels
		this.startLabel.textContent = formatTimestamp(this._start);
		this.endLabel.textContent = formatTimestamp(this._end);

		// Update track highlight position (percentage-based)
		const startPct = (this._start / this.duration) * 100;
		const endPct = (this._end / this.duration) * 100;
		this.trackHighlight.style.left = `${startPct}%`;
		this.trackHighlight.style.width = `${endPct - startPct}%`;
	}
}
