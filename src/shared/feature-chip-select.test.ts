import { describe, it, expect, vi } from 'vitest';
import { createEl } from '../__mocks__/obsidian';
import { renderFeatureChipSelect } from './feature-chip-select';
import { ALL_FEATURE_IDS } from './exclusions';
import type { FeatureId } from './exclusions';

// Mirror of FEATURE_LABELS in settings-tab.ts; ORDER is the canonical feature set
// so these tests track any future change to the union.
const LABELS: Record<FeatureId, string> = {
	elaboration: 'Elaboration',
	enrichment: 'Enrichment',
	summarize: 'Summarize',
	tidy: 'Tidy',
	organize: 'Organize',
	'deep-dive': 'Deep dive',
	audio: 'Audio transcription',
	video: 'Video transcription',
	title: 'Title',
	image: 'Image OCR',
	rem: 'REM (link discovery)',
	intake: 'Intake watcher',
};
const ORDER = Object.keys(ALL_FEATURE_IDS) as FeatureId[];

// ── Stub-tree introspection helpers ──
function walk(el: any, out: any[] = []): any[] {
	for (const c of el?.children ?? []) {
		out.push(c);
		walk(c, out);
	}
	return out;
}
function byClass(root: any, cls: string): any[] {
	return walk(root).filter((e) => e.classList?.contains(cls));
}
function byTag(root: any, tag: string): any[] {
	return walk(root).filter((e) => e.tagName === tag);
}
function chipLabels(root: any): string[] {
	return byClass(root, 'synapse-chip-label').map((e) => e.textContent);
}
function selectEl(root: any): any {
	return byTag(root, 'SELECT')[0];
}
function optionValues(root: any): string[] {
	return byTag(root, 'OPTION').map((e) => e.value);
}
function optionTexts(root: any): string[] {
	return byTag(root, 'OPTION').map((e) => e.textContent);
}
function removeButton(root: any, ariaLabel: string): any {
	return byClass(root, 'synapse-chip-remove').find(
		(b) => b.getAttribute('aria-label') === ariaLabel,
	);
}

function render(value: 'all' | FeatureId[]) {
	const container = createEl();
	const onChange = vi.fn();
	renderFeatureChipSelect(container, { value, labels: LABELS, order: ORDER, onChange });
	return { container, onChange };
}

