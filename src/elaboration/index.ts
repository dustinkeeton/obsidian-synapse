import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { blockquoteOriginal, NotificationManager, sanitizeAIResponse } from '../shared';
import { PlaceholderDetector } from './detector';
import { ProposalDetailModal } from './proposal-modal';
import { ProposalStore } from './proposal-store';
import { PROPOSAL_VIEW_TYPE, ProposalReviewView } from './proposal-view';
import { ProposalGenerator } from './proposer';
import { DetectionResult } from './types';

export { PROPOSAL_VIEW_TYPE } from './proposal-view';
export type { DetectionReason, DetectionResult, Proposal } from './types';

export class ElaborationModule {
	private detector: PlaceholderDetector;
	private proposer: ProposalGenerator;
	private store: ProposalStore;
	private scanInterval: number | null = null;

	/** Optional callback invoked after a proposal is accepted. Wired by main.ts for enrichment. */
	onProposalAccepted: ((filePath: string) => void) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager
	) {
		this.detector = new PlaceholderDetector(plugin.app, getSettings);
		this.proposer = new ProposalGenerator(plugin.app, getSettings);
		this.store = new ProposalStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.plugin.registerView(PROPOSAL_VIEW_TYPE, (leaf) => {
			return new ProposalReviewView(leaf, {
				onAccept: (id) => this.acceptProposal(id),
				onReject: (id) => this.rejectProposal(id),
				onDetail: (id) => this.showProposalDetail(id),
			});
		});

		this.plugin.addCommand({
			id: 'auto-notes:scan-vault',
			name: 'Scan vault for stub notes',
			callback: () => this.scanVault(),
		});

		this.plugin.addCommand({
			id: 'auto-notes:scan-current-note',
			name: 'Scan current note for elaboration',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.scanNote(ctx.file);
				}
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:review-proposals',
			name: 'Open proposal review sidebar',
			callback: () => this.activateProposalView(),
		});

		this.plugin.addCommand({
			id: 'auto-notes:clear-proposals',
			name: 'Clear all pending proposals',
			callback: () => this.clearProposals(),
		});

		const settings = this.getSettings().elaboration;
		if (settings.scanOnStartup) {
			setTimeout(() => this.scanVault(), 5000);
		}

		if (settings.autoScanInterval > 0) {
			this.scanInterval = window.setInterval(
				() => this.scanVault(),
				settings.autoScanInterval * 60 * 1000
			);
		}
	}

	onunload(): void {
		if (this.scanInterval !== null) {
			window.clearInterval(this.scanInterval);
		}
	}

	/**
	 * Two-phase vault scan:
	 * 1. Lightweight detection pass — identifies stub notes (no API calls)
	 * 2. Confirmation snackbar — user decides whether to generate proposals
	 * 3. Heavy proposal generation with cancellation support
	 */
	async scanVault(): Promise<number> {
		// --- Phase 1: Detection (lightweight, local-only) ---
		const scanOp = this.notifications.startOperation('Scanning vault', 'vault-scan');
		const files = this.plugin.app.vault.getMarkdownFiles();
		const detected: DetectionResult[] = [];

		try {
			for (let i = 0; i < files.length; i++) {
				scanOp.progress(i + 1, files.length, 'Scanning vault');
				const result = await this.detector.detect(files[i]);
				if (result) {
					detected.push(result);
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Vault scan failed — ${msg}`);
			return 0;
		}

		scanOp.finish(`Found ${detected.length} stub notes`);

		if (detected.length === 0) {
			return 0;
		}

		// --- Phase 2: Confirmation ---
		const proceed = await this.notifications.confirm(
			`Found ${detected.length} stub note${detected.length === 1 ? '' : 's'}. Generate proposals?`,
			{ proceedLabel: 'Generate', cancelLabel: 'Skip' }
		);

		if (!proceed) {
			this.notifications.info('Scan skipped');
			return 0;
		}

		// --- Phase 3: Proposal generation (heavy, cancellable) ---
		const genOp = this.notifications.startOperation(
			'Generating proposals',
			'vault-generate'
		);
		const createdProposalIds: string[] = [];
		let proposalCount = 0;

		try {
			for (let i = 0; i < detected.length; i++) {
				if (genOp.cancelled) break;

				genOp.progress(i + 1, detected.length, 'Generating proposals');
				const proposal = await this.proposer.generate(detected[i]);
				await this.store.save(proposal);
				createdProposalIds.push(proposal.id);
				proposalCount++;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Proposal generation failed — ${msg}`);
			// Auto-reject proposals created before the error
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshProposalView();
			return 0;
		}

		if (genOp.cancelled) {
			// Auto-reject all proposals created during this cancelled run
			await this.rejectProposalBatch(createdProposalIds);
			await this.refreshProposalView();
			return 0;
		}

		genOp.finish(`Generated ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		await this.refreshProposalView();
		return proposalCount;
	}

	async scanNote(file: TFile): Promise<void> {
		const op = this.notifications.startOperation(
			`Scanning ${file.basename}`,
			`scan-${file.path}`
		);
		try {
			const result = await this.detector.detect(file);
			if (result) {
				op.update(`Generating proposal for ${file.basename}`);
				const proposal = await this.proposer.generate(result);
				await this.store.save(proposal);
				op.finish('Proposal generated');
				await this.refreshProposalView();
			} else {
				op.finish('Note does not appear to be a stub');
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Note scan failed — ${msg}`);
		}
	}

	async acceptProposal(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) return;

		const content = await this.plugin.app.vault.read(file);
		const sanitizedAdditions = sanitizeAIResponse(proposal.proposedAdditions);
		const quotedContent = blockquoteOriginal(content);
		const newContent = quotedContent + '\n\n' + sanitizedAdditions;
		await this.plugin.app.vault.modify(file, newContent);

		await this.store.updateStatus(id, 'accepted');
		this.notifications.success('Proposal accepted');
		await this.refreshProposalView();
		this.onProposalAccepted?.(proposal.sourceNotePath);
	}

	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		this.notifications.info('Proposal rejected');
		await this.refreshProposalView();
	}

	private async showProposalDetail(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const modal = new ProposalDetailModal(this.plugin.app, proposal, {
			onAccept: async (editedContent) => {
				const file = this.plugin.app.vault.getAbstractFileByPath(
					proposal.sourceNotePath
				);
				if (!(file instanceof TFile)) return;

				const content = await this.plugin.app.vault.read(file);
				const sanitizedContent = sanitizeAIResponse(editedContent);
				const quotedContent = blockquoteOriginal(content);
				await this.plugin.app.vault.modify(
					file,
					quotedContent + '\n\n' + sanitizedContent
				);
				await this.store.updateStatus(id, 'accepted');
				this.notifications.success('Proposal accepted');
				await this.refreshProposalView();
				this.onProposalAccepted?.(proposal.sourceNotePath);
			},
			onReject: async () => {
				await this.rejectProposal(id);
			},
		});
		modal.open();
	}

	private async clearProposals(): Promise<void> {
		const pending = await this.store.loadPending();
		for (const p of pending) {
			await this.store.delete(p.id);
		}
		this.notifications.info(`Cleared ${pending.length} proposals`);
		await this.refreshProposalView();
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

	async activateProposalView(): Promise<void> {
		const { workspace } = this.plugin.app;
		let leaf = workspace.getLeavesOfType(PROPOSAL_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: PROPOSAL_VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		await this.refreshProposalView();
	}

	private async refreshProposalView(): Promise<void> {
		const leaves = this.plugin.app.workspace.getLeavesOfType(PROPOSAL_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as ProposalReviewView;
			const proposals = await this.store.loadPending();
			view.setProposals(proposals);
		}
	}
}
