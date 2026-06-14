import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import { OrganizeProposal, OrganizeProposalStatus, OrganizeSnapshot } from './types';

/** Structural guard for a persisted {@link OrganizeProposal}. */
function isOrganizeProposal(v: unknown): v is OrganizeProposal {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.sourceNotePath === 'string' &&
		typeof v.status === 'string'
	);
}

/**
 * Structural guard for a persisted {@link OrganizeSnapshot}. Requires the
 * path-pair fields used for undo; replaces the previous unchecked
 * `as OrganizeSnapshot` cast.
 */
function isOrganizeSnapshot(v: unknown): v is OrganizeSnapshot {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.currentPath === 'string' &&
		typeof v.originalPath === 'string'
	);
}

/**
 * Persists organize proposals and undo snapshots as JSON files.
 * Proposals live in .synapse/organize/proposals/.
 * Snapshots live in .synapse/organize/snapshots/.
 */
export class OrganizeStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
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
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isOrganizeProposal
			);
			if (proposal && proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAllProposals(): Promise<OrganizeProposal[]> {
		const files = await this.listFiles(this.proposalFolder);
		const proposals: OrganizeProposal[] = [];
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isOrganizeProposal
			);
			// Skip missing/invalid files
			if (proposal) proposals.push(proposal);
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
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isOrganizeProposal
			);
			if (proposal && proposal.id === id) {
				await this.app.vault.adapter.remove(filePath);
				return;
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
		return readJsonFile(this.app.vault.adapter, path, isOrganizeSnapshot);
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
