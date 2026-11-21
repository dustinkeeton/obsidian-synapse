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
	manifest = { id: 'synapse', name: 'Synapse', version: '1.7.0' };
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

/** Synthetic event accepted by the stub's `dispatchEvent` test helper. */
interface StubEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * The `cls`/`text`/`attr` subset of Obsidian's `DomElementInfo` the stub
 * actually applies (see {@link createStubEl}). Other `DomElementInfo` keys a
 * caller may pass are ignored at runtime; the consumer-facing `createEl`/
 * `createDiv`/`createSpan` signatures come from the global Obsidian
 * augmentation on `HTMLElement`, not from this internal helper type.
 */
type StubElInfo =
	| string
	| {
			cls?: string | string[];
			text?: string | number;
			attr?: Record<string, string | number | boolean>;
	  };

/**
 * Concrete type for the DOM stub produced by {@link createStubEl} /
 * {@link createEl}.
 *
 * It extends the (Obsidian-augmented) global `HTMLElement` so a stub is
 * accepted anywhere shipped code expects a real `containerEl: HTMLElement`
 * (e.g. `renderFeatureChipSelect(container: HTMLElement)`), which is how the
 * ~56 consuming `*.test.ts` files feed it in. The augmentation already supplies
 * `createEl`/`createDiv`/`createSpan`/`empty`/`setText`/`addClass`/… with their
 * real return types, so tests keep introspecting the stub tree without `any`.
 * Only the deltas from a real element are declared here: an optional `value`
 * (read off `<option>`/input stubs) and a `dispatchEvent` widened to accept the
 * synthetic {@link StubEvent} payloads tests fire.
 */
export interface StubEl extends HTMLElement {
	/** Present on `<option>`/input stubs; absent on plain elements. */
	value?: string;
	/** Test helper: dispatch accepts a synthetic `{ type, … }`, not only `Event`. */
	dispatchEvent(evt: Event | StubEvent): boolean;
}

/**
 * Helper to create a stub DOM element with Obsidian's augmented methods.
 *
 * Supports the subset of the HTMLElement + Obsidian DOM API used across the
 * plugin. Class state, attributes, children, and event listeners are tracked
 * so tests can introspect structure and dispatch synthetic events.
 */
