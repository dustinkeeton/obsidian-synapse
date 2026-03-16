import { describe, it, expect, vi } from 'vitest';
import { TFolder } from 'obsidian';
import { FolderPickerModal } from './folder-picker-modal';

function makeFolder(path: string): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split('/').pop() || '';
	f.children = [];
	return f;
}

function buildFolderTree() {
	const root = makeFolder('/');
	root.isRoot = () => true;

	const notes = makeFolder('notes');
	const daily = makeFolder('notes/daily');
	const projects = makeFolder('projects');
	const templates = makeFolder('templates');

	notes.children = [daily];
	root.children = [notes, projects, templates];

	return { root, notes, daily, projects, templates };
}

function createMockApp(root: TFolder) {
	return {
		vault: { getRoot: () => root },
		workspace: { getActiveFile: () => null },
	} as any;
}

describe('FolderPickerModal', () => {
	it('getSuggestions returns all folders including root for empty query', () => {
		const { root, notes, daily, projects, templates } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());

		const results = modal.getSuggestions('');
		const paths = results.map(f => f.path);

		expect(paths).toContain('/');
		expect(paths).toContain('notes');
		expect(paths).toContain('notes/daily');
		expect(paths).toContain('projects');
		expect(paths).toContain('templates');
	});

	it('getSuggestions filters by query but always includes root', () => {
		const { root } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());

		const results = modal.getSuggestions('proj');
		const paths = results.map(f => f.path);

		expect(paths).toContain('/');
		expect(paths).toContain('projects');
		expect(paths).not.toContain('notes');
		expect(paths).not.toContain('templates');
	});

	it('getSuggestions is case-insensitive', () => {
		const { root } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());

		const results = modal.getSuggestions('NOTES');
		const paths = results.map(f => f.path);

		expect(paths).toContain('notes');
		expect(paths).toContain('notes/daily');
	});

	it('onChooseSuggestion calls the callback', () => {
		const { root, projects } = buildFolderTree();
		const app = createMockApp(root);
		const callback = vi.fn();
		const modal = new FolderPickerModal(app, callback);

		modal.onChooseSuggestion(projects);

		expect(callback).toHaveBeenCalledWith(projects);
	});

	it('onOpen pre-fills inputEl with defaultPath', () => {
		const { root } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn(), 'notes/daily');

		modal.onOpen();

		expect(modal.inputEl.value).toBe('notes/daily');
	});

	it('onOpen does not set inputEl when no defaultPath', () => {
		const { root } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());

		modal.onOpen();

		expect(modal.inputEl.value).toBe('');
	});

	it('renderSuggestion shows vault root label for root folder', () => {
		const { root } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());
		const el = { createEl: vi.fn() } as any;

		modal.renderSuggestion(root, el);

		expect(el.createEl).toHaveBeenCalledWith('div', { text: '/ (vault root)' });
	});

	it('renderSuggestion shows folder path for non-root', () => {
		const { root, projects } = buildFolderTree();
		const app = createMockApp(root);
		const modal = new FolderPickerModal(app, vi.fn());
		const el = { createEl: vi.fn() } as any;

		modal.renderSuggestion(projects, el);

		expect(el.createEl).toHaveBeenCalledWith('div', { text: 'projects' });
	});
});
