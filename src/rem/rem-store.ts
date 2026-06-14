import { App, normalizePath } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import type { RemProposal, RemProposalStatus } from './types';

/**
 * Structural guard for a persisted {@link RemProposal}. Requires the identity,
 * source, and status fields the store keys off of; the `candidates` array is
 * not re-validated here.
 */
function isRemProposal(v: unknown): v is RemProposal {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.sourceNotePath === 'string' &&
		typeof v.status === 'string'
	);
}

/**
 * Persists REM proposals as JSON files.
 * Follows the same pattern as EnrichmentStore.
 */
export class RemStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	private get folderPath(): string {
		return this.getSettings().rem.remFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: RemProposal): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.folderPath}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async load(id: string): Promise<RemProposal | null> {
		const files = await this.listFiles();
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isRemProposal
			);
			if (proposal && proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<RemProposal[]> {
		const files = await this.listFiles();
		const proposals: RemProposal[] = [];
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isRemProposal
			);
			// Skip missing/invalid files
			if (proposal) proposals.push(proposal);
		}
		return proposals;
	}

	async loadPending(): Promise<RemProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.status === 'pending');
	}

	async loadForNote(notePath: string): Promise<RemProposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.sourceNotePath === notePath);
	}

	async updateStatus(
		id: string,
		status: RemProposalStatus,
		acceptedLinks?: string[],
		originalContent?: string
	): Promise<void> {
		const proposal = await this.load(id);
		if (!proposal) return;
		proposal.status = status;
		if (acceptedLinks) {
			proposal.acceptedLinks = acceptedLinks;
		}
		if (originalContent !== undefined) {
			proposal.originalContent = originalContent;
		}
		await this.save(proposal);
	}

	async delete(id: string): Promise<void> {
		const files = await this.listFiles();
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isRemProposal
			);
			if (proposal && proposal.id === id) {
				await this.app.vault.adapter.remove(filePath);
				return;
			}
		}
	}

	private proposalFileName(proposal: RemProposal): string {
		const baseName = proposal.sourceNotePath
			.replace(/\.md$/, '')
			.replace(/\//g, '-')
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
		return `${baseName}-rem-${shortId}.json`;
	}

	private async listFiles(): Promise<string[]> {
		const normalized = normalizePath(this.folderPath);
		const exists = await this.app.vault.adapter.exists(normalized);
		if (!exists) return [];
		const files = await this.app.vault.adapter.list(normalized);
		return files.files.filter(f => f.endsWith('.json'));
	}
}
