import { App, TFile, normalizePath } from 'obsidian';

export async function ensureFolder(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (!existing) {
		try {
			await app.vault.createFolder(normalized);
		} catch (e) {
			// Folder may already exist on disk but not in vault cache (e.g. during plugin reload)
			if (!(e instanceof Error) || !e.message.includes('Folder already exists')) {
				throw e;
			}
		}
	}
}

export async function readNote(app: App, path: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	if (file instanceof TFile) {
		return app.vault.read(file);
	}
	return null;
}

export async function writeNote(
	app: App,
	path: string,
	content: string
): Promise<TFile> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => content);
		return existing;
	}
	// Ensure parent folder exists
	const parentPath = normalized.substring(0, normalized.lastIndexOf('/'));
	if (parentPath) {
		await ensureFolder(app, parentPath);
	}
	return app.vault.create(normalized, content);
}

export function getMarkdownFiles(app: App, folder?: string): TFile[] {
	const files = app.vault.getMarkdownFiles();
	if (!folder) return files;
	const normalized = normalizePath(folder);
	return files.filter(f => f.path.startsWith(normalized + '/'));
}

export function wordCount(text: string): number {
	return text.split(/\s+/).filter(w => w.length > 0).length;
}