// Methods are plain (not `vi.fn`): spies are never released and would retain every rendered tree (#635).
function createStubEl(tag = 'div'): StubEl {
	const classes = new Set<string>();
	const attributes: Record<string, string> = {};
	const cssProps: Record<string, string> = {};
	const listeners: Record<string, Array<(evt: StubEvent) => void>> = {};
	const children: StubEl[] = [];

	const applyInfo = (child: StubEl, info?: StubElInfo): StubEl => {
		if (typeof info === 'string') {
			info.split(/\s+/).filter(Boolean).forEach((c) => child.classList.add(c));
		} else if (info && typeof info === 'object') {
			if (info.cls) {
				const clsList = Array.isArray(info.cls) ? info.cls : [info.cls];
				clsList.forEach((c) => child.classList.add(c));
			}
			if (info.text != null) child.textContent = String(info.text);
			if (info.attr) {
				for (const [k, v] of Object.entries(info.attr)) child.setAttribute(k, String(v));
			}
		}
		return child;
	};

	const make =
		(childTag: string) =>
		(info?: StubElInfo, cb?: (el: StubEl) => void): StubEl => {
			const child = createStubEl(childTag);
			applyInfo(child, info);
			children.push(child);
			if (cb) cb(child);
			return child;
		};

	const el: StubEl = {
		tagName: tag.toUpperCase(),
		classList: {
			add: (...c: string[]) => c.forEach((x) => classes.add(x)),
			remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
			contains: (c: string) => classes.has(c),
			toggle: (c: string) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
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
		empty: () => {
			children.length = 0;
		},
		createEl: (t: string, info?: StubElInfo, cb?: (el: StubEl) => void) => make(t)(info, cb),
		createDiv: make('div'),
		createSpan: make('span'),
		addClass: (...c: string[]) => c.forEach((x) => classes.add(x)),
		removeClass: (...c: string[]) => c.forEach((x) => classes.delete(x)),
		toggleClass: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
		hasClass: (c: string) => classes.has(c),
		setText: (t: string) => {
			el.textContent = t;
		},
		setAttribute: (k: string, v: string) => {
			attributes[k] = v;
		},
		getAttribute: (k: string) => (k in attributes ? attributes[k] : null),
		removeAttribute: (k: string) => {
			delete attributes[k];
		},
		addEventListener: (type: string, cb: (evt: StubEvent) => void) => {
			(listeners[type] ??= []).push(cb);
		},
		removeEventListener: () => {},
		/** Test helper: synchronously invoke registered listeners for an event. */
		dispatchEvent: (evt: StubEvent) => {
			(listeners[evt.type] ?? []).forEach((cb) => cb(evt));
			return true;
		},
		closest: (_selector: string): StubEl | null => null,
		/**
		 * Obsidian's `HTMLElement.findAll` augmentation, absent from jsdom-less
		 * vitest. Minimal recursive matcher over the tracked `children` tree
		 * supporting the selector shapes shipped code uses: a single class
		 * (`.foo`) or a tag name (`div`). Returns a real array so callers can
		 * `.find()`/`.map()` on it as they would in Obsidian.
		 */
		findAll: (selector: string): StubEl[] => {
			const matches = (node: StubEl): boolean =>
				selector.startsWith('.')
					? node.classList.contains(selector.slice(1))
					: node.tagName === selector.toUpperCase();
			const walk = (nodes: StubEl[]): StubEl[] =>
				nodes.flatMap((n) => [
					...(matches(n) ? [n] : []),
					...walk((n.children as unknown as StubEl[]) ?? []),
				]);
			return walk(children);
		},
		style: {},
		setCssProps: (props: Record<string, string>) => {
			Object.assign(cssProps, props);
		},
	} as unknown as StubEl;
	return el;
}

/**
 * Test helper: build a detached stub element that supports the Obsidian DOM
 * helpers (createDiv/createSpan/createEl/empty/classList/…). Useful for
 * rendering components that expect a real `containerEl`.
 */
export function createEl(tag = 'div'): StubEl {
	return createStubEl(tag);
}

export class Notice {
	/** Test helper: every Notice ever constructed (clear between tests). */
	static instances: Notice[] = [];
	noticeEl = createStubEl();
	duration?: number;
	/** Test helper: the raw string message the Notice was constructed with. */
	message?: string;
	constructor(_message: string | DocumentFragment, _duration?: number) {
		this.duration = _duration;
		if (typeof _message === 'string') {
			this.message = _message;
			this.noticeEl.textContent = _message;
		}
		Notice.instances.push(this);
	}
	/** Test helper: number of hide() calls. */
	hideCalls = 0;
	setMessage(msg: string): this {
		this.noticeEl.textContent = msg;
		return this;
	}
	hide(): void {
		this.hideCalls++;
	}
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
	contentEl = createStubEl();
	containerEl = createStubEl();
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
	inputEl = { value: '', focus: vi.fn() };
	scope = { register: vi.fn(), unregister: vi.fn() };
	setInstructions = vi.fn();
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
	toggleEl = createStubEl();
	tooltip = '';
	/** Last state set via setDisabled; undefined until called. */
	disabled: boolean | undefined;
	private value = false;
	private changeCb: ((value: boolean) => unknown) | undefined;
	constructor() {
		ToggleComponent.instances.push(this);
	}
	getValue(): boolean {
		return this.value;
	}
	setValue(v: boolean): this {
		this.value = v;
		return this;
	}
	setTooltip(t: string): this {
		this.tooltip = t;
		return this;
	}
	setDisabled(d: boolean): this {
		this.disabled = d;
		return this;
	}
	onChange(cb: (value: boolean) => unknown): this {
		this.changeCb = cb;
		return this;
	}
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
 * Methods are plain (not `vi.fn`): spies are never released and would retain every rendered tree (#635).
 */
export class ButtonComponent {
	/** Test helper: every instance ever constructed (clear between tests). */
	static instances: ButtonComponent[] = [];
	private clickCb: (() => unknown) | undefined;
	/** Last text set via setButtonText — lets tests locate a specific button. */
	buttonText = '';
	/** Every tooltip set via setTooltip, in call order. */
	tooltips: string[] = [];
	/** Last disabled state set via setDisabled; undefined until called. */
	disabled: boolean | undefined;
	/** True once setWarning was called. */
	warning = false;
	/** True once setCta was called. */
	cta = false;
	/** Last icon set via setIcon. */
	icon = '';
	/** Classes added via setClass. */
	classes: string[] = [];
	constructor() {
		ButtonComponent.instances.push(this);
	}
	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}
	setButtonText(t: string): this {
		this.buttonText = t;
		return this;
	}
	setTooltip(t: string): this {
		this.tooltips.push(t);
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	setWarning(): this {
		this.warning = true;
		return this;
	}
	setClass(cls: string): this {
		this.classes.push(cls);
		return this;
	}
	setDisabled(d: boolean): this {
		this.disabled = d;
		return this;
	}
	onClick(cb: () => unknown): this {
		this.clickCb = cb;
		return this;
	}
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
	settingEl: StubEl;
	/** Mirrors Obsidian's control column, for raw-DOM controls appended to a row. */
	controlEl: StubEl;
	/** Child components created via add*, mirroring Obsidian's `components`. */
	components: ToggleComponent[] = [];
	/** Buttons created via addButton / addExtraButton, in call order. */
	buttons: ButtonComponent[] = [];
	extraButtons: ButtonComponent[] = [];
	/** Every Setting constructed since the last reset (tests clear between cases). */
	static instances: Setting[] = [];
	/** Last name set via setName. */
	name = '';
	/** Last description set via setDesc. */
	desc: string | DocumentFragment | undefined;
	/** Last state set via setDisabled; undefined until called. */
	disabled: boolean | undefined;
	/** True once setHeading was called. */
	heading = false;
	/** Classes added via setClass. */
	classes: string[] = [];
	constructor(containerEl?: { createDiv?: (cls: string) => StubEl }) {
		this.settingEl = containerEl?.createDiv?.('setting-item') ?? createStubEl();
		// Some tests hand in a bare container whose createDiv returns a non-stub.
		this.controlEl = typeof this.settingEl?.createDiv === 'function'
			? this.settingEl.createDiv('setting-item-control')
			: createStubEl();
		Setting.instances.push(this);
	}
	setName(name: string): this {
		this.name = name;
		return this;
	}
	setDesc(desc: string | DocumentFragment): this {
		this.desc = desc;
		return this;
	}
	setHeading(): this {
		this.heading = true;
		return this;
	}
	addText(): this {
		return this;
	}
	addTextArea(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
	addToggle(cb?: (t: ToggleComponent) => void): this {
		const toggle = new ToggleComponent();
		this.components.push(toggle);
		if (cb) cb(toggle);
		return this;
	}
	addSlider(): this {
		return this;
	}
	addButton(cb?: (b: ButtonComponent) => void): this {
		const button = new ButtonComponent();
		this.buttons.push(button);
		if (cb) cb(button);
		return this;
	}
	addExtraButton(cb?: (b: ButtonComponent) => void): this {
		const button = new ButtonComponent();
		this.extraButtons.push(button);
		if (cb) cb(button);
		return this;
	}
	setClass(cls: string): this {
		this.classes.push(cls);
		return this;
	}
	setDisabled(d: boolean): this {
		this.disabled = d;
		return this;
	}
}

export class WorkspaceLeaf {
	view: unknown = {};
	setViewState = vi.fn().mockResolvedValue(undefined);
}

// --- Metadata helpers ---

/** The slice of Obsidian's `CachedMetadata` this stub reads tags out of. */
interface TagsCache {
	tags?: Array<{ tag: string }>;
	frontmatter?: { tags?: string | string[] };
}

export function getAllTags(cache: TagsCache | null | undefined): string[] | null {
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

export function parseYaml(yaml: string): Record<string, unknown> {
	// Simple YAML parser for tests — handles key: value lines
	const result: Record<string, unknown> = {};
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

export function stringifyYaml(obj: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${String(item)}`);
		} else {
			lines.push(`${key}: ${String(value)}`);
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
	sliderEl = createStubEl();
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
