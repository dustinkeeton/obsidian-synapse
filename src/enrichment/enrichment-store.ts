import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder } from '../shared';
import { EnrichmentProposal, EnrichmentStatus } from './types';

/**
 * Persists enrichment proposals as JSON files in .synapse/enrichments/.
 * Mirrors the elaboration ProposalStore pattern.
 */
export class EnrichmentStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	private get folderPath(): string {
		return this.getSettings().enrichment.enrichmentFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: EnrichmentProposal): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.folderPath}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async load(id: string): Promise<EnrichmentProposal | null> {
		const files = await this.listFiles();
		for (const filePath of files) {
			const content = await this.app.vault.adapter.read(filePath);
			const proposal: EnrichmentProposal = JSON.parse(content);
			if (proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<EnrichmentProposal[]> {
		const files = await this.listFiles();
		const proposals: EnrichmentProposal[] = [];
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

	async loadPending(): Promise<EnrichmentProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.status === 'pending');
	}

	async loadForNote(notePath: string): Promise<EnrichmentProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.sourceNotePath === notePath);
	}

	async updateStatus(
		id: string,
		status: EnrichmentStatus,
		acceptedItems?: EnrichmentProposal['acceptedItems']
	): Promise<void> {
		const proposal = await this.load(id);
		if (!proposal) return;
		proposal.status = status;
		if (acceptedItems) {
			proposal.acceptedItems = acceptedItems;
		}
		await this.save(proposal);
	}

	async delete(id: string): Promise<void> {
		const files = await this.listFiles();
		for (const filePath of files) {
			try {
				const content = await this.app.vault.adapter.read(filePath);
				const proposal: EnrichmentProposal = JSON.parse(content);
				if (proposal.id === id) {
					await this.app.vault.adapter.remove(filePath);
					return;
				}
			} catch {
				// Skip
			}
		}
	}

	private proposalFileName(proposal: EnrichmentProposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-')
			// Strip null bytes and path traversal characters
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
		return `${baseName}-enrich-${shortId}.json`;
	}

	private async listFiles(): Promise<string[]> {
		const normalized = normalizePath(this.folderPath);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
