import { App, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ensureFolder, isRecord, readJsonFile } from '../shared';
import { DeepDiveProposal, DeepDiveProposalStatus, DeepDiveRun } from './types';
import { syllabusPath } from './syllabus-navigator';

type ProposalPaths = Partial<Pick<DeepDiveProposal, 'proposedPath' | 'sourceNotePath'>>;
type RunPaths = Pick<DeepDiveRun, 'rootNotePath' | 'syllabusPath'>;

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

/** A run that stopped at its note cap with topics still queued (#625). */
function isCapped(run: DeepDiveRun): boolean {
	return run.endReason === 'cap' && (run.pending?.tasks.length ?? 0) > 0;
}

/** Runs worth re-reading for the capped listing: capped, or still running (another device may cap it and sync the file). */
function isWatched(run: DeepDiveRun): boolean {
	return isCapped(run) || run.status === 'in-progress';
}

/** A run id read back from stored proposals or checkpoints becomes a file name; no separators or dots. */
const isSafeRunId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id);

/**
 * Persists deep dive proposals and run metadata as JSON files.
 * Proposals live in {proposalFolderPath}/proposals/.
 * Runs live in {proposalFolderPath}/runs/.
 */
export class DeepDiveStore {
	/**
	 * Watched run ids in `folder` (see `isWatched`), built from every run file, then kept current by `saveRun`.
	 * `files` is the folder listing it was built from; a new file (e.g. synced from another device) triggers a rebuild.
	 */
	private watched: { folder: string; files: Set<string>; ids: Set<string> } | null = null;
	/** Saves made while `watched` is being built, replayed onto it after the build. */
	private savesDuringBuild: Map<string, boolean> | null = null;
	/** The build in flight; a concurrent `loadCappedRuns` waits for it instead of starting a second one. */
	private building: Promise<void> | null = null;
	/** Every note path a record points at, and run roots (#632); rebuilt when the file listing changes or a path is followed. */
	private pathIndex: { listing: string; paths: Set<string>; roots: Set<string> } | null = null;
	/**
	 * Paths moved by a followed rename (#632), applied on every later save, so a copy loaded before the rename
	 * (an accept in flight, the generation loop's in-memory run) never writes the old path back.
	 */
	private readonly followedProposals = new Map<string, ProposalPaths>();
	private readonly followedRuns = new Map<string, RunPaths>();

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
		const followed = this.followedProposals.get(proposal.id);
		if (followed) Object.assign(proposal, followed);
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
		if (!isSafeRunId(run.id)) throw new Error('Invalid deep dive run id');
		const followed = this.followedRuns.get(run.id);
		if (followed) {
			run.rootNotePath = followed.rootNotePath;
			run.syllabusPath = followed.syllabusPath;
		}
		await ensureFolder(this.app, this.runFolder);
		const path = normalizePath(`${this.runFolder}/${run.id}.json`);
		await this.app.vault.adapter.write(path, JSON.stringify(run, null, 2));
		this.savesDuringBuild?.set(run.id, isWatched(run));
		if (this.watched?.folder === this.runFolder) {
			this.watched.files.add(path);
			if (isWatched(run)) this.watched.ids.add(run.id);
			else this.watched.ids.delete(run.id);
		}
	}

	async loadRun(id: string): Promise<DeepDiveRun | null> {
		if (!isSafeRunId(id)) return null;
		const path = normalizePath(`${this.runFolder}/${id}.json`);
		return readJsonFile(this.app.vault.adapter, path, isDeepDiveRun);
	}

	/** Capped runs (#625): lists the run folder, then reads only watched runs' files unless the listing gained a file. */
	async loadCappedRuns(): Promise<DeepDiveRun[]> {
		const folder = this.runFolder;
		const files = await this.listFiles(folder);
		const known = this.watched?.folder === folder ? this.watched : null;
		if (!known || files.some(f => !known.files.has(f))) {
			this.building ??= this.buildWatched(folder, files).finally(() => { this.building = null; });
			await this.building;
		}
		const ids = this.watched?.ids ?? new Set<string>();
		const runs: DeepDiveRun[] = [];
		for (const id of [...ids]) {
			const run = await this.loadRun(id);
			if (run && isCapped(run)) runs.push(run);
			else if (!run || !isWatched(run)) ids.delete(id);
		}
		return runs;
	}

	private async buildWatched(folder: string, files: string[]): Promise<void> {
		const saves = new Map<string, boolean>();
		this.savesDuringBuild = saves;
		try {
			const ids = new Set((await this.loadAllRuns()).filter(isWatched).map(run => run.id));
			for (const [id, watched] of saves) {
				if (watched) ids.add(id);
				else ids.delete(id);
			}
			this.watched = { folder, files: new Set(files), ids };
		} finally {
			this.savesDuringBuild = null;
		}
	}

	async loadAllRuns(): Promise<DeepDiveRun[]> {
		const runs: DeepDiveRun[] = [];
		for (const path of await this.listFiles(this.runFolder)) {
			const run = await readJsonFile(this.app.vault.adapter, path, isDeepDiveRun);
			if (run) runs.push(run);
		}
		return runs;
	}

	// ── Rename following (#632) ──

	/** Records a proposal's moved paths; this and every later save of the proposal carries them. */
	followProposal(id: string, paths: ProposalPaths): void {
		this.followedProposals.set(id, { ...this.followedProposals.get(id), ...paths });
		this.pathIndex = null;
	}

	/** Records a run's moved root and syllabus; this and every later save of the run carries them. */
	followRun(id: string, paths: RunPaths): void {
		this.followedRuns.set(id, paths);
		this.pathIndex = null;
	}

	/** Whether any record may point at `path` or inside it, so an unrelated rename reads no record. */
	async mayReference(path: string, noteOutputFolder: string): Promise<boolean> {
		const listing = JSON.stringify([await this.listFiles(this.proposalFolder), await this.listFiles(this.runFolder)]);
		if (this.pathIndex?.listing !== listing) {
			const paths = new Set<string>();
			const roots = new Set<string>();
			for (const proposal of await this.loadAllProposals()) {
				paths.add(proposal.proposedPath);
				paths.add(proposal.sourceNotePath);
			}
			for (const run of await this.loadAllRuns()) {
				roots.add(run.rootNotePath);
				paths.add(run.rootNotePath);
				if (run.syllabusPath) paths.add(run.syllabusPath);
			}
			this.pathIndex = { listing, paths, roots };
		}
		const under = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`);
		for (const candidate of this.pathIndex.paths) if (under(candidate)) return true;
		for (const root of this.pathIndex.roots) if (under(syllabusPath(root, noteOutputFolder))) return true;
		return false;
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
