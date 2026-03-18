import { Plugin, TFile, normalizePath } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	FolderPickerModal, getMarkdownFiles, NotificationManager, ensureFolder,
	writeNote, generateOrganizeSummary, CheckpointManager, generateId,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import type { MoveRecord } from '../shared';
import { ContentAnalyzer } from './content-analyzer';
import { DirectoryMatcher } from './directory-matcher';
import { OrganizeStore } from './organize-store';
import { OrganizeProposal, OrganizeResult, OrganizeSnapshot } from './types';

export type {
	OrganizeProposal,
	OrganizeSnapshot,
	OrganizeResult,
	ContentAnalysis,
	DirectoryScore,
	NoteTopic,
	OrganizeAction,
	OrganizeProposalStatus,
} from './types';
export { ContentAnalyzer } from './content-analyzer';
export { DirectoryMatcher } from './directory-matcher';

export class OrganizeModule {
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	private analyzer: ContentAnalyzer;
	private matcher: DirectoryMatcher;
	private store: OrganizeStore;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager
	) {
		this.analyzer = new ContentAnalyzer(plugin.app, getSettings);
		this.matcher = new DirectoryMatcher(plugin.app);
		this.store = new OrganizeStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.plugin.addCommand({
			id: 'synapse:organize-current-note',
			name: 'Organize current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.organizeNote(ctx.file);
				}
			},
		});

		this.plugin.addCommand({
			id: 'synapse:scan-directory-organize',
			name: 'Scan directory for organization',
			callback: () => {
				const defaultPath = this.plugin.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.plugin.app,
					(folder) => this.scanDirectory(folder.isRoot() ? undefined : folder.path),
					defaultPath
				).open();
			},
		});

		this.plugin.addCommand({
			id: 'synapse:undo-organize',
			name: 'Undo last organize on current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.undoOrganize(ctx.file);
				}
			},
		});
	}

	onunload(): void {}

	/** Get all pending proposals (for potential future unified view integration). */
	async getPendingProposals(): Promise<OrganizeProposal[]> {
		return this.store.loadPendingProposals();
	}

	/**
	 * Resume organize from a checkpoint (C1).
	 * Re-organizes the remaining files from the checkpoint.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		const genOp = this.notifications.startOperation(
			'Resuming organization',
			'organize-resume'
		);

		let movedCount = 0;
		let proposalCount = 0;
		let errorCount = 0;
		const moveRecords: MoveRecord[] = [];

		try {
			for (let i = 0; i < checkpoint.remainingItems.length; i++) {
				if (genOp.cancelled) break;

				const item = checkpoint.remainingItems[i];
				const filePath = item.payload.filePath as string;

				genOp.progress(i + 1, checkpoint.remainingItems.length, 'Resuming organization');

				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) continue;
				if (this.isExcluded(file)) continue;

				try {
					const originalPath = file.path;
					const result = await this.organizeFile(file);

					if (result) {
						if (result.movedDirectly && result.action.type === 'move') {
							movedCount++;
							const newPath = normalizePath(
								`${result.action.targetDirectory}/${file.name}`
							);
							moveRecords.push({ originalPath, newPath });
						}
						if (result.proposalCreated) proposalCount++;
					}
				} catch (error) {
					errorCount++;
					const msg = error instanceof Error ? error.message : String(error);
					console.warn(`[Synapse] Failed to organize ${file.path}: ${msg}`);
				}

				await this.checkpointManager.completeItem(checkpoint.id, item.id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Resume failed -- ${msg}`);
			return;
		}

		if (genOp.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			return;
		}

		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);

		const parts: string[] = [];
		if (movedCount > 0) parts.push(`${movedCount} moved`);
		if (proposalCount > 0) parts.push(`${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		if (errorCount > 0) parts.push(`${errorCount} failed`);
		genOp.finish(`Resumed -- ${parts.length > 0 ? parts.join(', ') : 'no changes needed'}`);

		if (moveRecords.length > 0) {
			const summaryPath = await this.writeOrganizeSummary(moveRecords);
			if (summaryPath) {
				this.notifications.info(`Organize summary saved to ${summaryPath}`);
			}
		}

		if (proposalCount > 0) {
			await this.onViewRefreshNeeded?.();
		}
	}

	/**
	 * Organize a single note. Analyzes content, determines best directory,
	 * and either moves directly or creates a proposal for new directories.
	 */
	async organizeNote(file: TFile): Promise<OrganizeResult | null> {
		if (this.isExcluded(file)) {
			this.notifications.info('Note is in an excluded folder or has an excluded tag');
			return null;
		}

		const op = this.notifications.startOperation(
			`Organizing ${file.basename}`,
			`organize-${file.path}`
		);

		try {
			const result = await this.organizeFile(file);

			if (!result) {
				op.finish('No organization needed');
				return null;
			}

			if (result.movedDirectly) {
				op.finish(`Moved to ${result.action.type === 'move' ? result.action.targetDirectory : ''}`);
			} else if (result.proposalCreated) {
				op.finish('Proposal created for new directory');
			} else {
				op.finish('Note is already well-placed');
			}

			return result;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Organization failed -- ${msg}`);
			return null;
		}
	}

	/**
	 * Scan a directory for notes to organize.
	 *
	 * Three-phase flow:
	 * 1. Collect eligible files
	 * 2. User confirmation
	 * 3. Analyze and organize each file (cancellable)
	 */
	async scanDirectory(folderPath?: string): Promise<number> {
		// Phase 1: Collect eligible files
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(
			`${scopeLabel} for organization`,
			'organize-scan'
		);

		const allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		const eligible: TFile[] = [];

		try {
			for (let i = 0; i < allFiles.length; i++) {
				scanOp.progress(i + 1, allFiles.length, scopeLabel);
				if (!this.isExcluded(allFiles[i])) {
					eligible.push(allFiles[i]);
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Scan failed -- ${msg}`);
			return 0;
		}

		scanOp.finish(`Found ${eligible.length} notes`);

		if (eligible.length === 0) {
			return 0;
		}

		// Phase 2: User confirmation
		const proceed = await this.notifications.confirm(
			`Found ${eligible.length} note${eligible.length === 1 ? '' : 's'} to analyze. Organize?`,
			{ proceedLabel: 'Organize', cancelLabel: 'Skip' }
		);

		if (!proceed) {
			this.notifications.info('Organization scan skipped');
			return 0;
		}

		// Phase 3: Analyze and organize (checkpointed)
		const genOp = this.notifications.startOperation(
			'Organizing notes',
			'organize-generate'
		);

		let movedCount = 0;
		let proposalCount = 0;
		let errorCount = 0;
		const moveRecords: MoveRecord[] = [];

		// Create checkpoint for resumability
		const checkpointItems: CheckpointWorkItem[] = eligible.map((f, i) => ({
			id: `org-${i}-${f.path}`,
			label: f.path,
			payload: { filePath: f.path } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'organize',
			operationLabel: `Organize: directory scan${folderPath ? ` (${folderPath})` : ''}`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		for (let i = 0; i < eligible.length; i++) {
			if (genOp.cancelled) break;

			genOp.progress(i + 1, eligible.length, 'Organizing notes');
			try {
				const originalPath = eligible[i].path;
				const result = await this.organizeFile(eligible[i]);

				if (result) {
					if (result.movedDirectly && result.action.type === 'move') {
						movedCount++;
						const newPath = normalizePath(
							`${result.action.targetDirectory}/${eligible[i].name}`
						);
						moveRecords.push({ originalPath, newPath });
					}
					if (result.proposalCreated) proposalCount++;
				}
			} catch (error) {
				errorCount++;
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[Synapse] Failed to organize ${eligible[i].path}: ${msg}`);
			}

			// Save checkpoint progress
			await this.checkpointManager.completeItem(
				checkpoint.id,
				checkpointItems[i].id
			);
		}

		if (genOp.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
			this.notifications.info('Organization cancelled');
			return movedCount + proposalCount;
		}

		// Mark checkpoint completed and dispatch deferred tasks (I1)
		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);

		const parts: string[] = [];
		if (movedCount > 0) parts.push(`${movedCount} moved`);
		if (proposalCount > 0) parts.push(`${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		if (errorCount > 0) parts.push(`${errorCount} failed`);
		genOp.finish(parts.length > 0 ? parts.join(', ') : 'No changes needed');

		// Generate organize summary with move diagram
		if (moveRecords.length > 0) {
			const summaryPath = await this.writeOrganizeSummary(moveRecords);
			if (summaryPath) {
				this.notifications.info(
					`Organize summary saved to ${summaryPath}`
				);
			}
		}

		if (proposalCount > 0) {
			await this.onViewRefreshNeeded?.();
		}

		return movedCount + proposalCount;
	}

	/**
	 * Accept a proposal: create the new directory and move the note.
	 */
	async acceptProposal(id: string): Promise<void> {
		const proposal = await this.store.loadProposal(id);
		if (!proposal) {
			this.notifications.info('Proposal not found');
			return;
		}

		try {
			// Create the new directory
			await ensureFolder(this.plugin.app, proposal.proposedDirectory);

			// Move the note
			const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
			if (!(file instanceof TFile)) {
				this.notifications.info('Source note no longer exists');
				await this.store.updateProposalStatus(id, 'rejected');
				return;
			}

			const candidatePath = normalizePath(
				`${proposal.proposedDirectory}/${file.name}`
			);

			// Skip if a file already exists at the destination
			const newPath = this.findAvailablePath(candidatePath);
			if (!newPath) {
				this.notifications.info(
					`Cannot move -- a file already exists at ${candidatePath}`
				);
				return;
			}

			// Save snapshot for undo
			const snapshot: OrganizeSnapshot = {
				id: generateId(),
				currentPath: newPath,
				originalPath: file.path,
				movedAt: new Date().toISOString(),
			};
			await this.store.saveSnapshot(snapshot);

			// Perform the move
			await this.plugin.app.vault.rename(file, newPath);

			await this.store.updateProposalStatus(id, 'accepted');
			this.notifications.success(`Moved to ${proposal.proposedDirectory}`);

			// Generate organize summary with move diagram
			const moveRecords: MoveRecord[] = [
				{ originalPath: file.path, newPath },
			];
			const summaryPath = await this.writeOrganizeSummary(moveRecords);
			if (summaryPath) {
				this.notifications.info(
					`Organize summary saved to ${summaryPath}`
				);
			}

			await this.onViewRefreshNeeded?.();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to accept proposal', error);
			throw new Error(`Accept proposal failed: ${msg}`);
		}
	}

	/**
	 * Reject a proposal: note stays where it is.
	 */
	async rejectProposal(id: string): Promise<void> {
		await this.store.updateProposalStatus(id, 'rejected');
		this.notifications.info('Proposal rejected');
		await this.onViewRefreshNeeded?.();
	}

	/**
	 * Undo an organize move: move the note back to its original location.
	 */
	private async undoOrganize(file: TFile): Promise<void> {
		const snapshot = await this.store.loadSnapshot(file.path);

		if (!snapshot) {
			this.notifications.info('No organize to undo for this note');
			return;
		}

		try {
			// Ensure original parent folder still exists
			const originalParent = snapshot.originalPath.substring(
				0,
				snapshot.originalPath.lastIndexOf('/')
			);
			if (originalParent) {
				await ensureFolder(this.plugin.app, originalParent);
			}

			await this.plugin.app.vault.rename(file, snapshot.originalPath);
			await this.store.removeSnapshot(file.path);
			this.notifications.success('Organize undone -- note moved back');
		} catch (error) {
			this.notifications.notifyError('Failed to undo organize', error);
		}
	}

	/**
	 * Core logic for organizing a single file.
	 * Returns null if the note is already well-placed.
	 */
	private async organizeFile(file: TFile): Promise<OrganizeResult | null> {
		const analysis = await this.analyzer.analyze(file);

		if (analysis.topics.length === 0) {
			return null;
		}

		const confidenceThreshold = this.getSettings().organize.organizeConfidenceThreshold;
		const action = this.matcher.determineAction(analysis, undefined, confidenceThreshold);
		const currentDir = this.getParentPath(file.path);

		if (action.type === 'move') {
			// Check if moving to a different directory
			if (action.targetDirectory === currentDir) {
				return null; // Already in the right place
			}

			// Direct move to existing directory
			const candidatePath = normalizePath(
				`${action.targetDirectory}/${file.name}`
			);

			// Skip if a file already exists at the destination
			const newPath = this.findAvailablePath(candidatePath);
			if (!newPath) {
				return null;
			}

			// Save snapshot for undo
			const snapshot: OrganizeSnapshot = {
				id: generateId(),
				currentPath: newPath,
				originalPath: file.path,
				movedAt: new Date().toISOString(),
			};
			await this.store.saveSnapshot(snapshot);

			// Perform the move
			await this.plugin.app.vault.rename(file, newPath);

			return {
				notePath: file.path,
				action,
				proposalCreated: false,
				movedDirectly: true,
			};
		}

		// New directory needed -- create a proposal
		const proposal: OrganizeProposal = {
			id: generateId(),
			sourceNotePath: file.path,
			proposedDirectory: action.targetDirectory,
			reasoning: action.reasoning,
			createdAt: new Date().toISOString(),
			status: 'pending',
		};

		await this.store.saveProposal(proposal);

		return {
			notePath: file.path,
			action,
			proposalCreated: true,
			movedDirectly: false,
		};
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings().organize;

		for (const folder of settings.excludeFolders) {
			if (file.path.startsWith(folder + '/')) return true;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.tags) {
			const fileTags: string[] = Array.isArray(cache.frontmatter.tags)
				? cache.frontmatter.tags
				: [cache.frontmatter.tags];
			for (const excludeTag of settings.excludeTags) {
				const normalized = excludeTag.startsWith('#')
					? excludeTag.slice(1)
					: excludeTag;
				if (fileTags.includes(normalized)) return true;
			}
		}

		return false;
	}

	private getParentPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
	}

	/**
	 * Check whether a file already exists at the given path.
	 * Returns the path unchanged if no conflict exists, or null if occupied.
	 */
	private findAvailablePath(candidatePath: string): string | null {
		const existing = this.plugin.app.vault.getAbstractFileByPath(candidatePath);
		if (existing) {
			console.warn(
				`[Synapse] Skipping move -- file already exists at ${candidatePath}`
			);
			return null;
		}
		return candidatePath;
	}

	/**
	 * Write an organize summary note containing a Mermaid move diagram.
	 * Summaries are stored at .synapse/organize/summaries/{date}-organize-summary.md.
	 * Returns the path of the summary note, or null on failure.
	 */
	private async writeOrganizeSummary(moves: MoveRecord[]): Promise<string | null> {
		try {
			const timestamp = new Date().toISOString();
			const summaryPath = buildSummaryPath(timestamp);
			const content = generateOrganizeSummary(moves, timestamp);
			await writeNote(this.plugin.app, summaryPath, content);
			return summaryPath;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn(`[Synapse] Failed to write organize summary: ${msg}`);
			return null;
		}
	}

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					this.onViewRefreshNeeded?.();
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

/**
 * Build the vault path for an organize summary note.
 * Format: .synapse/organize/summaries/{YYYY-MM-DD}-organize-summary.md
 * Exported for testing.
 */
export function buildSummaryPath(timestamp: string): string {
	const date = timestamp.split('T')[0] || timestamp;
	return normalizePath(`.synapse/organize/summaries/${date}-organize-summary.md`);
}
