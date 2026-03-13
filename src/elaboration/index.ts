import { Notice, Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { notifyError, sanitizeAIResponse } from '../shared';
import { PlaceholderDetector } from './detector';
import { ProposalDetailModal } from './proposal-modal';
import { ProposalStore } from './proposal-store';
import { PROPOSAL_VIEW_TYPE, ProposalReviewView } from './proposal-view';
import { ProposalGenerator } from './proposer';

export { PROPOSAL_VIEW_TYPE } from './proposal-view';
export type { DetectionReason, DetectionResult, Proposal } from './types';

export class ElaborationModule {
	private detector: PlaceholderDetector;
	private proposer: ProposalGenerator;
	private store: ProposalStore;
	private scanInterval: number | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings
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
			// Delay startup scan to let vault index
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

	async scanVault(): Promise<number> {
		try {
			new Notice('Auto Notes: Scanning vault...');
			const files = this.plugin.app.vault.getMarkdownFiles();
			let proposalCount = 0;

			for (const file of files) {
				const result = await this.detector.detect(file);
				if (result) {
					const proposal = await this.proposer.generate(result);
					await this.store.save(proposal);
					proposalCount++;
				}
			}

			new Notice(`Auto Notes: Found ${proposalCount} notes to elaborate`);
			await this.refreshProposalView();
			return proposalCount;
		} catch (error) {
			notifyError('Vault scan failed', error);
			return 0;
		}
	}

	async scanNote(file: TFile): Promise<void> {
		try {
			const result = await this.detector.detect(file);
			if (result) {
				const proposal = await this.proposer.generate(result);
				await this.store.save(proposal);
				new Notice('Auto Notes: Proposal generated');
				await this.refreshProposalView();
			} else {
				new Notice('Auto Notes: Note does not appear to be a stub');
			}
		} catch (error) {
			notifyError('Note scan failed', error);
		}
	}

	async acceptProposal(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) return;

		const content = await this.plugin.app.vault.read(file);
		const sanitizedAdditions = sanitizeAIResponse(proposal.proposedAdditions);
		const newContent = content + '\n\n' + sanitizedAdditions;
		await this.plugin.app.vault.modify(file, newContent);

		await this.store.updateStatus(id, 'accepted');
		new Notice('Auto Notes: Proposal accepted');
		await this.refreshProposalView();
	}

	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		new Notice('Auto Notes: Proposal rejected');
		await this.refreshProposalView();
	}

	private async showProposalDetail(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		new ProposalDetailModal(this.plugin.app, proposal, {
			onAccept: async (editedContent) => {
				const file = this.plugin.app.vault.getAbstractFileByPath(
					proposal.sourceNotePath
				);
				if (!(file instanceof TFile)) return;

				const content = await this.plugin.app.vault.read(file);
				const sanitizedContent = sanitizeAIResponse(editedContent);
				await this.plugin.app.vault.modify(
					file,
					content + '\n\n' + sanitizedContent
				);
				await this.store.updateStatus(id, 'accepted');
				new Notice('Auto Notes: Proposal accepted');
				await this.refreshProposalView();
			},
			onReject: async () => {
				await this.rejectProposal(id);
			},
		});
	}

	private async clearProposals(): Promise<void> {
		const pending = await this.store.loadPending();
		for (const p of pending) {
			await this.store.delete(p.id);
		}
		new Notice(`Auto Notes: Cleared ${pending.length} proposals`);
		await this.refreshProposalView();
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