describe('renderFeatureChipSelect — chip rendering', () => {
	it("shows a single 'All features' chip for 'all'", () => {
		const { container } = render('all');
		expect(chipLabels(container)).toEqual(['All features']);
		expect(byClass(container, 'synapse-exclusion-chips-empty')).toHaveLength(0);
	});

	it('shows one chip per feature, ordered by FEATURE_ORDER (not input order)', () => {
		const { container } = render(['organize', 'summarize']);
		expect(chipLabels(container)).toEqual(['Summarize', 'Organize']);
	});

	it('shows the inactive hint (and no chips) for an empty list', () => {
		const { container } = render([]);
		expect(chipLabels(container)).toEqual([]);
		const hint = byClass(container, 'synapse-exclusion-chips-empty');
		expect(hint).toHaveLength(1);
		expect(hint[0].textContent).toBe('No features — rule inactive');
	});

	it('does not call onChange on the initial render', () => {
		const { onChange } = render(['summarize']);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe('renderFeatureChipSelect — add dropdown options', () => {
	it("offers 'All features' + every unselected feature when scoped", () => {
		const { container } = render(['summarize']);
		const values = optionValues(container);
		expect(values[0]).toBe(''); // placeholder
		expect(values).toContain('__all__');
		expect(values).not.toContain('summarize'); // already selected
		expect(values).toContain('organize');
		// placeholder + All + (12 - 1 selected) = 13
		expect(values).toHaveLength(1 + 1 + (ORDER.length - 1));
	});

	it("offers every feature (to narrow) and no 'All features' when value is 'all'", () => {
		const { container } = render('all');
		const values = optionValues(container);
		expect(values).not.toContain('__all__');
		for (const f of ORDER) expect(values).toContain(f);
		expect(values).toHaveLength(1 + ORDER.length); // placeholder + 12
	});

	it('renders a disabled placeholder as the first option', () => {
		const { container } = render([]);
		const placeholder = byTag(container, 'OPTION')[0];
		expect(placeholder.textContent).toBe('+ add feature…');
		expect(placeholder.value).toBe('');
		expect(placeholder.disabled).toBe(true);
		// An empty list still exposes the dropdown so the user can recover.
		expect(selectEl(container)).toBeDefined();
		expect(optionTexts(container)).toContain('All features');
	});
});

describe('renderFeatureChipSelect — adding via the dropdown', () => {
	function pick(container: any, value: string): void {
		const select = selectEl(container);
		select.value = value;
		select.dispatchEvent({ type: 'change' });
	}

	it('appends a feature and re-emits the list in FEATURE_ORDER', () => {
		const { container, onChange } = render(['organize']);
		pick(container, 'summarize');
		expect(onChange).toHaveBeenCalledWith(['summarize', 'organize']);
		expect(chipLabels(container)).toEqual(['Summarize', 'Organize']);
	});

	it("maps the 'All features' option to the 'all' shorthand", () => {
		const { container, onChange } = render(['summarize']);
		pick(container, '__all__');
		expect(onChange).toHaveBeenCalledWith('all');
		expect(chipLabels(container)).toEqual(['All features']);
	});

	it("narrows from 'all' to a single-feature list", () => {
		const { container, onChange } = render('all');
		pick(container, 'tidy');
		expect(onChange).toHaveBeenCalledWith(['tidy']);
		expect(chipLabels(container)).toEqual(['Tidy']);
	});

	it('ignores a change back to the placeholder', () => {
		const { container, onChange } = render(['summarize']);
		pick(container, '');
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe('renderFeatureChipSelect — removing via chips', () => {
	function clickRemove(container: any, ariaLabel: string): void {
		removeButton(container, ariaLabel).dispatchEvent({ type: 'click' });
	}

	it("removing the 'All features' chip drops to the inactive empty list", () => {
		const { container, onChange } = render('all');
		clickRemove(container, 'Remove All features');
		expect(onChange).toHaveBeenCalledWith([]);
		expect(chipLabels(container)).toEqual([]);
		expect(byClass(container, 'synapse-exclusion-chips-empty')).toHaveLength(1);
	});

	it('removing one feature keeps the rest', () => {
		const { container, onChange } = render(['summarize', 'organize', 'tidy']);
		clickRemove(container, 'Remove Tidy');
		expect(onChange).toHaveBeenCalledWith(['summarize', 'organize']);
		expect(chipLabels(container)).toEqual(['Summarize', 'Organize']);
	});

	it('removing the last feature drops to the inactive empty list', () => {
		const { container, onChange } = render(['summarize']);
		clickRemove(container, 'Remove Summarize');
		expect(onChange).toHaveBeenCalledWith([]);
		expect(byClass(container, 'synapse-exclusion-chips-empty')).toHaveLength(1);
	});
});

describe('renderFeatureChipSelect — accessibility', () => {
	it('labels each remove button and the add dropdown', () => {
		const { container } = render(['summarize']);
		expect(removeButton(container, 'Remove Summarize')).toBeDefined();
		expect(selectEl(container).getAttribute('aria-label')).toBe(
			'Add feature to exclusion scope',
		);
	});

	it('marks the chip remove glyph aria-hidden', () => {
		const { container } = render(['summarize']);
		const glyphs = walk(container).filter((e) => e.textContent === '✕');
		expect(glyphs.length).toBeGreaterThan(0);
		expect(glyphs[0].getAttribute('aria-hidden')).toBe('true');
	});
});
