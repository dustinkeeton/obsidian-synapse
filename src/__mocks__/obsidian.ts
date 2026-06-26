/**
 * Centralized mock for the 'obsidian' module.
 * Auto-resolved by Vitest via vi.mock('obsidian') in setup.ts.
 *
 * Provides stubs for all Obsidian APIs used by the Synapse plugin.
 * Tests should use createMockApp() from __test-utils__/mock-factories.ts
 * for per-test instances with spy functions.
 */

import { vi } from 'vitest';

// --- Data classes (must be real classes for instanceof checks) ---

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: TFolder | null;
	stat = { ctime: Date.now(), mtime: Date.now(), size: 100 };
	vault: unknown = {};

	constructor(path = '') {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.extension = this.name.includes('.') ? this.name.split('.').pop()! : '';
		this.basename = this.name.replace(/\.[^.]+$/, '');
		this.parent = null;
	}
}

export class TFolder {
	path: string;
	name: string;
	parent: TFolder | null = null;
	children: (TFile | TFolder)[] = [];
	isRoot = () => this.path === '/';

	constructor(path = '') {
		this.path = path;
		this.name = path.split('/').pop() || '';
	}
}

// --- UI classes (stubs) ---

export class Plugin {
	app: unknown = {};
	manifest = { id: 'synapse', name: 'Synapse', version: '1.0.7' };
	addCommand = vi.fn();
	addRibbonIcon = vi.fn();
	addSettingTab = vi.fn();
	addStatusBarItem = vi.fn().mockReturnValue({ setText: vi.fn() });
	registerView = vi.fn();
	registerEvent = vi.fn();
	registerDomEvent = vi.fn();
	loadData = vi.fn().mockResolvedValue(null);
	saveData = vi.fn().mockResolvedValue(undefined);
}

export class Modal {
	app: unknown;
	contentEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
	containerEl = { empty: vi.fn(), createEl: vi.fn() };
	constructor(app: unknown) {
		this.app = app;
	}
	open = vi.fn();
	close = vi.fn();
	onOpen(): void {}
	onClose(): void {}
}

/**
 * Helper to create a stub DOM element with Obsidian's augmented methods.
 *
 * Supports the subset of the HTMLElement + Obsidian DOM API used across the
 * plugin. Class state, attributes, children, and event listeners are tracked
 * so tests can introspect structure and dispatch synthetic events.
 */
function createStubEl(tag = 'div'): any {
	const classes = new Set<string>();
	const attributes: Record<string, string> = {};
	const listeners: Record<string, Array<(evt: any) => void>> = {};
	const children: any[] = [];

	const applyInfo = (child: any, info?: any): any => {
		if (typeof info === 'string') {
			info.split(/\s+/).filter(Boolean).forEach((c: string) => child.classList.add(c));
		} else if (info && typeof info === 'object') {
			if (info.cls) {
				const clsList = Array.isArray(info.cls) ? info.cls : [info.cls];
				clsList.forEach((c: string) => child.classList.add(c));
			}
			if (info.text != null) child.textContent = String(info.text);
			if (info.attr) {
				for (const [k, v] of Object.entries(info.attr)) child.setAttribute(k, String(v));
			}
		}
		return child;
	};

	const make = (childTag: string) => (info?: any, cb?: (el: any) => void) => {
		const child = createStubEl(childTag);
		applyInfo(child, info);
		children.push(child);
		if (cb) cb(child);
		return child;
	};

	const el: any = {
		tagName: tag.toUpperCase(),
		classList: {
			add: vi.fn((...c: string[]) => c.forEach((x) => classes.add(x))),
			remove: vi.fn((...c: string[]) => c.forEach((x) => classes.delete(x))),
			contains: (c: string) => classes.has(c),
			toggle: vi.fn((c: string) => (classes.has(c) ? classes.delete(c) : classes.add(c))),
		},
		get className() {
			return [...classes].join(' ');
		},
		set className(value: string) {
			classes.clear();
			String(value)
				.split(/\s+/)
				.filter(Boolean)
				.forEach((c) => classes.add(c));
		},
		textContent: '',
		children,
		empty: vi.fn(() => {
			children.length = 0;
		}),
		createEl: vi.fn((t: string, info?: any, cb?: (el: any) => void) =>
			make(t)(info, cb),
		),
		createDiv: vi.fn(make('div')),
		createSpan: vi.fn(make('span')),
		addClass: vi.fn((...c: string[]) => c.forEach((x) => classes.add(x))),
		removeClass: vi.fn((...c: string[]) => c.forEach((x) => classes.delete(x))),
		toggleClass: vi.fn((c: string, on: boolean) =>
			on ? classes.add(c) : classes.delete(c),
		),
		hasClass: (c: string) => classes.has(c),
		setText: vi.fn((t: string) => {
			el.textContent = t;
		}),
		setAttribute: vi.fn((k: string, v: string) => {
			attributes[k] = v;
		}),
		getAttribute: vi.fn((k: string) => (k in attributes ? attributes[k] : null)),
		removeAttribute: vi.fn((k: string) => {
			delete attributes[k];
		}),
		addEventListener: vi.fn((type: string, cb: (evt: any) => void) => {
			(listeners[type] ??= []).push(cb);
		}),
		removeEventListener: vi.fn(),
		/** Test helper: synchronously invoke registered listeners for an event. */
		dispatchEvent: (evt: { type: string; [k: string]: unknown }) => {
			(listeners[evt.type] ?? []).forEach((cb) => cb(evt));
			return true;
		},
		closest: vi.fn().mockReturnValue(null),
		style: {},
	};
	return el;
}

