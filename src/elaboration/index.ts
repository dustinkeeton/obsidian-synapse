import { Plugin, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { CommandRegistrar, isInFlow } from '../commands';
import {
	buildCallout, CALLOUT_TYPES, FolderPickerModal, getMarkdownFiles,
	NotificationManager, sanitizeAIResponse, stripCodeFences, CheckpointManager, generateId,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { PlaceholderDetector } from './detector';
import { ProposalStore } from './proposal-store';
import { ProposalGenerator } from './proposer';
import { DetectionResult, Proposal } from './types';

export type { DetectionReason, DetectionResult, Proposal } from './types';

export class ElaborationModule {
	private detector: PlaceholderDetector;
	private proposer: ProposalGenerator;
	private store: ProposalStore;
	private scanInterval: number | null = null;
	private startupTimeout: number | null = null;

	/** Optional callback invoked after a proposal is accepted. Wired by main.ts for enrichment. */
	onProposalAccepted: ((filePath: string) => void) | null = null;

	/** Optional callback to refresh the unified proposal view. Wired by main.ts. */
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	/**
	 * Live accessor for the elaboration auto-accept flag (#228). Wired by
	 * main.ts to `() => this.settings.autoAccept.elaboration` so a settings
	 * change takes effect without a reload. Defaults to "never auto-accept".
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
		this.detector = new PlaceholderDetector(plugin.app, getSettings);
		this.proposer = new ProposalGenerator(plugin.app, getSettings);
		this.store = new ProposalStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.registrar.register('scan-vault', this.getSettings().elaboration.enabled, {
			name: 'Scan vault for stub notes',
			callback: () => {
				const defaultPath = this.plugin.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.plugin.app,
					(folder) => this.scanVault(folder.isRoot() ? undefined : folder.path),
					defaultPath
				).open();
			},
		});

		this.registrar.register('scan-current-note', this.getSettings().elaboration.enabled, {
			name: 'Scan current note for elaboration',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.scanNote(ctx.file);
				}
			},
		});

		this.registrar.register('clear-proposals', this.getSettings().elaboration.enabled, {
			name: 'Clear all pending proposals',
			callback: () => this.clearProposals(),
		});

		const settings = this.getSettings().elaboration;
		if (settings.scanOnStartup && isInFlow('scan-vault', 'startup')) {
			this.startupTimeout = window.setTimeout(() => this.scanVault(), 5000);
		}

		if (settings.autoScanInterval > 0 && isInFlow('scan-vault', 'startup')) {
			this.scanInterval = window.setInterval(
				() => this.scanVault(),
				settings.autoScanInterval * 60 * 1000
			);
		}
	}

	onunload(): void {
		if (this.startupTimeout !== null) {
			window.clearTimeout(this.startupTimeout);
			this.startupTimeout = null;
		}
		if (this.scanInterval !== null) {
			window.clearInterval(this.scanInterval);
		}
	}

	/** Get all pending proposals (called by main.ts for the unified view). */
	async getPendingProposals(): Promise<Proposal[]> {
		return this.store.loadPending();
	}

	/**
	 * Resume elaboration from a checkpoint (C1).
	 * Re-generates proposals for the remaining detected files.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		const genOp = this.notifications.startOperation(
			'Resuming elaboration',
			'vault-generate-resume'
		);
		const createdProposalIds: string[] = [];
		let proposalCount = 0;
		let autoAcceptedCount = 0;

		try {
			for (let i = 0; i < checkpoint.remainingItems.length; i++) {
				if (genOp.cancelled) break;

				const item = checkpoint.remainingItems[i];
				const notePath = item.payload.notePath as string;

				genOp.progress(i + 1, checkpoint.remainingItems.length, 'Resuming elaboration');

				const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
				if (!(file instanceof TFile)) continue;

				const result = await this.detector.detect(file);
				if (!result) continue;

				const proposal = await this.proposer.generate(result);
				await this.store.save(proposal);
				createdProposalIds.push(proposal.id);
				proposalCount++;
				if (await this.maybeAutoAccept(proposal, true)) autoAcceptedCount++;

				await this.checkpointManager.completeItem(checkpoint.id, item.id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Resume failed -- ${msg}`);
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshView();
			return;
		}

		if (genOp.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshView();
			return;
		}

		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);
		genOp.finish(`Resumed -- generated ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		if (autoAcceptedCount > 0) {
			this.notifications.info(
				`Auto-accepted ${autoAcceptedCount} elaboration proposal${autoAcceptedCount === 1 ? '' : 's'}`
			);
		}
		await this.refreshView();
	}

	/**
	 * Two-phase vault scan:
	 * 1. Lightweight detection pass -- identifies stub notes (no API calls)
	 * 2. Confirmation snackbar -- user decides whether to generate proposals
	 * 3. Heavy proposal generation with cancellation support
	 */
	async scanVault(folderPath?: string, skipConfirmation = false, onlyFile?: TFile): Promise<number> {
		// --- Phase 1: Detection (lightweight, local-only) ---
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(scopeLabel, 'vault-scan');
		let files = getMarkdownFiles(this.plugin.app, folderPath);
		// Per-file scoping (#111): narrow to the single requested note.
		if (onlyFile) files = files.filter(f => f.path === onlyFile.path);
		const detected: DetectionResult[] = [];

		try {
			for (let i = 0; i < files.length; i++) {
				scanOp.progress(i + 1, files.length, scopeLabel);
				const result = await this.detector.detect(files[i]);
				if (result) {
					detected.push(result);
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Vault scan failed -- ${msg}`);
			return 0;
		}

		scanOp.finish(`Found ${detected.length} stub notes`);

		if (detected.length === 0) {
			return 0;
		}

		// --- Phase 2: Confirmation (skipped when called from Fire Synapse) ---
		if (!skipConfirmation) {
			const proceed = await this.notifications.confirm(
				`Found ${detected.length} stub note${detected.length === 1 ? '' : 's'}. Generate proposals?`,
				{ proceedLabel: 'Generate', cancelLabel: 'Skip' }
			);

			if (!proceed) {
				this.notifications.info('Scan skipped');
				return 0;
			}
		}

		// --- Phase 3: Proposal generation (heavy, cancellable, checkpointed) ---
		const genOp = this.notifications.startOperation(
			'Generating proposals',
			'vault-generate'
		);
		const createdProposalIds: string[] = [];
		let proposalCount = 0;
		let autoAcceptedCount = 0;

		// Create checkpoint for resumability
		const checkpointItems: CheckpointWorkItem[] = detected.map((d, i) => ({
			id: `elab-${i}-${d.notePath}`,
			label: d.notePath,
			payload: { notePath: d.notePath } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'elaboration',
			operationLabel: `Elaboration: vault scan${folderPath ? ` (${folderPath})` : ''}`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		try {
			for (let i = 0; i < detected.length; i++) {
				if (genOp.cancelled) break;

				genOp.progress(i + 1, detected.length, 'Generating proposals');
				const proposal = await this.proposer.generate(detected[i]);
				await this.store.save(proposal);
				createdProposalIds.push(proposal.id);
				proposalCount++;
				if (await this.maybeAutoAccept(proposal, true)) autoAcceptedCount++;

				// Save checkpoint progress
				await this.checkpointManager.completeItem(
					checkpoint.id,
					checkpointItems[i].id
				);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Proposal generation failed -- ${msg}`);
			// Auto-reject proposals created before the error
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshView();
			return 0;
		}

		if (genOp.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
			// Auto-reject all proposals created during this cancelled run
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshView();
			return 0;
		}

		// Mark checkpoint completed and dispatch deferred tasks (I1)
		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);
		genOp.finish(`Generated ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		if (autoAcceptedCount > 0) {
			this.notifications.info(
				`Auto-accepted ${autoAcceptedCount} elaboration proposal${autoAcceptedCount === 1 ? '' : 's'}`
			);
		}
		await this.refreshView();
		return proposalCount;
	}

	async scanNote(file: TFile, userInvoked = true): Promise<void> {
		const op = this.notifications.startOperation(
			`Scanning ${file.basename}`,
			`scan-${file.path}`
		);
		try {
			const detectorResult = await this.detector.detect(file);

			// When user explicitly invoked elaboration, bypass the stub gate:
			// use detector results as hints if available, otherwise create a
			// synthetic detection result so the proposer always runs.
			let result: DetectionResult | null = detectorResult;
			if (!result && userInvoked) {
				result = { notePath: file.path, reasons: [{ type: 'user-requested' }] };
			}

			if (result) {
				op.update(`Generating proposal for ${file.basename}`);
				const proposal = await this.proposer.generate(result);
				await this.store.save(proposal);
				op.finish('Proposal generated');
				await this.maybeAutoAccept(proposal);
				await this.refreshView();
			} else {
				op.finish('Note does not appear to be a stub');
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Note scan failed -- ${msg}`);
		}
	}

	/**
	 * Accept a proposal, optionally with edited content from the review panel.
	 * If editedContent is provided, it's used instead of the stored proposedAdditions.
	 *
	 * `options.silent` suppresses the per-proposal success Notice and the view
	 * refresh; used by batch auto-accept so callers can emit a single summary
	 * Notice and refresh once.
	 */
	async acceptProposal(
		id: string,
		editedContent?: string,
		options?: { silent?: boolean }
	): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;
		// Guard against double-acceptance (cascade safety): a proposal that is
		// no longer pending has already been applied — never apply it twice.
		if (proposal.status !== 'pending') return;

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) return;

		const additions = editedContent ?? proposal.proposedAdditions;
		const sanitizedAdditions = stripCodeFences(sanitizeAIResponse(additions));
		const callout = buildCallout(
			CALLOUT_TYPES.elaboration,
			'Elaboration',
			sanitizedAdditions
		);
		await this.plugin.app.vault.process(file, (data) => data.trimEnd() + '\n' + callout);

		await this.store.updateStatus(id, 'accepted');
		if (!options?.silent) {
			this.notifications.success('Proposal accepted');
			await this.refreshView();
		}
		this.onProposalAccepted?.(proposal.sourceNotePath);
	}

	/**
	 * Auto-accept a freshly generated proposal as the unedited draft (#228),
	 * if the elaboration auto-accept flag is on. Returns `true` when accepted.
	 *
	 * `batch` suppresses the per-proposal Notice (the caller emits one summary
	 * Notice). Single-note callers get one Notice per auto-accept.
	 */
	private async maybeAutoAccept(proposal: Proposal, batch = false): Promise<boolean> {
		if (!this.shouldAutoAccept()) return false;
		await this.acceptProposal(proposal.id, proposal.proposedAdditions, { silent: batch });
		if (!batch) {
			this.notifications.info(`Auto-accepted elaboration for ${proposal.sourceNotePath}`);
		}
		return true;
	}

	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		this.notifications.info('Proposal rejected');
		await this.refreshView();
	}

	private async clearProposals(): Promise<void> {
		const pending = await this.store.loadPending();
		for (const p of pending) {
			await this.store.delete(p.id);
		}
		this.notifications.info(`Cleared ${pending.length} proposals`);
		await this.refreshView();
	}

	/** Reject a batch of proposals by id (used on cancellation/error) */
	private async rejectProposalBatch(ids: string[]): Promise<void> {
		for (const id of ids) {
			await this.store.updateStatus(id, 'rejected');
		}
		if (ids.length > 0) {
			this.notifications.info(`Auto-rejected ${ids.length} proposal${ids.length === 1 ? '' : 's'}`);
		}
	}

	private async refreshView(): Promise<void> {
		await this.onViewRefreshNeeded?.();
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

// Settings section renderer (#243)
export { renderElaborationSettings } from './settings-section';
