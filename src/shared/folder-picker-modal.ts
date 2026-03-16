import { App, SuggestModal, TFolder } from 'obsidian';

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
		const folders = this.collectFolders(this.app.vault.getRoot());
		const lower = query.toLowerCase();
		const filtered = folders.filter(
			f => f.isRoot() || f.path.toLowerCase().includes(lower)
		);
		return filtered.sort((a, b) => {
			const aPath = a.path.toLowerCase();
			const bPath = b.path.toLowerCase();
			const aExact = aPath === lower;
			const bExact = bPath === lower;
			// Exact match always comes first
			if (aExact && !bExact) return -1;
			if (bExact && !aExact) return 1;
			// When no exact match is involved, root comes before non-root
			if (a.isRoot() && !b.isRoot()) return -1;
			if (b.isRoot() && !a.isRoot()) return 1;
			return 0;
		});
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createEl('div', {
			text: folder.isRoot() ? '/ (vault root)' : folder.path,
		});
	}

	onChooseSuggestion(folder: TFolder): void {
		this.onChoose(folder);
	}

	private collectFolders(root: TFolder): TFolder[] {
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
}
