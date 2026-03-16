import { App, normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { ensureFolder } from '../shared';
import { OrganizeProposal, OrganizeProposalStatus, OrganizeSnapshot } from './types';

/**
 * Persists organize proposals and undo snapshots as JSON files.
 * Proposals live in .auto-notes/organize/proposals/.
 * Snapshots live in .auto-notes/organize/snapshots/.
 */
export class OrganizeStore {
	constructor(
		private app: App,
		private getSettings: () => AutoNotesSettings
	) {}

	private get proposalFolder(): string {
		return this.getSettings().organize.proposalFolderPath;
	}

	private get snapshotFolder(): string {
		return this.getSettings().organize.snapshotFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.proposalFolder);
		await ensureFolder(this.app, this.snapshotFolder);
	}

	// ── Proposals ──

	async saveProposal(proposal: OrganizeProposal): Promise<void> {
		await ensureFolder(this.app, this.proposalFolder);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.proposalFolder}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async loadProposal(id: string): Promise<OrganizeProposal | null> {
		const files = await this.listFiles(this.proposalFolder);
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: OrganizeProposal = JSON.parse(content);
			if (proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAllProposals(): Promise<OrganizeProposal[]> {
		const files = await this.listFiles(this.proposalFolder);
		const proposals: OrganizeProposal[] = [];
		for (const filePath of files) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				proposals.push(JSON.parse(content));
			} catch {
				// Skip invalid files
			}
		}
		return proposals;
	}

	async loadPendingProposals(): Promise<OrganizeProposal[]> {
		const all = await this.loadAllProposals();
		return all.filter(p => p.status === 'pending');
	}

	async updateProposalStatus(id: string, status: OrganizeProposalStatus): Promise<void> {
		const proposal = await this.loadProposal(id);
		if (!proposal) return;
		proposal.status = status;
		await this.saveProposal(proposal);
	}

	async deleteProposal(id: string): Promise<void> {
		const files = await this.listFiles(this.proposalFolder);
		for (const filePath of files) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				const proposal: OrganizeProposal = JSON.parse(content);
				if (proposal.id === id) {
					await this.app.vault.adapter.remove(filePath);
					return;
				}
			} catch {
				// Skip
			}
		}
	}

	// ── Snapshots (undo) ──

	async saveSnapshot(snapshot: OrganizeSnapshot): Promise<void> {
		await ensureFolder(this.app, this.snapshotFolder);
		const path = this.snapshotPath(snapshot.currentPath);
		const data = JSON.stringify(snapshot, null, 2);
		await this.app.vault.adapter.write(path, data);
	}

	async loadSnapshot(currentPath: string): Promise<OrganizeSnapshot | null> {
		const path = this.snapshotPath(currentPath);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) return null;
			const content = await this.app.vault.adapter.read(path);
			return JSON.parse(content) as OrganizeSnapshot;
		} catch {
			return null;
		}
	}

	async removeSnapshot(currentPath: string): Promise<void> {
		const path = this.snapshotPath(currentPath);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (exists) {
				await this.app.vault.adapter.remove(path);
			}
		} catch {
			// Ignore
		}
	}

	// ── Helpers ──

	private proposalFileName(proposal: OrganizeProposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-')
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
		return `${baseName}-organize-${shortId}.json`;
	}

	private snapshotPath(currentPath: string): string {
		const safe = currentPath.replace(/[/\\]/g, '__').replace(/\.md$/, '');
		return normalizePath(`${this.snapshotFolder}/${safe}.json`);
	}

	private async listFiles(folder: string): Promise<string[]> {
		const normalized = normalizePath(folder);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
