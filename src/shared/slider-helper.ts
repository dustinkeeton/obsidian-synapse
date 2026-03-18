import { Setting, SliderComponent } from 'obsidian';

/**
 * Configuration for an enhanced slider with labels and optional tick marks.
 */
export interface EnhancedSliderOptions {
	/** Minimum value for the slider range. */
	min: number;
	/** Maximum value for the slider range. */
	max: number;
	/** Step increment between values. */
	step: number;
	/** Current value to display. */
	value: number;
	/** Callback when the slider value changes. */
	onChange: (value: number) => Promise<void>;
	/**
	 * Whether to render tick marks along the slider track.
	 * Recommended for sliders with a small number of discrete steps (e.g., 5-20 ticks).
	 * Defaults to false.
	 */
	showTicks?: boolean;
	/**
	 * Format function for the current value label.
	 * Defaults to rounding to 2 decimal places and trimming trailing zeros.
	 */
	formatValue?: (value: number) => string;
}

/**
 * Default formatter that displays values with up to 2 decimal places,
 * trimming trailing zeros.
 */
export function defaultFormatValue(value: number): string {
	return parseFloat(value.toFixed(2)).toString();
}

/**
 * Adds an enhanced slider to an Obsidian Setting with min/max labels,
 * a live current-value display, and optional tick marks.
 *
 * This wraps Obsidian's native `addSlider` with extra DOM elements since
 * the built-in SliderComponent only supports `setDynamicTooltip()`.
 *
 * @param setting - The Obsidian Setting instance to augment.
 * @param options - Configuration for the slider.
 * @returns The Setting instance (for chaining).
 */
export function addEnhancedSlider(
	setting: Setting,
	options: EnhancedSliderOptions,
): Setting {
	const {
		min,
		max,
		step,
		value,
		onChange,
		showTicks = false,
		formatValue = defaultFormatValue,
	} = options;

	setting.addSlider((slider: SliderComponent) => {
		slider.setLimits(min, max, step).setValue(value).setDynamicTooltip();

		// Build enhanced wrapper inside the Setting's controlEl.
		// The slider's sliderEl lives inside controlEl; we wrap it
		// with additional label elements.
		const sliderEl = slider.sliderEl;
		const controlEl = setting.controlEl;

		// Create a wrapper div and move the slider input into it
		const wrapper = createDiv({ cls: 'synapse-slider-wrapper' });
		controlEl.insertBefore(wrapper, sliderEl);
		wrapper.appendChild(sliderEl);

		// Current value badge (above the slider track)
		const currentValueEl = wrapper.createDiv({
			cls: 'synapse-slider-current-value',
			text: formatValue(value),
		});

		// Min/max label row (below the slider track)
		const labelsRow = wrapper.createDiv({ cls: 'synapse-slider-labels' });
		labelsRow.createSpan({
			cls: 'synapse-slider-label-min',
			text: formatValue(min),
		});
		labelsRow.createSpan({
			cls: 'synapse-slider-label-max',
			text: formatValue(max),
		});

		// Optional tick marks
		if (showTicks) {
			const tickCount = Math.round((max - min) / step);
			// Only render ticks when there are 2-20 stops (avoids visual noise)
			if (tickCount >= 2 && tickCount <= 20) {
				const tickContainer = wrapper.createDiv({
					cls: 'synapse-slider-ticks',
				});
				for (let i = 0; i <= tickCount; i++) {
					tickContainer.createDiv({ cls: 'synapse-slider-tick' });
				}
			}
		}

		// Single onChange handler: update the label AND invoke the caller's callback
		slider.onChange(async (newValue: number) => {
			currentValueEl.textContent = formatValue(newValue);
			await onChange(newValue);
		});

		return slider;
	});

	return setting;
}
