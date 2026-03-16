import { App, normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { ensureFolder } from '../shared';
import { DeepDiveProposal, DeepDiveProposalStatus, DeepDiveRun } from './types';

/**
 * Persists deep dive proposals and run metadata as JSON files.
 * Proposals live in {proposalFolderPath}/proposals/.
 * Runs live in {proposalFolderPath}/runs/.
 */
export class DeepDiveStore {
	constructor(
		private app: App,
		private getSettings: () => AutoNotesSettings
	) {}

	private get basePath(): string {
		return this.getSettings().deepDive.proposalFolderPath;
	}

	private get proposalFolder(): string {
		return `${this.basePath}/proposals`;
	}

	private get runFolder(): string {
		return `${this.basePath}/runs`;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.proposalFolder);
		await ensureFolder(this.app, this.runFolder);
	}

	// ── Proposals ──

	async saveProposal(proposal: DeepDiveProposal): Promise<void> {
		await ensureFolder(this.app, this.proposalFolder);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.proposalFolder}/${fileName}`);
		await this.app.vault.adapter.write(path, JSON.stringify(proposal, null, 2));
	}

	async loadProposal(id: string): Promise<DeepDiveProposal | null> {
		const files = await this.listFiles(this.proposalFolder);
		for (const filePath of files) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				const proposal: DeepDiveProposal = JSON.parse(content);
				if (proposal.id === id) return proposal;
			} catch {
				// Skip invalid files
			}
		}
		return null;
	}

	async loadAllProposals(): Promise<DeepDiveProposal[]> {
		const files = await this.listFiles(this.proposalFolder);
		const proposals: DeepDiveProposal[] = [];
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

	async loadPendingProposals(): Promise<DeepDiveProposal[]> {
		const all = await this.loadAllProposals();
		return all.filter(p => p.status === 'pending');
	}

	async updateProposalStatus(id: string, status: DeepDiveProposalStatus): Promise<void> {
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
				const proposal: DeepDiveProposal = JSON.parse(content);
				if (proposal.id === id) {
					await this.app.vault.adapter.remove(filePath);
					return;
				}
			} catch {
				// Skip
			}
		}
	}

	/**
	 * Cascade-reject: reject a proposal and all its descendants.
	 */
	async cascadeReject(id: string): Promise<string[]> {
		const rejected: string[] = [];
		const proposal = await this.loadProposal(id);
		if (!proposal) return rejected;

		proposal.status = 'rejected';
		await this.saveProposal(proposal);
		rejected.push(id);

		for (const childId of proposal.childProposalIds) {
			const childRejected = await this.cascadeReject(childId);
			rejected.push(...childRejected);
		}

		return rejected;
	}

	async deleteAllProposals(): Promise<void> {
		const files = await this.listFiles(this.proposalFolder);
		for (const filePath of files) {
			try {
				await this.app.vault.adapter.remove(filePath);
			} catch {
				// Skip
			}
		}
	}

	// ── Runs ──

	async saveRun(run: DeepDiveRun): Promise<void> {
		await ensureFolder(this.app, this.runFolder);
		const path = normalizePath(`${this.runFolder}/${run.id}.json`);
		await this.app.vault.adapter.write(path, JSON.stringify(run, null, 2));
	}

	async loadRun(id: string): Promise<DeepDiveRun | null> {
		const path = normalizePath(`${this.runFolder}/${id}.json`);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) return null;
			const content = await this.app.vault.adapter.read(path);
			return JSON.parse(content);
		} catch {
			return null;
		}
	}

	// ── Helpers ──

	private proposalFileName(proposal: DeepDiveProposal): string {
		const baseName = proposal.topic.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 40);
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
		return `${baseName}-d${proposal.depth}-${shortId}.json`;
	}

	private async listFiles(folder: string): Promise<string[]> {
		const normalized = normalizePath(folder);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