/**
 * Test helper: build a detached stub element that supports the Obsidian DOM
 * helpers (createDiv/createSpan/createEl/empty/classList/…). Useful for
 * rendering components that expect a real `containerEl`.
 */
export function createEl(tag = 'div'): any {
	return createStubEl(tag);
}

export class Notice {
	/** Test helper: every Notice ever constructed (clear between tests). */
	static instances: Notice[] = [];
	noticeEl: any;
	duration?: number;
	/** Test helper: the raw string message the Notice was constructed with. */
	message?: string;
	constructor(_message: string | DocumentFragment, _duration?: number) {
		this.noticeEl = createStubEl();
		this.duration = _duration;
		if (typeof _message === 'string') {
			this.message = _message;
			this.noticeEl.textContent = _message;
		}
		Notice.instances.push(this);
	}
	setMessage = vi.fn((msg: string) => {
		if (this.noticeEl) this.noticeEl.textContent = msg;
	});
	hide = vi.fn();
}

export class PluginSettingTab {
	app: unknown;
	containerEl = { empty: vi.fn(), createEl: vi.fn() };
	constructor(app: unknown, _plugin: unknown) {
		this.app = app;
	}
	display(): void {}
	hide(): void {}
}

/**
 * Minimal MarkdownView stub. Real folding logic is tested against hand-built
 * fake views (with a `querySelector`-capable root), so the stub only needs to
 * satisfy the `import { MarkdownView }` binding + `instanceof` checks; its
 * `contentEl`/`containerEl` are plain stub els without `querySelector`.
 */
export class MarkdownView {
	app: unknown = {};
	leaf: unknown;
	file: TFile | null = null;
	contentEl: any = createStubEl();
	containerEl: any = createStubEl();
	constructor(leaf?: unknown) {
		this.leaf = leaf;
	}
}

export class ItemView {
	app: unknown;
	contentEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
	leaf: unknown;
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
	getViewType(): string {
		return '';
	}
	getDisplayText(): string {
		return '';
	}
	onOpen(): Promise<void> {
		return Promise.resolve();
	}
	onClose(): Promise<void> {
		return Promise.resolve();
	}
}

export class SuggestModal<T = unknown> {
	app: unknown;
	inputEl: any = { value: '', focus: vi.fn() };
	constructor(app: unknown) {
		this.app = app;
	}
	getSuggestions(_query: string): T[] {
		return [];
	}
	renderSuggestion(_item: T, _el: unknown): void {}
	onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
	open = vi.fn();
	close = vi.fn();
	onOpen(): void {}
	onClose(): void {}
}

export class ToggleComponent {
	/** Test helper: every instance ever constructed (clear between tests). */
	static instances: ToggleComponent[] = [];
	toggleEl: any = createStubEl();
	tooltip = '';
	private value = false;
	private changeCb: ((value: boolean) => unknown) | undefined;
	constructor() {
		ToggleComponent.instances.push(this);
	}
	getValue = () => this.value;
	setValue = vi.fn((v: boolean) => {
		this.value = v;
		return this;
	});
	setTooltip = vi.fn((t: string) => {
		this.tooltip = t;
		return this;
	});
	setDisabled = vi.fn().mockReturnThis();
	onChange = vi.fn((cb: (value: boolean) => unknown) => {
		this.changeCb = cb;
		return this;
	});
	/** Test helper: simulate a user toggling the control. */
	_trigger(v: boolean): unknown {
		this.value = v;
		return this.changeCb?.(v);
	}
}

/**
 * Minimal stand-in for Obsidian's ButtonComponent / ExtraButtonComponent —
 * just the chainable builder surface (`setIcon`, `setButtonText`, `setTooltip`,
 * `onClick`) the settings UI uses. `_click()` is a test helper to fire onClick.
 */
