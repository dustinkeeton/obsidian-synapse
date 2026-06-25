import { describe, it, expect, vi } from 'vitest';
import {
	foldPropertiesIn,
	applyPropertiesFold,
	foldActiveNoteProperties,
	METADATA_CONTAINER_SELECTOR,
	PROPERTIES_COLLAPSED_CLASS,
} from './properties-fold';

/**
 * A fake Properties panel that tracks its collapsed classes, mirroring the
 * `classList` surface the fold logic touches. `has()` lets tests assert state.
 */
function makePanel(collapsed = false) {
	const classes = new Set<string>(collapsed ? [PROPERTIES_COLLAPSED_CLASS] : []);
	return {
		classList: {
			contains: (c: string) => classes.has(c),
			add: vi.fn((c: string) => { classes.add(c); }),
		},
		has: (c: string) => classes.has(c),
	};
}

/** A fake view root whose querySelector returns `panel` for the panel selector. */
function makeRoot(panel: ReturnType<typeof makePanel> | null) {
	return {
		querySelector: vi.fn((sel: string) =>
			sel === METADATA_CONTAINER_SELECTOR ? panel : null,
		),
	};
}

describe('foldPropertiesIn', () => {
	it('collapses an expanded Properties panel and reports the change', () => {
		const panel = makePanel(false);
		expect(foldPropertiesIn(makeRoot(panel))).toBe(true);
		expect(panel.has(PROPERTIES_COLLAPSED_CLASS)).toBe(true);
	});

	it('is a no-op when the Properties panel is already collapsed', () => {
		const panel = makePanel(true);
		expect(foldPropertiesIn(makeRoot(panel))).toBe(false);
		// Guarded before add(): the native collapsed state is left untouched.
		expect(panel.classList.add).not.toHaveBeenCalled();
	});

	it('is a no-op when no Properties panel is present', () => {
		expect(foldPropertiesIn(makeRoot(null))).toBe(false);
	});

	it('is a no-op (no throw) when the root is null or undefined', () => {
		expect(foldPropertiesIn(null)).toBe(false);
		expect(foldPropertiesIn(undefined)).toBe(false);
	});

	it('is a no-op when the root cannot run querySelector', () => {
		expect(foldPropertiesIn({} as never)).toBe(false);
	});
});

describe('applyPropertiesFold', () => {
	it('folds via containerEl when enabled', () => {
		const panel = makePanel(false);
		expect(applyPropertiesFold({ containerEl: makeRoot(panel) }, true)).toBe(true);
		expect(panel.has(PROPERTIES_COLLAPSED_CLASS)).toBe(true);
	});

	it('falls back to contentEl when containerEl has no panel', () => {
		const panel = makePanel(false);
		const view = { containerEl: makeRoot(null), contentEl: makeRoot(panel) };
		expect(applyPropertiesFold(view, true)).toBe(true);
		expect(panel.has(PROPERTIES_COLLAPSED_CLASS)).toBe(true);
	});

	it('is a no-op when disabled, even with a foldable panel', () => {
		const panel = makePanel(false);
		expect(applyPropertiesFold({ containerEl: makeRoot(panel) }, false)).toBe(false);
		expect(panel.has(PROPERTIES_COLLAPSED_CLASS)).toBe(false);
	});

	it('is a no-op when the view is null or undefined', () => {
		expect(applyPropertiesFold(null, true)).toBe(false);
		expect(applyPropertiesFold(undefined, true)).toBe(false);
	});
});

describe('foldActiveNoteProperties', () => {
	it('folds the active markdown view when enabled', () => {
		const panel = makePanel(false);
		const view = { containerEl: makeRoot(panel) };
		const app = { workspace: { getActiveViewOfType: vi.fn().mockReturnValue(view) } };
		expect(foldActiveNoteProperties(app as never, true)).toBe(true);
		expect(panel.has(PROPERTIES_COLLAPSED_CLASS)).toBe(true);
	});

	it('is a no-op when disabled, without touching the workspace', () => {
		const getActiveViewOfType = vi.fn();
		const app = { workspace: { getActiveViewOfType } };
		expect(foldActiveNoteProperties(app as never, false)).toBe(false);
		expect(getActiveViewOfType).not.toHaveBeenCalled();
	});

	it('is a no-op when there is no active markdown view', () => {
		const app = { workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) } };
		expect(foldActiveNoteProperties(app as never, true)).toBe(false);
	});

	it('does not throw when the workspace API is unavailable', () => {
		expect(foldActiveNoteProperties({} as never, true)).toBe(false);
	});
});
