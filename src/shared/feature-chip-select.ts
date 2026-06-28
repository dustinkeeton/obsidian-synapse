import type { FeatureId } from './exclusions';

/**
 * Option value used by the add-dropdown to mean "block every feature" — maps to
 * the {@link FeatureChipSelectOptions.value} `'all'` shorthand. Underscores keep
 * it disjoint from every {@link FeatureId} (which are kebab-case words).
 */
const ALL_SENTINEL = '__all__';

/** Configuration for {@link renderFeatureChipSelect}. */
export interface FeatureChipSelectOptions {
	/**
	 * Current scope: the literal `'all'` (block every feature), or an explicit
	 * list of {@link FeatureId}s. An empty list is legal and renders as the
	 * "rule inactive" hint (it blocks nothing — see `src/shared/exclusions.ts`).
	 */
	value: 'all' | FeatureId[];
	/** Display label per feature (the caller's `FEATURE_LABELS`). */
	labels: Record<FeatureId, string>;
	/** Stable render order for chips and dropdown options (`FEATURE_ORDER`). */
	order: FeatureId[];
	/**
	 * Invoked with the new scope after every edit (add/remove). The caller
	 * persists it; the component has already redrawn `container`, so no caller
	 * re-render is needed.
	 */
	onChange: (next: 'all' | FeatureId[]) => void;
}

/**
 * Render a compact chip multi-select for an exclusion rule's feature scope into
 * `container` (#328). Selected features show as removable chips; an inline
 * `<select class="dropdown">` adds more. The control fully owns the
 * `'all' | FeatureId[]` value, including the `'all'` shorthand and the empty-list
 * = "rule inactive" case — the data model is unchanged.
 *
 * It keeps its own `current` value and **self-redraws `container`** on every edit
 * (it calls `container.empty()` first), so the caller's `onChange` only needs to
 * persist — it must NOT also trigger a full settings re-render (that would wipe a
 * sibling text input mid-edit; see the "Add a pattern" row in `settings-tab.ts`).
 *
 * Mirrors the DOM-wrapper style of {@link addCollapsibleSection} /
 * {@link addEnhancedSlider}: it builds its own `synapse-*` structure inside the
 * container the caller provides.
 *
 * @param container - Element to render into (emptied and rebuilt on each edit).
 * @param options - {@link FeatureChipSelectOptions}.
 */
export function renderFeatureChipSelect(
	container: HTMLElement,
	options: FeatureChipSelectOptions,
): void {
	const { labels, order, onChange } = options;
	let current: 'all' | FeatureId[] = options.value;

	/** Commit a new scope: update state, notify the caller, redraw. */
	function apply(next: 'all' | FeatureId[]): void {
		current = next;
		onChange(next);
		render();
	}

	function renderChip(parent: HTMLElement, label: string, onRemove: () => void): void {
		const chip = parent.createSpan({ cls: 'synapse-chip' });
		chip.createSpan({ cls: 'synapse-chip-label', text: label });
		const remove = chip.createEl('button', {
			cls: 'synapse-chip-remove',
			attr: { type: 'button', 'aria-label': `Remove ${label}` },
		});
		// Glyph is decorative; the accessible name comes from the button's aria-label.
		remove.createSpan({ text: '✕' }).setAttribute('aria-hidden', 'true');
		remove.addEventListener('click', () => onRemove());
	}

	function renderAddDropdown(parent: HTMLElement): void {
		const select = parent.createEl('select', {
			cls: ['dropdown', 'synapse-chip-add'],
			attr: { 'aria-label': 'Add feature to exclusion scope' },
		});

		const placeholder = select.createEl('option', { text: '+ add feature…' });
		placeholder.value = '';
		placeholder.disabled = true;
		placeholder.selected = true;

		if (current === 'all') {
			// Already blocking everything — offer each feature to NARROW to it.
			for (const feature of order) {
				select.createEl('option', { text: labels[feature] }).value = feature;
			}
		} else {
			// Offer "All features" plus every not-yet-selected feature.
			select.createEl('option', { text: 'All features' }).value = ALL_SENTINEL;
			for (const feature of order) {
				if (!current.includes(feature)) {
					select.createEl('option', { text: labels[feature] }).value = feature;
				}
			}
		}

		select.value = '';
		select.addEventListener('change', () => {
			const picked = select.value;
			if (!picked) return; // placeholder
			if (picked === ALL_SENTINEL) {
				apply('all');
				return;
			}
			const feature = picked as FeatureId;
			if (current === 'all') {
				// Narrowing from "all" starts a fresh list with just this feature.
				apply([feature]);
				return;
			}
			const next = new Set(current);
			next.add(feature);
			apply(order.filter((f) => next.has(f))); // re-emit in stable order
		});
	}

	function render(): void {
		container.empty();

		const chipsContainer = container.createDiv({ cls: 'synapse-chips-container' });
		if (current === 'all') {
			renderChip(chipsContainer, 'All features', () => apply([]));
		} else if (current.length === 0) {
			chipsContainer.createSpan({
				cls: 'synapse-exclusion-chips-empty',
				text: 'No features — rule inactive',
			});
		} else {
			const scoped = current;
			for (const feature of order) {
				if (scoped.includes(feature)) {
					renderChip(chipsContainer, labels[feature], () =>
						apply(scoped.filter((f) => f !== feature)),
					);
				}
			}
		}

		renderAddDropdown(container);
	}

	render();
}
