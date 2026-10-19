import { App, SuggestModal, TFolder } from 'obsidian';

/** All folders under `root` matching `query`; root always included, sorted root-first unless a path matches exactly (#416). */
export function suggestFolders(root: TFolder, query: string): TFolder[] {
	const lower = query.toLowerCase();
	const filtered = collectFolders(root).filter(
		f => f.isRoot() || f.path.toLowerCase().includes(lower)
	);
	return filtered.sort((a, b) => {
		const aExact = a.path.toLowerCase() === lower;
		const bExact = b.path.toLowerCase() === lower;
		if (aExact && !bExact) return -1;
		if (bExact && !aExact) return 1;
		if (a.isRoot() && !b.isRoot()) return -1;
		if (b.isRoot() && !a.isRoot()) return 1;
		return 0;
	});
}

function collectFolders(root: TFolder): TFolder[] {
	const result: TFolder[] = [root];
	const queue: TFolder[] = [root];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const child of current.children) {
			if (child instanceof TFolder) {
				result.push(child);
				queue.push(child);
			}
		}
	}
	return result;
}

export class FolderPickerModal extends SuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;
	private defaultPath: string | undefined;

	constructor(app: App, onChoose: (folder: TFolder) => void, defaultPath?: string) {
		super(app);
		this.onChoose = onChoose;
		this.defaultPath = defaultPath;
	}

	onOpen(): void {
		if (this.defaultPath) {
			this.inputEl.value = this.defaultPath;
			// Trigger re-filter by dispatching input event
			this.inputEl.dispatchEvent?.(new Event('input'));
		}
	}

	getSuggestions(query: string): TFolder[] {
		return suggestFolders(this.app.vault.getRoot(), query);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createEl('div', {
			text: folder.isRoot() ? '/ (vault root)' : folder.path,
		});
	}

	onChooseSuggestion(folder: TFolder): void {
		this.onChoose(folder);
	}
}
