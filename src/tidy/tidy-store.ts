import { App, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder } from '../shared';
import { TidySnapshot } from './types';

/**
 * Stores pre-tidy snapshots so the user can undo.
 * Keeps only the most recent snapshot per file path.
 */
export class TidyStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath());
	}

	async save(snapshot: TidySnapshot): Promise<void> {
		const path = this.snapshotPath(snapshot.filePath);
		await ensureFolder(this.app, this.folderPath());
		const data = JSON.stringify(snapshot, null, 2);
		// Use adapter.write which overwrites regardless of whether the file exists
		await this.app.vault.adapter.write(path, data);
	}

	async load(filePath: string): Promise<TidySnapshot | null> {
		const path = this.snapshotPath(filePath);
		const file = this.app.vault.getAbstractFileByPath(path);
		// Bail out if the path resolves to a folder or nothing.
		if (!(file instanceof TFile)) return null;
		const content = await this.app.vault.read(file);
		return JSON.parse(content) as TidySnapshot;
	}

	async remove(filePath: string): Promise<void> {
		const path = this.snapshotPath(filePath);
		const file = this.app.vault.getAbstractFileByPath(path);
		// Only trash actual files; ignore folders / missing paths. trashFile
		// respects the user's "Deleted files" preference, so snapshots are
		// recoverable rather than permanently destroyed.
		if (file instanceof TFile) {
			await this.app.fileManager.trashFile(file);
		}
	}

	private folderPath(): string {
		return this.getSettings().tidy.snapshotFolderPath;
	}

	/** Deterministic snapshot filename derived from note path. */
	private snapshotPath(filePath: string): string {
		const safe = filePath.replace(/[/\\]/g, '__').replace(/\.md$/, '');
		return `${this.folderPath()}/${safe}.json`;
	}
}
