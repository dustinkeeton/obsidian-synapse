import { App, normalizePath } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import type { IllustrateProposal, IllustrateProposalStatus } from './types';

function isIllustrateProposal(v: unknown): v is IllustrateProposal {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.sourceNotePath === 'string' &&
		typeof v.status === 'string' &&
		Array.isArray(v.items)
	);
}

/** Persists illustrate proposals as JSON files, mirroring the enrichment store. */
export class IllustrateStore {
	constructor(private app: App, private getSettings: () => SynapseSettings) {}

	private get folderPath(): string {
		return this.getSettings().illustrate.proposalFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: IllustrateProposal): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
		const path = normalizePath(`${this.folderPath}/${this.fileName(proposal)}`);
		await this.app.vault.adapter.write(path, JSON.stringify(proposal, null, 2));
	}

	async load(id: string): Promise<IllustrateProposal | null> {
		for (const filePath of await this.listFiles()) {
			const proposal = await readJsonFile(this.app.vault.adapter, filePath, isIllustrateProposal);
			if (proposal && proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<IllustrateProposal[]> {
		const proposals: IllustrateProposal[] = [];
		for (const filePath of await this.listFiles()) {
			const proposal = await readJsonFile(this.app.vault.adapter, filePath, isIllustrateProposal);
			if (proposal) proposals.push(proposal);
		}
		return proposals;
	}

	async loadPending(): Promise<IllustrateProposal[]> {
		return (await this.loadAll()).filter((p) => p.status === 'pending');
	}

	async updateStatus(id: string, status: IllustrateProposalStatus, acceptedItemIds?: string[]): Promise<void> {
		const proposal = await this.load(id);
		if (!proposal) return;
		proposal.status = status;
		if (acceptedItemIds) proposal.acceptedItemIds = acceptedItemIds;
		await this.save(proposal);
	}

	private fileName(proposal: IllustrateProposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-')
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
		return `${baseName}-illustrate-${shortId}.json`;
	}

	private async listFiles(): Promise<string[]> {
		const normalized = normalizePath(this.folderPath);
		if (!(await this.app.vault.adapter.exists(normalized))) return [];
		const listing = await this.app.vault.adapter.list(normalized);
		return listing.files.filter((f) => f.endsWith('.json'));
	}
}
