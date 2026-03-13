import { App, normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { ensureFolder } from '../shared';
import { Proposal } from './types';

export class ProposalStore {
	constructor(
		private app: App,
		private getSettings: () => AutoNotesSettings
	) {}

	private get folderPath(): string {
		return this.getSettings().elaboration.proposalFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: Proposal): Promise<void> {
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.folderPath}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async load(id: string): Promise<Proposal | null> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: Proposal = JSON.parse(content);
			if (proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<Proposal[]> {
		const files = await this.listProposalFiles();
		const proposals: Proposal[] = [];
		for (const filePath of files) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				proposals.push(JSON.parse(content));
			} catch {
				// Skip invalid proposal files
			}
		}
		return proposals;
	}

	async loadPending(): Promise<Proposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.status === 'pending');
	}

	async delete(id: string): Promise<void> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: Proposal = JSON.parse(content);
			if (proposal.id === id) {
				await this.app.vault.adapter.remove(filePath);
				return;
			}
		}
	}

	async updateStatus(id: string, status: Proposal['status']): Promise<void> {
		const proposal = await this.load(id);
		if (proposal) {
			proposal.status = status;
			await this.save(proposal);
		}
	}

	private proposalFileName(proposal: Proposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-');
		const shortId = proposal.id.slice(0, 8);
		return `${baseName}-${shortId}.json`;
	}

	private async listProposalFiles(): Promise<string[]> {
		const normalized = normalizePath(this.folderPath);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
