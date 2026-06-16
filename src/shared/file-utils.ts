import { App, TFile, normalizePath } from 'obsidian';
import { isPathExcluded } from './exclusions';
import type { FeatureId, ExclusionSettings } from './exclusions';

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

/**
 * Like {@link getMarkdownFiles}, but additionally drops any file excluded for
 * `feature` by the centralized exclusion rules (#323). Use this for the
 * candidate/index enumerations — tag indexes, title maps, link/mention/semantic
 * candidate lists — so notes in an excluded folder are never offered as a link,
 * tag, or match target, mirroring how each flow already skips them as a
 * processing source.
 */
export function getIncludedMarkdownFiles(
	app: App,
	feature: FeatureId,
	settings: ExclusionSettings,
	folder?: string
): TFile[] {
	return getMarkdownFiles(app, folder).filter(
		f => !isPathExcluded(f.path, feature, settings)
	);
}

export function wordCount(text: string): number {
	return text.split(/\s+/).filter(w => w.length > 0).length;
}
