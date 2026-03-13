/**
 * Centralized mock for the 'obsidian' module.
 * Auto-resolved by Vitest via vi.mock('obsidian') in setup.ts.
 *
 * Provides stubs for all Obsidian APIs used by the Auto Notes plugin.
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
	manifest = { id: 'auto-notes', name: 'Auto Notes', version: '0.1.0' };
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

/** Helper to create a stub DOM element with Obsidian's augmented methods */
function createStubEl(): any {
	const el: any = {
		classList: { add: vi.fn(), remove: vi.fn() },
		className: '',
		textContent: '',
		empty: vi.fn(),
		createEl: vi.fn().mockImplementation(() => createStubEl()),
		createDiv: vi.fn().mockImplementation(() => createStubEl()),
		addEventListener: vi.fn(),
		closest: vi.fn().mockReturnValue(null),
	};
	return el;
}

export class Notice {
	noticeEl: any;
	constructor(_message: string | DocumentFragment, _duration?: number) {
		this.noticeEl = createStubEl();
		if (typeof _message === 'string') {
			this.noticeEl.textContent = _message;
		}
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

export class Setting {
	constructor(_containerEl: unknown) {}
	setName = vi.fn().mockReturnThis();
	setDesc = vi.fn().mockReturnThis();
	addText = vi.fn().mockReturnThis();
	addTextArea = vi.fn().mockReturnThis();
	addDropdown = vi.fn().mockReturnThis();
	addToggle = vi.fn().mockReturnThis();
	addSlider = vi.fn().mockReturnThis();
	addButton = vi.fn().mockReturnThis();
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

// --- Utility functions ---

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
