import { Setting } from 'obsidian';
import type { ToggleComponent } from 'obsidian';

/**
 * Configuration for a collapsible settings accordion section.
 */
export interface CollapsibleSectionOptions {
	/** Heading text shown in the accordion header. */
	title: string;
	/**
	 * Initial collapsed state. `true` renders the body hidden, `false` expanded.
	 * Defaults to `false` (expanded).
	 */
	collapsed?: boolean;
	/**
	 * When provided, an enable/disable toggle is rendered in the header.
	 * This is the toggle's initial value.
	 *
	 * Omit (leave `undefined`) for always-needed config sections that should
	 * be collapsible but have no enable toggle (e.g. AI Configuration).
	 */
	enabled?: boolean;
	/**
	 * Invoked when the header toggle changes. The accordion auto-expands when
	 * toggled on and auto-collapses when toggled off *before* this fires, then
	 * reports the resulting collapse state via {@link onCollapseChange}.
	 * Only used when `enabled` is provided.
	 */
	onToggle?: (value: boolean) => void | Promise<void>;
	/**
	 * Invoked whenever the collapsed state changes — from a manual header click,
	 * keyboard activation, or an auto collapse/expand driven by the toggle.
	 * Use this to persist the per-section collapse state.
	 */
	onCollapseChange?: (collapsed: boolean) => void | Promise<void>;
	/**
	 * Optional aria-label for the header toggle (falls back to `title`).
	 */
	toggleAriaLabel?: string;
}

/**
 * Handle returned by {@link addCollapsibleSection}. Render a feature's
 * sub-settings into {@link bodyEl}; use {@link setCollapsed} to drive the
 * accordion programmatically.
 */
export interface CollapsibleSection {
	/** The outermost section wrapper (`.synapse-accordion`). */
	sectionEl: HTMLElement;
	/** The clickable/focusable header row (`.synapse-accordion-header`). */
	headerEl: HTMLElement;
	/**
	 * The collapsible body container (`.synapse-accordion-body`). Render all of
	 * the feature's sub-settings into this element.
	 */
	bodyEl: HTMLElement;
	/** The header toggle component, if one was rendered (`enabled` provided). */
	toggle?: ToggleComponent;
	/** Whether the section is currently collapsed. */
	isCollapsed: () => boolean;
	/**
	 * Programmatically collapse or expand the section. Pass `silent: true` to
	 * suppress the {@link CollapsibleSectionOptions.onCollapseChange} callback
	 * (used for the initial render so it does not persist a no-op).
	 */
	setCollapsed: (collapsed: boolean, silent?: boolean) => void;
}

/**
 * Adds a collapsible "accordion" section to a settings container.
 *
 * The section renders a header row (chevron + title + optional enable toggle)
 * above a collapsible body. Clicking the header (or pressing Enter/Space while
 * it is focused) folds/unfolds the body. When an enable toggle is present,
 * turning it off auto-collapses the body and turning it on auto-expands it,
 * while the header stays visible so the feature can be re-enabled.
 *
 * Collapse/expand animates via CSS (`max-height`/`opacity`); environments
 * without that CSS degrade to instant show/hide because the collapsed class
 * also sets `display` semantics through `aria-hidden` + CSS.
 *
 * Mirrors the DOM-wrapper style of {@link addEnhancedSlider}: it builds its own
 * `createDiv({cls: 'synapse-*'})` structure and returns a handle for the caller
 * to populate and control.
 *
 * @param containerEl - The container to append the section to.
 * @param options - Section configuration.
 * @returns A {@link CollapsibleSection} handle (render sub-settings into `bodyEl`).
 */
export function addCollapsibleSection(
	containerEl: HTMLElement,
	options: CollapsibleSectionOptions,
): CollapsibleSection {
	const {
		title,
		collapsed = false,
		enabled,
		onToggle,
		onCollapseChange,
		toggleAriaLabel,
	} = options;

	const hasToggle = enabled !== undefined;

	const sectionEl = containerEl.createDiv({ cls: 'synapse-accordion' });

	// ── Header (chevron + title + optional toggle) ──
	const headerEl = sectionEl.createDiv({ cls: 'synapse-accordion-header' });
	headerEl.setAttribute('role', 'button');
	headerEl.setAttribute('tabindex', '0');

	const chevronEl = headerEl.createSpan({ cls: 'synapse-accordion-chevron' });
	// Unicode right-pointing triangle; CSS rotates it to point down when open.
	chevronEl.setText('▶');
	chevronEl.setAttribute('aria-hidden', 'true');

	headerEl.createSpan({ cls: 'synapse-accordion-title', text: title });

	// Spacer pushes the toggle to the trailing edge of the header row.
	const controlEl = headerEl.createDiv({ cls: 'synapse-accordion-control' });

	let toggle: ToggleComponent | undefined;
	if (hasToggle) {
		// Render the enable toggle inside the header using a borderless Setting
		// so we reuse Obsidian's native ToggleComponent and styling.
		const toggleSetting = new Setting(controlEl);
		toggleSetting.settingEl.addClass('synapse-accordion-toggle-setting');
		toggleSetting.addToggle((t) => {
			toggle = t;
			t.setValue(enabled as boolean);
			t.setTooltip(toggleAriaLabel ?? title);
			t.onChange(async (value) => {
				// Toggle drives collapse: ON expands, OFF collapses. Do this
				// first so the persisted collapse state reflects the new value.
				setCollapsed(!value);
				await onToggle?.(value);
			});
		});
		// A click on the toggle must not also bubble to the header's fold handler.
		controlEl.addEventListener('click', (evt) => evt.stopPropagation());
	}

	// ── Body (collapsible) ──
	const bodyEl = sectionEl.createDiv({ cls: 'synapse-accordion-body' });

	let isCollapsed = collapsed;

	function applyCollapsedClass(): void {
		if (isCollapsed) {
			sectionEl.addClass('is-collapsed');
		} else {
			sectionEl.removeClass('is-collapsed');
		}
		headerEl.setAttribute('aria-expanded', String(!isCollapsed));
		bodyEl.setAttribute('aria-hidden', String(isCollapsed));
	}

	function setCollapsed(next: boolean, silent = false): void {
		if (next === isCollapsed) {
			// Still re-apply attributes/classes on first render even if unchanged.
			applyCollapsedClass();
			return;
		}
		isCollapsed = next;
		applyCollapsedClass();
		if (!silent) {
			void onCollapseChange?.(isCollapsed);
		}
	}

	function toggleCollapsed(): void {
		setCollapsed(!isCollapsed);
	}

	headerEl.addEventListener('click', () => toggleCollapsed());
	headerEl.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' || evt.key === ' ' || evt.key === 'Spacebar') {
			evt.preventDefault();
			toggleCollapsed();
		}
	});

	// Initial paint without firing onCollapseChange (no-op persistence).
	applyCollapsedClass();

	return {
		sectionEl,
		headerEl,
		bodyEl,
		toggle,
		isCollapsed: () => isCollapsed,
		setCollapsed,
	};
}
