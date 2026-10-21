import { describe, it, expect, vi } from 'vitest';
import { TFolder, type App } from 'obsidian';
import { createEl } from '../__mocks__/obsidian';
import { ScanFolderPickerModal, ROOT_LABEL, ROOT_TOP_LEVEL_LABEL } from './scan-folder-picker-modal';

function makeFolder(path: string, root = false): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split('/').pop() || '';
	f.children = [];
	f.isRoot = () => root;
	return f;
}

function setup() {
	const root = makeFolder('/', true);
	const inbox = makeFolder('Inbox');
	const archive = makeFolder('Inbox/archive');
	inbox.children = [archive];
	root.children = [inbox];
	const app = { vault: { getRoot: () => root } } as unknown as App;
	const onChoose = vi.fn();
	const modal = new ScanFolderPickerModal(app, onChoose);
	return { root, inbox, archive, modal, onChoose };
}

const enter = { shiftKey: false } as KeyboardEvent;
const shiftEnter = { shiftKey: true } as KeyboardEvent;

describe('ScanFolderPickerModal', () => {
	it('lists root first, then the top-level-only root row, on an empty query', () => {
		const { modal, root } = setup();

		const [first, second, third] = modal.getSuggestions('');

		expect(first).toEqual({ folder: root, recursive: true });
		expect(second).toEqual({ folder: root, recursive: false });
		expect(third.folder.path).toBe('Inbox');
		expect(third.recursive).toBe(true);
	});

	it('keeps an exact folder match ahead of both root rows', () => {
		const { modal } = setup();

		const paths = modal.getSuggestions('inbox').map(s => `${s.folder.path}:${s.recursive}`);

		expect(paths).toEqual(['Inbox:true', '/:true', '/:false', 'Inbox/archive:true']);
	});

	it('Enter on the first row scans the whole vault', () => {
		const { modal, onChoose } = setup();

		modal.onChooseSuggestion(modal.getSuggestions('')[0], enter);

		expect(onChoose).toHaveBeenCalledWith({ folder: undefined, recursive: true });
	});

	it('Enter on the second row scans the vault root top level only', () => {
		const { modal, onChoose } = setup();

		modal.onChooseSuggestion(modal.getSuggestions('')[1], enter);

		expect(onChoose).toHaveBeenCalledWith({ folder: undefined, recursive: false });
	});

	it('Enter on a folder scans it recursively', () => {
		const { modal, inbox, onChoose } = setup();

		modal.onChooseSuggestion({ folder: inbox, recursive: true }, enter);

		expect(onChoose).toHaveBeenCalledWith({ folder: 'Inbox', recursive: true });
	});

	it('Shift+Enter on a folder scans only its direct children', () => {
		const { modal, archive, onChoose } = setup();

		modal.onChooseSuggestion({ folder: archive, recursive: true }, shiftEnter);

		expect(onChoose).toHaveBeenCalledWith({ folder: 'Inbox/archive', recursive: false });
	});

	it('registers Shift+Enter and shows the scope instructions', () => {
		const { modal } = setup();
		const register = modal.scope.register as unknown as ReturnType<typeof vi.fn>;
		const setInstructions = modal.setInstructions as unknown as ReturnType<typeof vi.fn>;

		expect(register).toHaveBeenCalledWith(['Shift'], 'Enter', expect.any(Function));
		const purposes = (setInstructions.mock.calls[0][0] as Array<{ purpose: string }>).map(i => i.purpose);
		expect(purposes).toContain('to scan this folder only');
	});

	it('Shift+Enter handler routes the selected item through the chooser', () => {
		const { modal } = setup();
		const useSelectedItem = vi.fn();
		(modal as unknown as { chooser: unknown }).chooser = { useSelectedItem };
		const register = modal.scope.register as unknown as ReturnType<typeof vi.fn>;
		const handler = register.mock.calls[0][2] as (evt: KeyboardEvent) => unknown;

		const result = handler(shiftEnter);

		expect(useSelectedItem).toHaveBeenCalledWith(shiftEnter);
		expect(result).toBe(false);
	});

	it('labels both root rows distinctly', () => {
		const { modal } = setup();
		const [all, topLevel] = modal.getSuggestions('');
		const elAll = createEl();
		const elTop = createEl();

		modal.renderSuggestion(all, elAll);
		modal.renderSuggestion(topLevel, elTop);

		expect(elAll.createEl).toHaveBeenCalledWith('div', { text: ROOT_LABEL });
		expect(elTop.createEl).toHaveBeenCalledWith('div', { text: ROOT_TOP_LEVEL_LABEL });
	});
});
