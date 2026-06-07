import type { Plugin, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { CommandRegistrar } from '../commands';
import type { NotificationManager, CheckpointManager } from '../shared';
import type { DeferredTask, CheckpointWorkItem } from '../shared';
import type { RemProposal, RemLinkCandidate } from './types';
import { generateId, getMarkdownFiles, FolderPickerModal } from '../shared';
import { MentionScanner } from './mention-scanner';
import { SemanticMatcher } from './semantic-matcher';
import { RemApplier } from './rem-applier';
import { RemStore } from './rem-store';

export type { RemProposal, RemLinkCandidate, RemOccurrence, RemSettings } from './types';

/**
 * REM (Re-link & Enrich Mappings) module.
 * Discovers linkable references in note text and proposes in-place [[wikilink]] insertions.
 */
export class RemModule {
	private store!: RemStore;
	private scanner!: MentionScanner;
	private semanticMatcher!: SemanticMatcher;
	private applier!: RemApplier;

	/** Optional callback to refresh the unified proposal view. */
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	/**
	 * Live accessor for the REM auto-accept flag (#228). Wired by main.ts to
	 * `() => this.settings.autoAccept.rem`. Defaults to "never auto-accept".
	 * NOTE: REM auto-accept REWRITES note body text (inserts [[wikilinks]]).
	 */
	private shouldAutoAccept: () => boolean = () => false;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager,
		private registrar: CommandRegistrar,
		shouldAutoAccept?: () => boolean
	) {
		if (shouldAutoAccept) this.shouldAutoAccept = shouldAutoAccept;
	}

	async onload(): Promise<void> {
		this.store = new RemStore(this.plugin.app, this.getSettings);
		this.scanner = new MentionScanner(this.plugin.app);
		this.semanticMatcher = new SemanticMatcher(this.plugin.app, this.getSettings);
		this.applier = new RemApplier();

		await this.store.init();

		// Command: scan current note
		this.registrar.register('synapse:rem-current-note', this.getSettings().rem.enabled, {
			name: 'REM: Discover links in current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.remScanNote(ctx.file.path);
				}
			},
		});

		// Command: scan directory
		this.registrar.register('synapse:rem-directory', this.getSettings().rem.enabled, {
			name: 'REM: Discover links in directory',
			callback: () => {
				new FolderPickerModal(
					this.plugin.app,
					(folder) => {
						const path = folder.isRoot() ? undefined : folder.path;
						this.remScanDirectory(path);
					}
				).open();
			},
		});
	}

	onunload(): void {
		// No timers or events to clean up
	}

	/**
	 * Scan a single note for linkable mentions.
	 */
	async remScanNote(filePath: string): Promise<RemProposal | null> {
		const settings = this.getSettings().rem;
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!file || !('extension' in file)) {
			this.notifications.info('File not found');
			return null;
		}

		const tFile = file as TFile;
		if (this.isExcluded(tFile)) {
			this.notifications.info('Note is excluded from REM scanning');
			return null;
		}

		const content = await this.plugin.app.vault.read(tFile);

		// Phase 1: literal mention scanning
		const literalCandidates = this.scanner.scan(tFile, content, settings.maxLinksPerNote);

		// Phase 2: optional semantic matching
		let semanticCandidates: RemLinkCandidate[] = [];
		if (settings.semanticMatching) {
			const alreadyMatched = new Set(literalCandidates.map(c => c.targetPath));
			const remaining = settings.maxLinksPerNote - literalCandidates.length;
			if (remaining > 0) {
				semanticCandidates = await this.semanticMatcher.match(
					tFile, content, alreadyMatched, remaining
				);
				// Filter by confidence threshold
				semanticCandidates = semanticCandidates.filter(
					c => c.confidence >= settings.confidenceThreshold
				);
			}
		}

		const allCandidates = [...literalCandidates, ...semanticCandidates];

		if (allCandidates.length === 0) {
			this.notifications.info('No linkable mentions found');
			return null;
		}

		const proposal: RemProposal = {
			id: generateId(),
			sourceNotePath: filePath,
			createdAt: new Date().toISOString(),
			candidates: allCandidates,
			status: 'pending',
		};

		await this.store.save(proposal);
		this.notifications.success(
			`Found ${allCandidates.length} linkable mention${allCandidates.length === 1 ? '' : 's'}`
		);

		// Single-note path: auto-accept the whole proposal if enabled (#228).
		await this.maybeAutoAccept(proposal);

		await this.refreshView();
		return proposal;
	}

	/**
	 * Scan all markdown files in a directory (or vault root) with checkpoint support.
	 */
	async remScanDirectory(folderPath?: string, _skipConfirmation = false, onlyFile?: TFile): Promise<number> {
		const settings = this.getSettings().rem;
		let allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		// Per-file scoping (#111): narrow to the single requested note.
		if (onlyFile) allFiles = allFiles.filter(f => f.path === onlyFile.path);

		// Filter out excluded files
		const eligible = allFiles.filter(f => !this.isExcluded(f));

		if (eligible.length === 0) {
			this.notifications.info('No eligible files found');
			return 0;
		}

		const op = this.notifications.startOperation(
			`REM scanning ${eligible.length} notes`,
			'rem-directory-scan'
		);

		// Create checkpoint
		const checkpointItems: CheckpointWorkItem[] = eligible.map((f, i) => ({
			id: `rem-${i}-${f.path}`,
			label: f.path,
			payload: { filePath: f.path } as Record<string, unknown>,
		}));

		const checkpoint = await this.checkpointManager.create({
			module: 'rem',
			operationLabel: `REM scan: ${folderPath || 'vault'}`,
			items: checkpointItems,
			metadata: {},
		});

		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		let created = 0;
		let autoAcceptedCount = 0;
		const createdProposalIds: string[] = [];

		try {
			for (let i = 0; i < eligible.length; i++) {
				if (op.cancelled) break;

				const file = eligible[i];
				op.progress(i + 1, eligible.length, `Scanning ${file.basename}`);

				const content = await this.plugin.app.vault.read(file);
				const candidates = this.scanner.scan(file, content, settings.maxLinksPerNote);

				// Optional semantic matching
				let semanticCandidates: RemLinkCandidate[] = [];
				if (settings.semanticMatching) {
					const alreadyMatched = new Set(candidates.map(c => c.targetPath));
					const remaining = settings.maxLinksPerNote - candidates.length;
					if (remaining > 0) {
						semanticCandidates = await this.semanticMatcher.match(
							file, content, alreadyMatched, remaining
						);
						semanticCandidates = semanticCandidates.filter(
							c => c.confidence >= settings.confidenceThreshold
						);
					}
				}

				const allCandidates = [...candidates, ...semanticCandidates];

				if (allCandidates.length > 0) {
					const proposal: RemProposal = {
						id: generateId(),
						sourceNotePath: file.path,
						createdAt: new Date().toISOString(),
						candidates: allCandidates,
						status: 'pending',
					};
					await this.store.save(proposal);
					created++;
					createdProposalIds.push(proposal.id);
					if (await this.maybeAutoAccept(proposal, true)) autoAcceptedCount++;
				}

				await this.checkpointManager.completeItem(checkpoint.id, checkpointItems[i].id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`REM scan failed -- ${msg}`);
			await this.rejectProposalBatch(createdProposalIds);
			return 0;
		}

		if (op.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			await this.rejectProposalBatch(createdProposalIds);
			op.finish('REM scan cancelled');
		} else {
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			op.finish(`REM scan complete -- ${created} note${created === 1 ? '' : 's'} with linkable mentions`);
			if (autoAcceptedCount > 0) {
				this.notifications.info(
					`Auto-accepted REM links in ${autoAcceptedCount} note${autoAcceptedCount === 1 ? '' : 's'}`
				);
			}
		}

		return created;
	}

	/**
	 * Resume a REM scan from a checkpoint.
	 */
	async resumeFromCheckpoint(checkpoint: import('../shared').Checkpoint): Promise<void> {
		const settings = this.getSettings().rem;
		const op = this.notifications.startOperation(
			'Resuming REM scan',
			'rem-resume'
		);

		const createdProposalIds: string[] = [];
		let autoAcceptedCount = 0;

		try {
			for (let i = 0; i < checkpoint.remainingItems.length; i++) {
				if (op.cancelled) break;

				const item = checkpoint.remainingItems[i];
				op.progress(i + 1, checkpoint.remainingItems.length, 'Resuming');

				const filePath = item.payload.filePath as string;
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath) as TFile | null;

				if (!file) {
					await this.checkpointManager.completeItem(checkpoint.id, item.id);
					continue;
				}

				const content = await this.plugin.app.vault.read(file);
				const candidates = this.scanner.scan(file, content, settings.maxLinksPerNote);

				if (candidates.length > 0) {
					const proposal: RemProposal = {
						id: generateId(),
						sourceNotePath: filePath,
						createdAt: new Date().toISOString(),
						candidates,
						status: 'pending',
					};
					await this.store.save(proposal);
					createdProposalIds.push(proposal.id);
					if (await this.maybeAutoAccept(proposal, true)) autoAcceptedCount++;
				}

				await this.checkpointManager.completeItem(checkpoint.id, item.id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Resume failed -- ${msg}`);
			await this.rejectProposalBatch(createdProposalIds);
			return;
		}

		if (op.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			await this.rejectProposalBatch(createdProposalIds);
		} else {
			const tasks = await this.checkpointManager.complete(checkpoint.id);
			this.dispatchDeferredTasks(tasks);
			op.finish(`Resumed -- generated ${createdProposalIds.length} proposals`);
			if (autoAcceptedCount > 0) {
				this.notifications.info(
					`Auto-accepted REM links in ${autoAcceptedCount} note${autoAcceptedCount === 1 ? '' : 's'}`
				);
			}
		}

		await this.refreshView();
	}

	/**
	 * Accept a REM proposal: apply selected links to the note.
	 *
	 * `options.silent` suppresses the success Notice and view refresh; used by
	 * batch auto-accept so callers emit one summary Notice and refresh once.
	 */
	async acceptProposal(
		id: string,
		acceptedMatchTexts: string[],
		options?: { silent?: boolean }
	): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;
		// Guard against double-acceptance (cascade safety): never rewrite the
		// note's body text twice for the same proposal.
		if (proposal.status !== 'pending') return;

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!file) {
			this.notifications.info('Source note no longer exists');
			return;
		}

		const tFile = file as TFile;
		const originalContent = await this.plugin.app.vault.read(tFile);

		// Filter candidates to only accepted ones
		const accepted = proposal.candidates.filter(
			c => acceptedMatchTexts.includes(c.matchedText)
		);

		if (accepted.length === 0) {
			await this.store.updateStatus(id, 'rejected');
			await this.refreshView();
			return;
		}

		// Apply the links
		const modifiedContent = this.applier.apply(originalContent, accepted);
		await this.plugin.app.vault.modify(tFile, modifiedContent);

		// Update proposal status with undo data
		const status = accepted.length === proposal.candidates.length
			? 'accepted' as const
			: 'partially-accepted' as const;
		await this.store.updateStatus(
			id,
			status,
			acceptedMatchTexts,
			originalContent
		);

		if (!options?.silent) {
			this.notifications.success(
				`Inserted ${accepted.length} wikilink${accepted.length === 1 ? '' : 's'}`
			);
			await this.refreshView();
		}
	}

	/**
	 * Auto-accept a freshly generated REM proposal in full (#228) — accepts
	 * every candidate match text as generated. Returns `true` when accepted.
	 *
	 * `batch` suppresses the per-proposal Notice (caller emits one summary).
	 */
	private async maybeAutoAccept(proposal: RemProposal, batch = false): Promise<boolean> {
		if (!this.shouldAutoAccept()) return false;
		const allMatchTexts = [...new Set(proposal.candidates.map(c => c.matchedText))];
		await this.acceptProposal(proposal.id, allMatchTexts, { silent: batch });
		if (!batch) {
			this.notifications.info(`Auto-accepted REM links for ${proposal.sourceNotePath}`);
		}
		return true;
	}

	/**
	 * Reject a REM proposal.
	 */
	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		await this.refreshView();
	}

	/**
	 * Undo a previously accepted proposal by restoring the original content.
	 */
	async undoProposal(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal || !proposal.originalContent) {
			this.notifications.info('Cannot undo — no original content snapshot');
			return;
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!file) {
			this.notifications.info('Source note no longer exists');
			return;
		}

		const tFile = file as TFile;
		await this.plugin.app.vault.modify(tFile, proposal.originalContent);

		// Reset proposal to pending
		await this.store.updateStatus(id, 'pending', undefined, undefined);
		this.notifications.success('Wikilinks reverted — proposal reset to pending');

		await this.refreshView();
	}

	/**
	 * Get all pending proposals (for unified view).
	 */
	async getPendingProposals(): Promise<RemProposal[]> {
		return this.store.loadPending();
	}

	/**
	 * Check if a file is excluded from REM scanning.
	 * Reuses enrichment exclude-folder and exclude-tag settings.
	 */
	private isExcluded(file: TFile): boolean {
		const enrichmentSettings = this.getSettings().enrichment;

		for (const folder of enrichmentSettings.excludeFolders) {
			if (file.path.startsWith(folder + '/') || file.path === folder) return true;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.tags) {
			const tags: string[] = Array.isArray(cache.frontmatter.tags)
				? cache.frontmatter.tags
				: [cache.frontmatter.tags];
			for (const excludeTag of enrichmentSettings.excludeTags) {
				const normalized = excludeTag.replace(/^#/, '');
				if (tags.some(t => t.replace(/^#/, '') === normalized)) return true;
			}
		}

		return false;
	}

	private async refreshView(): Promise<void> {
		await this.onViewRefreshNeeded?.();
	}

	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					this.onViewRefreshNeeded?.();
					break;
				default:
					console.warn(`[Synapse REM] Unknown deferred task type: ${task.type}`);
			}
		}
	}

	private async rejectProposalBatch(ids: string[]): Promise<void> {
		for (const id of ids) {
			await this.store.updateStatus(id, 'rejected');
		}
	}
}