export class ButtonComponent {
	/** Test helper: every instance ever constructed (clear between tests). */
	static instances: ButtonComponent[] = [];
	private clickCb: (() => unknown) | undefined;
	/** Last text set via setButtonText — lets tests locate a specific button. */
	buttonText = '';
	/** Last disabled state set via setDisabled. */
	disabled = false;
	constructor() {
		ButtonComponent.instances.push(this);
	}
	setIcon = vi.fn().mockReturnThis();
	setButtonText = vi.fn((t: string) => {
		this.buttonText = t;
		return this;
	});
	setTooltip = vi.fn().mockReturnThis();
	setCta = vi.fn().mockReturnThis();
	setWarning = vi.fn().mockReturnThis();
	setDisabled = vi.fn((d: boolean) => {
		this.disabled = d;
		return this;
	});
	onClick = vi.fn((cb: () => unknown) => {
		this.clickCb = cb;
		return this;
	});
	/** Test helper: simulate a user clicking the button. */
	_click(): unknown {
		return this.clickCb?.();
	}
}

export class Setting {
	/**
	 * Mirrors real Obsidian: the row's element is created from (and appended to)
	 * the container, so helpers nested into `settingEl` stay reachable from the
	 * container in tests. Falls back to an orphan stub when no container is passed
	 * (e.g. credential-field.test.ts passes `{}` and inspects the stub directly).
	 */
	settingEl: any;
	/** Child components created via add*, mirroring Obsidian's `components`. */
	components: ToggleComponent[] = [];
	constructor(containerEl?: any) {
		this.settingEl = containerEl?.createDiv?.('setting-item') ?? createStubEl();
	}
	setName = vi.fn().mockReturnThis();
	setDesc = vi.fn().mockReturnThis();
	setHeading = vi.fn().mockReturnThis();
	addText = vi.fn().mockReturnThis();
	addTextArea = vi.fn().mockReturnThis();
	addDropdown = vi.fn().mockReturnThis();
	addToggle = vi.fn(function (this: Setting, cb?: (t: ToggleComponent) => void) {
		const toggle = new ToggleComponent();
		this.components.push(toggle);
		if (cb) cb(toggle);
		return this;
	});
	addSlider = vi.fn().mockReturnThis();
	addButton = vi.fn(function (this: Setting, cb?: (b: ButtonComponent) => void) {
		if (cb) cb(new ButtonComponent());
		return this;
	});
	addExtraButton = vi.fn(function (this: Setting, cb?: (b: ButtonComponent) => void) {
		if (cb) cb(new ButtonComponent());
		return this;
	});
	setClass = vi.fn().mockReturnThis();
	setDisabled = vi.fn().mockReturnThis();
}

export class WorkspaceLeaf {
	view: unknown = {};
	setViewState = vi.fn().mockResolvedValue(undefined);
}

// --- Metadata helpers ---

export function getAllTags(cache: any): string[] | null {
	const tags: string[] = [];
	if (cache?.tags) {
		for (const t of cache.tags) tags.push(t.tag);
	}
	if (cache?.frontmatter?.tags) {
		const fm = cache.frontmatter.tags;
		const fmTags = Array.isArray(fm) ? fm : [fm];
		for (const t of fmTags) {
			const tag = String(t).startsWith('#') ? String(t) : `#${t}`;
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
	return tags.length > 0 ? tags : null;
}

export function parseYaml(yaml: string): any {
	// Simple YAML parser for tests — handles key: value lines
	const result: Record<string, any> = {};
	for (const line of yaml.split('\n')) {
		const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
		if (match) {
			const val = match[2].trim();
			// Try to parse arrays like [a, b, c]
			if (val.startsWith('[') && val.endsWith(']')) {
				result[match[1]] = val.slice(1, -1).split(',').map(s => s.trim());
			} else {
				result[match[1]] = val;
			}
		}
	}
	return result;
}

export function stringifyYaml(obj: any): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${item}`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}
	return lines.join('\n') + '\n';
}

// --- Platform detection (mock defaults to desktop) ---

export const Platform = {
	isDesktop: true,
	isDesktopApp: true,
	isMobile: false,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: true,
	isWin: false,
	isLinux: false,
	isSafari: false,
};

// --- SliderComponent (stub for slider-helper.ts) ---

export class SliderComponent {
	sliderEl: any = createStubEl();
	setLimits = vi.fn().mockReturnThis();
	setValue = vi.fn().mockReturnThis();
	setDynamicTooltip = vi.fn().mockReturnThis();
	onChange = vi.fn().mockReturnThis();
}

// --- Utility functions ---

/** Registers a custom icon by id (real Obsidian: addIcon(id, svgContent)). */
export const addIcon = vi.fn();

/**
 * Sets an element's content to a registered icon's <svg> (real Obsidian:
 * setIcon(el, iconId)). No-op here — callers that need the icon assertable in
 * tests should also stamp a `data-icon` attribute on the element.
 */
export const setIcon = vi.fn();

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export const requestUrl = vi.fn().mockResolvedValue({
	status: 200,
	json: {},
	text: '',
	headers: {},
});

// --- Type re-exports (interfaces/types used in signatures) ---

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	json: unknown;
	text: string;
}
