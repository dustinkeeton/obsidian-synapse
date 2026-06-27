import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import { Proposal } from './types';

/**
 * Structural guard for a persisted {@link Proposal}. Permissive enough to
 * accept every currently-valid proposal (optional fields are not required),
 * strict enough to reject corrupt/foreign JSON: requires the identity and
 * status fields the store keys off of.
 */
function isProposal(v: unknown): v is Proposal {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.sourceNotePath === 'string' &&
		typeof v.status === 'string'
	);
}

export class ProposalStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	private get folderPath(): string {
		return this.getSettings().elaboration.proposalFolderPath;
	}

	async init(): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
	}

	async save(proposal: Proposal): Promise<void> {
		await ensureFolder(this.app, this.folderPath);
		const fileName = this.proposalFileName(proposal);
		const path = normalizePath(`${this.folderPath}/${fileName}`);
		const content = JSON.stringify(proposal, null, 2);
		await this.app.vault.adapter.write(path, content);
	}

	async load(id: string): Promise<Proposal | null> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isProposal
			);
			if (proposal && proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAll(): Promise<Proposal[]> {
		const files = await this.listProposalFiles();
		const proposals: Proposal[] = [];
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isProposal
			);
			// Skip missing/invalid proposal files
			if (proposal) proposals.push(proposal);
		}
		return proposals;
	}

	async loadPending(): Promise<Proposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.status === 'pending');
	}

	/**
	 * Load every proposal whose source note is exactly `notePath`.
	 *
	 * Implemented as loadAll + filter rather than a filename-prefix scan:
	 * `proposalFileName` lossily maps `/` to `-`, so the on-disk name can't be
	 * reversed to a unique note path and a prefix match would be unsafe. Counts
	 * are tiny (the per-note cap is a handful), so a full scan is cheap.
	 */
	async loadByNote(notePath: string): Promise<Proposal[]> {
		const all = await this.loadAll();
		return all.filter(p => p.sourceNotePath === notePath);
	}

	async delete(id: string): Promise<void> {
		const files = await this.listProposalFiles();
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isProposal
			);
			if (proposal && proposal.id === id) {
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
			.replace(/\//g, '-')
			// Strip null bytes and path traversal characters
			.replace(/[\0]/g, '')
			.replace(/\.\./g, '_');
		const shortId = proposal.id.slice(0, 8).replace(/[^a-zA-Z0-9-]/g, '');
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
