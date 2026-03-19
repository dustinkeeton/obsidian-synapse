import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder } from '../shared';
import { TitleProposal, TitleProposalStatus } from './types';

export class TitleProposalStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	private get folderPath(): string {
		return this.getSettings().title.proposalFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: TitleProposal): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.folderPath}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async load(id: string): Promise<TitleProposal | null> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: TitleProposal = JSON.parse(content);
			if (proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<TitleProposal[]> {
		const files = await this.listProposalFiles();
		const proposals: TitleProposal[] = [];
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

	async loadPending(): Promise<TitleProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.status === 'pending');
	}

	async loadForNote(notePath: string): Promise<TitleProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.sourceNotePath === notePath);
	}

	async updateStatus(id: string, status: TitleProposalStatus): Promise<void> {
		const proposal = await this.load(id);
		if (proposal) {
			proposal.status = status;
			await this.save(proposal);
		}
	}

	async delete(id: string): Promise<void> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: TitleProposal = JSON.parse(content);
			if (proposal.id === id) {
				await this.app.vault.adapter.remove(filePath);
				return;
			}
		}
	}

	private proposalFileName(proposal: TitleProposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-')
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9-]/g, '');
		return `${baseName}-title-${shortId}.json`;
	}

	private async listProposalFiles(): Promise<string[]> {
		const normalized = normalizePath(this.folderPath);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
