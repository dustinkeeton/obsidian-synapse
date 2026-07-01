import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEl, ToggleComponent, type StubEl } from '../__mocks__/obsidian';
import { addCollapsibleSection } from './collapsible-section';

/**
 * Dispatch a synthetic event on a stub element. The stub's `dispatchEvent`
 * accepts a plain `{ type, ... }` payload rather than a real-DOM `Event`.
 */
function fire(el: StubEl, evt: Record<string, unknown> & { type: string }): void {
	el.dispatchEvent(evt);
}

/** Recursively find the first descendant element whose class set contains `cls`. */
function findByClass(root: HTMLElement, cls: string): HTMLElement | undefined {
	for (const child of root.children as unknown as StubEl[]) {
		if (child.hasClass(cls)) return child;
		const nested = findByClass(child, cls);
		if (nested) return nested;
	}
	return undefined;
}

describe('addCollapsibleSection', () => {
	let container: StubEl;

	beforeEach(() => {
		container = createEl();
	});

	describe('structure', () => {
		it('renders a header and a body into the container', () => {
			const section = addCollapsibleSection(container, { title: 'Audio' });

			expect(section.headerEl.hasClass('synapse-accordion-header')).toBe(true);
			expect(section.bodyEl.hasClass('synapse-accordion-body')).toBe(true);
			expect(findByClass(container, 'synapse-accordion')).toBe(section.sectionEl);
		});

		it('renders the title text and a chevron in the header', () => {
			const section = addCollapsibleSection(container, { title: 'Note Tidy' });

			const title = findByClass(section.headerEl, 'synapse-accordion-title');
			const chevron = findByClass(section.headerEl, 'synapse-accordion-chevron');
			expect(title?.textContent).toBe('Note Tidy');
			expect(chevron).toBeDefined();
		});

		it('makes the header keyboard-focusable with a button role', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			expect(section.headerEl.getAttribute('role')).toBe('button');
			expect(section.headerEl.getAttribute('tabindex')).toBe('0');
		});

		it('does not render a toggle when enabled is undefined', () => {
			const section = addCollapsibleSection(container, { title: 'AI Config' });
			expect(section.toggle).toBeUndefined();
		});

		it('renders a header toggle when enabled is provided', () => {
			const section = addCollapsibleSection(container, {
				title: 'Audio',
				enabled: true,
			});
			expect(section.toggle).toBeDefined();
			expect(section.toggle?.getValue()).toBe(true);
		});
	});

	describe('initial collapsed state', () => {
		it('starts expanded by default', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			expect(section.isCollapsed()).toBe(false);
			expect(section.sectionEl.hasClass('is-collapsed')).toBe(false);
			expect(section.headerEl.getAttribute('aria-expanded')).toBe('true');
			expect(section.bodyEl.getAttribute('aria-hidden')).toBe('false');
		});

		it('starts collapsed when collapsed: true', () => {
			const section = addCollapsibleSection(container, {
				title: 'X',
				collapsed: true,
			});
			expect(section.isCollapsed()).toBe(true);
			expect(section.sectionEl.hasClass('is-collapsed')).toBe(true);
			expect(section.headerEl.getAttribute('aria-expanded')).toBe('false');
			expect(section.bodyEl.getAttribute('aria-hidden')).toBe('true');
		});

		it('does not fire onCollapseChange during initial render', () => {
			const onCollapseChange = vi.fn();
			addCollapsibleSection(container, {
				title: 'X',
				collapsed: true,
				onCollapseChange,
			});
			expect(onCollapseChange).not.toHaveBeenCalled();
		});
	});

	describe('manual header toggle', () => {
		it('collapses an expanded section on header click', () => {
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'X',
				onCollapseChange,
			});

			fire(section.headerEl, { type: 'click' });

			expect(section.isCollapsed()).toBe(true);
			expect(section.sectionEl.hasClass('is-collapsed')).toBe(true);
			expect(onCollapseChange).toHaveBeenCalledWith(true);
		});

		it('expands a collapsed section on header click', () => {
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'X',
				collapsed: true,
				onCollapseChange,
			});

			fire(section.headerEl, { type: 'click' });

			expect(section.isCollapsed()).toBe(false);
			expect(onCollapseChange).toHaveBeenCalledWith(false);
		});

		it('toggles via Enter key and prevents default', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			const preventDefault = vi.fn();

			fire(section.headerEl, { type: 'keydown', key: 'Enter', preventDefault });

			expect(preventDefault).toHaveBeenCalled();
			expect(section.isCollapsed()).toBe(true);
		});

		it('toggles via Space key', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			fire(section.headerEl, {
				type: 'keydown',
				key: ' ',
				preventDefault: vi.fn(),
			});
			expect(section.isCollapsed()).toBe(true);
		});

		it('ignores other keys', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			fire(section.headerEl, {
				type: 'keydown',
				key: 'a',
				preventDefault: vi.fn(),
			});
			expect(section.isCollapsed()).toBe(false);
		});
	});

	describe('toggle drives collapse', () => {
		it('auto-collapses when the toggle is turned off', async () => {
			const onToggle = vi.fn();
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'Audio',
				enabled: true,
				onToggle,
				onCollapseChange,
			});

			await (section.toggle as unknown as ToggleComponent)._trigger(false);

			expect(section.isCollapsed()).toBe(true);
			expect(onCollapseChange).toHaveBeenCalledWith(true);
			expect(onToggle).toHaveBeenCalledWith(false);
		});

		it('auto-expands when the toggle is turned on', async () => {
			const onToggle = vi.fn();
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'Audio',
				enabled: false,
				collapsed: true,
				onToggle,
				onCollapseChange,
			});

			await (section.toggle as unknown as ToggleComponent)._trigger(true);

			expect(section.isCollapsed()).toBe(false);
			expect(onCollapseChange).toHaveBeenCalledWith(false);
			expect(onToggle).toHaveBeenCalledWith(true);
		});

		it('collapses before invoking onToggle so persisted state is consistent', async () => {
			const order: string[] = [];
			const section = addCollapsibleSection(container, {
				title: 'Audio',
				enabled: true,
				onToggle: () => {
					order.push(`toggle:collapsed=${section.isCollapsed()}`);
				},
				onCollapseChange: () => {
					order.push('collapseChange');
				},
			});

			await (section.toggle as unknown as ToggleComponent)._trigger(false);

			expect(order).toEqual(['collapseChange', 'toggle:collapsed=true']);
		});
	});

	describe('setCollapsed', () => {
		it('programmatically collapses and fires onCollapseChange', () => {
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'X',
				onCollapseChange,
			});

			section.setCollapsed(true);

			expect(section.isCollapsed()).toBe(true);
			expect(onCollapseChange).toHaveBeenCalledWith(true);
		});

		it('suppresses onCollapseChange when silent', () => {
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'X',
				onCollapseChange,
			});

			section.setCollapsed(true, true);

			expect(section.isCollapsed()).toBe(true);
			expect(onCollapseChange).not.toHaveBeenCalled();
		});

		it('is a no-op (no callback) when state is unchanged', () => {
			const onCollapseChange = vi.fn();
			const section = addCollapsibleSection(container, {
				title: 'X',
				onCollapseChange,
			});

			section.setCollapsed(false); // already expanded

			expect(onCollapseChange).not.toHaveBeenCalled();
		});
	});

	describe('reset button', () => {
		it('does not render a reset button when onReset is omitted', () => {
			const section = addCollapsibleSection(container, { title: 'X' });
			expect(findByClass(section.headerEl, 'synapse-accordion-reset')).toBeUndefined();
		});

		it('renders a reset button (with a locatable data-icon) when onReset is provided', () => {
			const section = addCollapsibleSection(container, {
				title: 'X',
				onReset: vi.fn(),
			});
			const btn = findByClass(section.headerEl, 'synapse-accordion-reset');
			expect(btn).toBeDefined();
			// setIcon is a no-op in the mock, so tests locate the button by data-icon.
			expect(btn?.getAttribute('data-icon')).toBe('rotate-ccw');
		});

		it('uses the provided resetTooltip as the aria-label', () => {
			const section = addCollapsibleSection(container, {
				title: 'Audio',
				onReset: vi.fn(),
				resetTooltip: 'Reset Audio to defaults',
			});
			const btn = findByClass(section.headerEl, 'synapse-accordion-reset');
			expect(btn?.getAttribute('aria-label')).toBe('Reset Audio to defaults');
		});

		it('falls back to a default aria-label when resetTooltip is omitted', () => {
			const section = addCollapsibleSection(container, {
				title: 'X',
				onReset: vi.fn(),
			});
			const btn = findByClass(section.headerEl, 'synapse-accordion-reset');
			expect(btn?.getAttribute('aria-label')).toBe('Reset to defaults');
		});

		it('invokes onReset and stops propagation on click, without folding the section', () => {
			const onReset = vi.fn();
			const section = addCollapsibleSection(container, { title: 'X', onReset });
			const btn = findByClass(section.headerEl, 'synapse-accordion-reset');
			const stopPropagation = vi.fn();

			fire(btn!, { type: 'click', stopPropagation });

			expect(onReset).toHaveBeenCalledTimes(1);
			// stopPropagation keeps the click off the header's fold handler.
			expect(stopPropagation).toHaveBeenCalledTimes(1);
			expect(section.isCollapsed()).toBe(false);
		});

		it('renders the reset button for a toggle-less config section too', () => {
			const section = addCollapsibleSection(container, {
				title: 'AI config',
				onReset: vi.fn(),
			});
			expect(section.toggle).toBeUndefined();
			expect(findByClass(section.headerEl, 'synapse-accordion-reset')).toBeDefined();
		});
	});
});
