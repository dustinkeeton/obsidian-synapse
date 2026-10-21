import { App, SuggestModal, TFolder } from 'obsidian';
import { suggestFolders } from './folder-picker-modal';
import type { ScanScope } from './scan-scope';

export interface ScanFolderSuggestion {
	folder: TFolder;
	recursive: boolean;
}

/** Undocumented SuggestModal internal; used only to route Shift+Enter through the normal choose path. */
interface SuggestChooser {
	useSelectedItem(evt: KeyboardEvent): boolean;
}

export const ROOT_LABEL = '/ (vault root)';
export const ROOT_TOP_LEVEL_LABEL = '/ (vault root — top level only)';

/** Folder picker for scans: Enter = folder + subfolders, Shift+Enter = this folder only; a top-level root row sits right after root (#589). */
export class ScanFolderPickerModal extends SuggestModal<ScanFolderSuggestion> {
	constructor(app: App, private readonly onChoose: (scope: ScanScope) => void) {
		super(app);
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to scan folder and subfolders' },
			{ command: 'shift ↵', purpose: 'to scan this folder only' },
			{ command: 'esc', purpose: 'to dismiss' },
		]);
		this.scope.register(['Shift'], 'Enter', (evt) => {
			if (evt.isComposing) return;
			(this as unknown as { chooser?: SuggestChooser }).chooser?.useSelectedItem(evt);
			return false;
		});
	}

	getSuggestions(query: string): ScanFolderSuggestion[] {
		const out: ScanFolderSuggestion[] = [];
		for (const folder of suggestFolders(this.app.vault.getRoot(), query)) {
			out.push({ folder, recursive: true });
			if (folder.isRoot()) out.push({ folder, recursive: false });
		}
		return out;
	}

	renderSuggestion(item: ScanFolderSuggestion, el: HTMLElement): void {
		el.createEl('div', { text: suggestionLabel(item) });
	}

	onChooseSuggestion(item: ScanFolderSuggestion, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose({
			folder: item.folder.isRoot() ? undefined : item.folder.path,
			recursive: item.recursive && !evt.shiftKey,
		});
	}
}

function suggestionLabel({ folder, recursive }: ScanFolderSuggestion): string {
	if (!folder.isRoot()) return folder.path;
	return recursive ? ROOT_LABEL : ROOT_TOP_LEVEL_LABEL;
}
