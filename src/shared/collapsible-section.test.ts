import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addCollapsibleSection } from './collapsible-section';

/**
 * Recursive stub element mirroring the Obsidian DOM augmentation, with enough
 * introspection (classes, attributes, children, listeners) to assert accordion
 * behavior. Matches the shape produced by the obsidian mock's createStubEl.
 */
function stubEl(tag = 'div'): any {
	const classes = new Set<string>();
	const attributes: Record<string, string> = {};
	const listeners: Record<string, Array<(evt: any) => void>> = {};
	const children: any[] = [];

	const apply = (child: any, info?: any) => {
		if (info && typeof info === 'object') {
			if (info.cls) {
				(Array.isArray(info.cls) ? info.cls : [info.cls]).forEach((c: string) =>
					child.classList.add(c),
				);
			}
			if (info.text != null) child.textContent = String(info.text);
		}
		return child;
	};
	const make = (t: string) => (info?: any, cb?: (el: any) => void) => {
		const child = stubEl(t);
		apply(child, info);
		children.push(child);
		if (cb) cb(child);
		return child;
	};

	const el: any = {
		tagName: tag.toUpperCase(),
		textContent: '',
		children,
		classList: {
			add: (...c: string[]) => c.forEach((x) => classes.add(x)),
			remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
			contains: (c: string) => classes.has(c),
		},
		hasClass: (c: string) => classes.has(c),
		addClass: (...c: string[]) => c.forEach((x) => classes.add(x)),
		removeClass: (...c: string[]) => c.forEach((x) => classes.delete(x)),
		setText: (t: string) => {
			el.textContent = t;
		},
		setAttribute: (k: string, v: string) => {
			attributes[k] = v;
		},
		getAttribute: (k: string) => (k in attributes ? attributes[k] : null),
		createDiv: make('div'),
		createSpan: make('span'),
		createEl: (t: string, info?: any, cb?: (el: any) => void) => make(t)(info, cb),
		addEventListener: (type: string, cb: (evt: any) => void) => {
			(listeners[type] ??= []).push(cb);
		},
		dispatchEvent: (evt: { type: string; [k: string]: unknown }) => {
			(listeners[evt.type] ?? []).forEach((cb) => cb(evt));
			return true;
		},
	};
	return el;
}

/**
 * Dispatch a synthetic event on a stub element. Casts away the real-DOM
 * `Event` type since stub elements accept plain `{ type, ... }` payloads.
 */
function fire(el: any, evt: Record<string, unknown> & { type: string }): void {
	el.dispatchEvent(evt);
}

/** Recursively find the first descendant element whose class set contains `cls`. */
function findByClass(root: any, cls: string): any | undefined {
	for (const child of root.children ?? []) {
		if (child.hasClass?.(cls)) return child;
		const nested = findByClass(child, cls);
		if (nested) return nested;
	}
	return undefined;
}

describe('addCollapsibleSection', () => {
	let container: any;

	beforeEach(() => {
		container = stubEl();
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

			await (section.toggle as any)._trigger(false);

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

			await (section.toggle as any)._trigger(true);

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

			await (section.toggle as any)._trigger(false);

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
});
