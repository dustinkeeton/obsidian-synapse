import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import { DeepDiveProposal, DeepDiveProposalStatus, DeepDiveRun } from './types';

/**
 * Structural guard for a persisted {@link DeepDiveProposal}. Requires the
 * identity, lineage, and status fields the store relies on; tolerant of the
 * rich nested `topic`/`qualityScore` shapes (not re-validated here).
 */
function isDeepDiveProposal(v: unknown): v is DeepDiveProposal {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.runId === 'string' &&
		typeof v.sourceNotePath === 'string' &&
		typeof v.status === 'string'
	);
}

/** Structural guard for a persisted {@link DeepDiveRun}. */
function isDeepDiveRun(v: unknown): v is DeepDiveRun {
	return (
		isRecord(v) &&
		typeof v.id === 'string' &&
		typeof v.rootNotePath === 'string' &&
		typeof v.status === 'string'
	);
}

/**
 * Persists deep dive proposals and run metadata as JSON files.
 * Proposals live in {proposalFolderPath}/proposals/.
 * Runs live in {proposalFolderPath}/runs/.
 */
export class DeepDiveStore {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
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
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isDeepDiveProposal
			);
			if (proposal && proposal.id === id) return proposal;
		}
		return null;
	}

	async loadAllProposals(): Promise<DeepDiveProposal[]> {
		const files = await this.listFiles(this.proposalFolder);
		const proposals: DeepDiveProposal[] = [];
		for (const filePath of files) {
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isDeepDiveProposal
			);
			// Skip missing/invalid files
			if (proposal) proposals.push(proposal);
		}
		return proposals;
	}

	async loadPendingProposals(): Promise<DeepDiveProposal[]> {
		const all = await this.loadAllProposals();
		return all.filter(p => p.status === 'pending');
	}

	async loadProposalsByRunId(runId: string): Promise<DeepDiveProposal[]> {
		const all = await this.loadAllProposals();
		return all.filter(p => p.runId === runId);
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
			const proposal = await readJsonFile(
				this.app.vault.adapter,
				filePath,
				isDeepDiveProposal
			);
			if (proposal && proposal.id === id) {
				await this.app.vault.adapter.remove(filePath);
				return;
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
		return readJsonFile(this.app.vault.adapter, path, isDeepDiveRun);
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
