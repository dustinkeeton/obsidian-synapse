import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Proposal } from '../elaboration/types';
import type { EnrichmentProposal } from '../enrichment/types';

export const UNIFIED_VIEW_TYPE = 'auto-notes-proposals';

/** Wrapper to unify elaboration and enrichment proposals in one list. */
export type UnifiedItem =
	| { kind: 'elaboration'; data: Proposal }
	| { kind: 'enrichment'; data: EnrichmentProposal };

export interface UnifiedViewCallbacks {
	// Elaboration
	onElaborationAccept: (id: string) => Promise<void>;
	onElaborationReject: (id: string) => Promise<void>;
	onElaborationDetail: (id: string) => void;
	// Enrichment
	onEnrichmentAcceptAll: (id: string) => Promise<void>;
	onEnrichmentReject: (id: string) => Promise<void>;
	onEnrichmentDetail: (id: string) => void;
}

/**
 * Single sidebar view that shows both elaboration and enrichment proposals,
 * visually distinguished by colored left borders and type badges.
 */
export class UnifiedProposalView extends ItemView {
	private items: UnifiedItem[] = [];
	private callbacks: UnifiedViewCallbacks;

	constructor(leaf: WorkspaceLeaf, callbacks: UnifiedViewCallbacks) {
		super(leaf);
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return UNIFIED_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Auto Notes Proposals';
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen(): Promise<void> {
		this.injectStyles();
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setItems(items: UnifiedItem[]): void {
		this.items = items;
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Pending Proposals' });

		if (this.items.length === 0) {
			contentEl.createEl('p', {
				text: 'No pending proposals. Scan your vault or enrich a note to get started.',
				cls: 'auto-notes-empty',
			});
			return;
		}

		// Group by source note path, keeping items from both types together
		const grouped = new Map<string, UnifiedItem[]>();
		for (const item of this.items) {
			const path = item.kind === 'elaboration'
				? item.data.sourceNotePath
				: item.data.sourceNotePath;
			const existing = grouped.get(path) || [];
			existing.push(item);
			grouped.set(path, existing);
		}

		for (const [notePath, noteItems] of grouped) {
			const section = contentEl.createDiv({ cls: 'auto-notes-proposal-group' });
			section.createEl('h4', { text: notePath });

			for (const item of noteItems) {
				if (item.kind === 'elaboration') {
					this.renderElaborationCard(section, item.data);
				} else {
					this.renderEnrichmentCard(section, item.data);
				}
			}
		}
	}

	private renderElaborationCard(container: HTMLElement, proposal: Proposal): void {
		const card = container.createDiv({ cls: 'auto-notes-proposal-card auto-notes-card--elaboration' });

		// Type badge
		card.createEl('span', { text: 'Elaboration', cls: 'auto-notes-badge auto-notes-badge--elaboration' });

		const reasons = proposal.detectionReasons.map(r => r.type).join(', ');
		card.createEl('small', { text: reasons, cls: 'auto-notes-reasons' });

		const preview = proposal.proposedAdditions.slice(0, 200);
		card.createEl('p', {
			text: preview + (proposal.proposedAdditions.length > 200 ? '...' : ''),
			cls: 'auto-notes-preview',
		});

		const actions = card.createDiv({ cls: 'auto-notes-actions' });

		const viewBtn = actions.createEl('button', { text: 'View' });
		viewBtn.addEventListener('click', () => this.callbacks.onElaborationDetail(proposal.id));

		const acceptBtn = actions.createEl('button', { text: 'Accept' });
		acceptBtn.addEventListener('click', () => this.callbacks.onElaborationAccept(proposal.id));

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => this.callbacks.onElaborationReject(proposal.id));
	}

	private renderEnrichmentCard(container: HTMLElement, proposal: EnrichmentProposal): void {
		const card = container.createDiv({ cls: 'auto-notes-proposal-card auto-notes-card--enrichment' });

		// Type badge
		card.createEl('span', { text: 'Enrichment', cls: 'auto-notes-badge auto-notes-badge--enrichment' });

		// Summary line
		const { result } = proposal;
		const parts: string[] = [];
		if (result.tags.length > 0) parts.push(`${result.tags.length} tags`);
		if (result.internalLinks.length > 0) parts.push(`${result.internalLinks.length} links`);
		if (result.externalLinks.length > 0) parts.push(`${result.externalLinks.length} refs`);
		if (result.frontmatter.length > 0) parts.push(`${result.frontmatter.length} attrs`);

		card.createEl('small', {
			text: `${proposal.triggerSource} | ${parts.join(', ')}`,
			cls: 'auto-notes-reasons',
		});

		// Tag preview
		if (result.tags.length > 0) {
			const tagPreview = result.tags
				.slice(0, 5)
				.map(t => t.tag)
				.join(', ');
			card.createEl('p', {
				text: `Tags: ${tagPreview}${result.tags.length > 5 ? '...' : ''}`,
				cls: 'auto-notes-preview',
			});
		}

		const actions = card.createDiv({ cls: 'auto-notes-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => this.callbacks.onEnrichmentDetail(proposal.id));

		const acceptBtn = actions.createEl('button', { text: 'Accept All' });
		acceptBtn.addEventListener('click', () => this.callbacks.onEnrichmentAcceptAll(proposal.id));

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => this.callbacks.onEnrichmentReject(proposal.id));
	}

	private injectStyles(): void {
		const id = 'auto-notes-unified-view-styles';
		if (document.getElementById(id)) return;

		const style = document.createElement('style');
		style.id = id;
		style.textContent = `
			.auto-notes-proposal-card {
				border-left: 3px solid var(--text-muted);
				padding: 8px 12px;
				margin: 6px 0;
				border-radius: 4px;
				background: var(--background-secondary);
			}
			.auto-notes-card--elaboration {
				border-left-color: var(--interactive-accent);
			}
			.auto-notes-card--enrichment {
				border-left-color: var(--color-green);
			}
			.auto-notes-badge {
				display: inline-block;
				font-size: 10px;
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				padding: 1px 6px;
				border-radius: 3px;
				margin-bottom: 4px;
			}
			.auto-notes-badge--elaboration {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.auto-notes-badge--enrichment {
				background: var(--color-green);
				color: var(--text-on-accent);
			}
			.auto-notes-reasons {
				display: block;
				color: var(--text-muted);
				margin: 4px 0;
			}
			.auto-notes-preview {
				font-size: 13px;
				color: var(--text-normal);
				margin: 4px 0;
			}
			.auto-notes-actions {
				display: flex;
				gap: 6px;
				margin-top: 6px;
			}
			.auto-notes-actions button {
				padding: 2px 10px;
				border-radius: 4px;
				font-size: 12px;
				cursor: pointer;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-normal);
			}
			.auto-notes-actions button:hover {
				background: var(--background-modifier-hover);
			}
			.auto-notes-proposal-group h4 {
				margin: 12px 0 4px;
				font-size: 13px;
				color: var(--text-muted);
			}
			.auto-notes-empty {
				color: var(--text-muted);
				font-style: italic;
			}
		`;
		document.head.appendChild(style);
	}
}
