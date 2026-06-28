import { ItemView, WorkspaceLeaf } from 'obsidian';
import { fireAndForget } from '../shared';
import { Proposal } from './types';

export const PROPOSAL_VIEW_TYPE = 'synapse-proposal-review';

export class ProposalReviewView extends ItemView {
	private proposals: Proposal[] = [];
	private onAccept: (id: string) => Promise<void>;
	private onReject: (id: string) => Promise<void>;
	private onDetail: (id: string) => void;

	constructor(
		leaf: WorkspaceLeaf,
		callbacks: {
			onAccept: (id: string) => Promise<void>;
			onReject: (id: string) => Promise<void>;
			onDetail: (id: string) => void;
		}
	) {
		super(leaf);
		this.onAccept = callbacks.onAccept;
		this.onReject = callbacks.onReject;
		this.onDetail = callbacks.onDetail;
	}

	getViewType(): string {
		return PROPOSAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Synapse proposals';
	}

	getIcon(): string {
		// Brand S-Signal mark (registered via addIcon in main.ts), not the
		// banned 'sparkles' Lucide glyph.
		return 'synapse';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setProposals(proposals: Proposal[]): void {
		this.proposals = proposals;
		this.render();
	}

	/**
	 * Register a synchronous click listener that wraps an async callback in
	 * {@link fireAndForget}, so a failed accept/reject no longer fails silently.
	 * The listener returns void (never the callback's promise), which satisfies
	 * `no-misused-promises`. Mirrors the helper added to the unified view in
	 * PR3 for the same #297 promise-handling pass.
	 */
	private onClick(el: HTMLElement, fn: () => Promise<unknown>, label: string): void {
		el.addEventListener('click', () => {
			fireAndForget(fn(), label);
		});
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Pending proposals' });

		const pending = this.proposals.filter(p => p.status === 'pending');
		if (pending.length === 0) {
			contentEl.createEl('p', {
				text: 'No pending proposals. Run "Scan folder for stub notes" to find them.',
				cls: 'synapse-empty',
			});
			return;
		}

		// Group by source note
		const grouped = new Map<string, Proposal[]>();
		for (const p of pending) {
			const existing = grouped.get(p.sourceNotePath) || [];
			existing.push(p);
			grouped.set(p.sourceNotePath, existing);
		}

		for (const [notePath, noteProposals] of grouped) {
			const section = contentEl.createDiv({ cls: 'synapse-proposal-group' });
			section.createEl('h4', { text: notePath });

			for (const proposal of noteProposals) {
				const card = section.createDiv({ cls: 'synapse-proposal-card' });

				const reasons = proposal.detectionReasons
					.map(r => r.type)
					.join(', ');
				card.createEl('small', { text: reasons, cls: 'synapse-reasons' });

				const preview = proposal.proposedAdditions.slice(0, 200);
				card.createEl('p', {
					text: preview + (proposal.proposedAdditions.length > 200 ? '...' : ''),
					cls: 'synapse-preview',
				});

				const actions = card.createDiv({ cls: 'synapse-actions' });

				const viewBtn = actions.createEl('button', { text: 'View' });
				viewBtn.addEventListener('click', () => this.onDetail(proposal.id));

				const acceptBtn = actions.createEl('button', { text: 'Accept' });
				this.onClick(acceptBtn, () => this.onAccept(proposal.id), 'Accept proposal');

				const rejectBtn = actions.createEl('button', { text: 'Reject' });
				this.onClick(rejectBtn, () => this.onReject(proposal.id), 'Reject proposal');
			}
		}
	}
}
