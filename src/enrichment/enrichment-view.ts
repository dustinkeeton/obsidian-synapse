import { ItemView, WorkspaceLeaf } from 'obsidian';
import { EnrichmentProposal } from './types';

export const ENRICHMENT_VIEW_TYPE = 'synapse-enrichment-review';

export class EnrichmentReviewView extends ItemView {
	private proposals: EnrichmentProposal[] = [];
	private onDetail: (id: string) => void;
	private onAcceptAll: (id: string) => Promise<void>;
	private onReject: (id: string) => Promise<void>;

	constructor(
		leaf: WorkspaceLeaf,
		callbacks: {
			onDetail: (id: string) => void;
			onAcceptAll: (id: string) => Promise<void>;
			onReject: (id: string) => Promise<void>;
		}
	) {
		super(leaf);
		this.onDetail = callbacks.onDetail;
		this.onAcceptAll = callbacks.onAcceptAll;
		this.onReject = callbacks.onReject;
	}

	getViewType(): string {
		return ENRICHMENT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Enrichment Proposals';
	}

	getIcon(): string {
		return 'library';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setProposals(proposals: EnrichmentProposal[]): void {
		this.proposals = proposals;
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Pending Enrichments' });

		const pending = this.proposals.filter(p => p.status === 'pending');
		if (pending.length === 0) {
			contentEl.createEl('p', {
				text: 'No pending enrichments. Enrichments are generated after elaboration or transcription.',
				cls: 'synapse-empty',
			});
			return;
		}

		// Group by source note
		const grouped = new Map<string, EnrichmentProposal[]>();
		for (const p of pending) {
			const existing = grouped.get(p.sourceNotePath) || [];
			existing.push(p);
			grouped.set(p.sourceNotePath, existing);
		}

		for (const [notePath, noteProposals] of grouped) {
			const section = contentEl.createDiv({ cls: 'synapse-enrichment-group' });
			section.createEl('h4', { text: notePath });

			for (const proposal of noteProposals) {
				const card = section.createDiv({ cls: 'synapse-enrichment-card' });

				// Summary line
				const { result } = proposal;
				const parts: string[] = [];
				if (result.tags.length > 0) parts.push(`${result.tags.length} tags`);
				if (result.internalLinks.length > 0) parts.push(`${result.internalLinks.length} links`);
				if (result.externalLinks.length > 0) parts.push(`${result.externalLinks.length} refs`);
				if (result.frontmatter.length > 0) parts.push(`${result.frontmatter.length} attrs`);

				card.createEl('small', {
					text: `${proposal.triggerSource} | ${parts.join(', ')}`,
					cls: 'synapse-enrichment-summary',
				});

				// Tag preview
				if (result.tags.length > 0) {
					const tagPreview = result.tags
						.slice(0, 5)
						.map(t => t.tag)
						.join(', ');
					card.createEl('p', {
						text: `Tags: ${tagPreview}${result.tags.length > 5 ? '...' : ''}`,
						cls: 'synapse-enrichment-preview',
					});
				}

				const actions = card.createDiv({ cls: 'synapse-actions' });

				const viewBtn = actions.createEl('button', { text: 'Review' });
				viewBtn.addEventListener('click', () => this.onDetail(proposal.id));

				const acceptBtn = actions.createEl('button', { text: 'Accept All' });
				acceptBtn.addEventListener('click', () => this.onAcceptAll(proposal.id));

				const rejectBtn = actions.createEl('button', { text: 'Reject' });
				rejectBtn.addEventListener('click', () => this.onReject(proposal.id));
			}
		}
	}
}
