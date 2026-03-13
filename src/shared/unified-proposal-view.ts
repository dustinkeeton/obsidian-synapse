import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Proposal } from '../elaboration/types';
import type { AcceptedItems, EnrichmentProposal } from '../enrichment/types';

export const UNIFIED_VIEW_TYPE = 'auto-notes-proposals';

/** Wrapper to unify elaboration and enrichment proposals in one list. */
export type UnifiedItem =
	| { kind: 'elaboration'; data: Proposal }
	| { kind: 'enrichment'; data: EnrichmentProposal };

export interface UnifiedViewCallbacks {
	// Elaboration
	onElaborationAccept: (id: string, editedContent: string) => Promise<void>;
	onElaborationReject: (id: string) => Promise<void>;
	// Enrichment
	onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>;
	onEnrichmentReject: (id: string) => Promise<void>;
}

/**
 * Single sidebar view that shows both elaboration and enrichment proposals.
 * Three modes:
 * - List: all pending proposals grouped by note
 * - Elaboration review: editable proposed additions
 * - Enrichment review: per-item checkbox selection
 */
export class UnifiedProposalView extends ItemView {
	private items: UnifiedItem[] = [];
	private callbacks: UnifiedViewCallbacks;

	private reviewingElaboration: Proposal | null = null;
	private reviewingEnrichment: EnrichmentProposal | null = null;

	// Enrichment review selection state
	private selectedTags = new Set<string>();
	private selectedLinks = new Set<string>();
	private selectedRefs = new Set<string>();
	private selectedFrontmatter = new Set<string>();

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
		// Exit review mode if the reviewed proposal is no longer pending
		if (this.reviewingElaboration) {
			const exists = items.some(
				i => i.kind === 'elaboration' && i.data.id === this.reviewingElaboration!.id
			);
			if (!exists) this.reviewingElaboration = null;
		}
		if (this.reviewingEnrichment) {
			const exists = items.some(
				i => i.kind === 'enrichment' && i.data.id === this.reviewingEnrichment!.id
			);
			if (!exists) this.reviewingEnrichment = null;
		}
		this.render();
	}

	private render(): void {
		if (this.reviewingElaboration) {
			this.renderElaborationReview(this.reviewingElaboration);
		} else if (this.reviewingEnrichment) {
			this.renderEnrichmentReview(this.reviewingEnrichment);
		} else {
			this.renderList();
		}
	}

	/** Open a note in Obsidian's main editor pane. */
	private openNote(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file) {
			const leaf = this.app.workspace.getLeaf(false);
			leaf.openFile(file as import('obsidian').TFile);
		}
	}

	private exitReview(): void {
		this.reviewingElaboration = null;
		this.reviewingEnrichment = null;
		this.render();
	}

	// ── List Mode ──────────────────────────────────────────────

	private renderList(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('auto-notes-view-root');
		contentEl.createEl('h3', { text: 'Pending Proposals' });

		if (this.items.length === 0) {
			contentEl.createEl('p', {
				text: 'No pending proposals. Scan your vault or enrich a note to get started.',
				cls: 'auto-notes-empty',
			});
			return;
		}

		const list = contentEl.createDiv({ cls: 'auto-notes-proposal-list' });

		const grouped = new Map<string, UnifiedItem[]>();
		for (const item of this.items) {
			const path = item.data.sourceNotePath;
			const existing = grouped.get(path) || [];
			existing.push(item);
			grouped.set(path, existing);
		}

		for (const [notePath, noteItems] of grouped) {
			const section = list.createDiv({ cls: 'auto-notes-proposal-group' });
			const heading = section.createEl('h4', {
				text: notePath,
				cls: 'auto-notes-note-link',
			});
			heading.addEventListener('click', () => this.openNote(notePath));

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

		card.createEl('span', { text: 'Elaboration', cls: 'auto-notes-badge auto-notes-badge--elaboration' });

		const reasons = proposal.detectionReasons.map(r => r.type).join(', ');
		card.createEl('small', { text: reasons, cls: 'auto-notes-reasons' });

		const preview = proposal.proposedAdditions.slice(0, 200);
		card.createEl('p', {
			text: preview + (proposal.proposedAdditions.length > 200 ? '...' : ''),
			cls: 'auto-notes-preview',
		});

		const actions = card.createDiv({ cls: 'auto-notes-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.reviewingElaboration = proposal;
			this.render();
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept' });
		acceptBtn.addEventListener('click', () =>
			this.callbacks.onElaborationAccept(proposal.id, proposal.proposedAdditions)
		);

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () =>
			this.callbacks.onElaborationReject(proposal.id)
		);
	}

	private renderEnrichmentCard(container: HTMLElement, proposal: EnrichmentProposal): void {
		const card = container.createDiv({ cls: 'auto-notes-proposal-card auto-notes-card--enrichment' });

		card.createEl('span', { text: 'Enrichment', cls: 'auto-notes-badge auto-notes-badge--enrichment' });

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
		viewBtn.addEventListener('click', () => {
			this.enterEnrichmentReview(proposal);
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept All' });
		acceptBtn.addEventListener('click', () => {
			const all: AcceptedItems = {
				tags: result.tags.map(t => t.tag),
				internalLinks: result.internalLinks.map(l => l.targetPath),
				externalLinks: result.externalLinks.map(r => r.url),
				frontmatter: result.frontmatter.map(f => f.key),
			};
			this.callbacks.onEnrichmentAcceptSelected(proposal.id, all);
		});

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () =>
			this.callbacks.onEnrichmentReject(proposal.id)
		);
	}

	// ── Elaboration Review ─────────────────────────────────────

	private renderElaborationReview(proposal: Proposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('auto-notes-view-root');

		const header = contentEl.createDiv({ cls: 'auto-notes-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'auto-notes-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'auto-notes-review-title auto-notes-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		const reasons = proposal.detectionReasons
			.map(r => {
				switch (r.type) {
					case 'short-note': return `Short note (${r.wordCount} words)`;
					case 'todo-marker': return `TODO markers: ${r.markers.join(', ')}`;
					case 'empty-section': return `Empty section: "${r.heading}"`;
					case 'sparse-link': return `Linked from ${r.linkedFrom.length} notes`;
				}
			})
			.join(' | ');

		contentEl.createEl('small', { text: reasons, cls: 'auto-notes-review-reasons' });

		const editorPane = contentEl.createDiv({ cls: 'auto-notes-review-pane' });
		editorPane.createEl('div', {
			text: 'Proposed Additions',
			cls: 'auto-notes-review-pane-label auto-notes-review-pane-label--elaboration',
		});
		const textarea = editorPane.createEl('textarea', { cls: 'auto-notes-review-editor' });
		textarea.value = proposal.proposedAdditions;

		const actionBar = contentEl.createDiv({ cls: 'auto-notes-review-actions' });
		const acceptBtn = actionBar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			this.reviewingElaboration = null;
			this.callbacks.onElaborationAccept(proposal.id, textarea.value);
		});
		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingElaboration = null;
			this.callbacks.onElaborationReject(proposal.id);
		});
	}

	// ── Enrichment Review ──────────────────────────────────────

	private enterEnrichmentReview(proposal: EnrichmentProposal): void {
		this.reviewingEnrichment = proposal;
		// Default all items to selected
		this.selectedTags = new Set(proposal.result.tags.map(t => t.tag));
		this.selectedLinks = new Set(proposal.result.internalLinks.map(l => l.targetPath));
		this.selectedRefs = new Set(proposal.result.externalLinks.map(r => r.url));
		this.selectedFrontmatter = new Set(proposal.result.frontmatter.map(f => f.key));
		this.render();
	}

	private renderEnrichmentReview(proposal: EnrichmentProposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('auto-notes-view-root');

		// Header
		const header = contentEl.createDiv({ cls: 'auto-notes-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'auto-notes-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'auto-notes-review-title auto-notes-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		contentEl.createEl('small', {
			text: `${proposal.triggerSource} | ${proposal.createdAt.split('T')[0]}`,
			cls: 'auto-notes-review-reasons',
		});

		// Scrollable checklist
		const checklist = contentEl.createDiv({ cls: 'auto-notes-enrichment-checklist' });

		const { result } = proposal;

		if (result.tags.length > 0) {
			this.renderChecklistSection(checklist, 'Tags', result.tags, {
				getId: t => t.tag,
				getLabel: t => `${t.tag}  (score: ${t.weightedScore.toFixed(2)}, ${t.sources.length} files)`,
				selectedSet: this.selectedTags,
			});
		}

		if (result.internalLinks.length > 0) {
			this.renderChecklistSection(checklist, 'Related Notes', result.internalLinks, {
				getId: l => l.targetPath,
				getLabel: l => `[[${l.displayText}]] — ${l.reason}`,
				selectedSet: this.selectedLinks,
			});
		}

		if (result.externalLinks.length > 0) {
			this.renderChecklistSection(checklist, 'External References', result.externalLinks, {
				getId: r => r.url,
				getLabel: r => `${r.title} — ${r.reason}`,
				selectedSet: this.selectedRefs,
			});
		}

		if (result.frontmatter.length > 0) {
			this.renderChecklistSection(checklist, 'Frontmatter', result.frontmatter, {
				getId: f => f.key,
				getLabel: f => `${f.key}: ${JSON.stringify(f.value)}`,
				selectedSet: this.selectedFrontmatter,
			});
		}

		// Action bar
		const actionBar = contentEl.createDiv({ cls: 'auto-notes-review-actions' });

		const acceptBtn = actionBar.createEl('button', { text: 'Accept Selected', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			const accepted: AcceptedItems = {
				tags: [...this.selectedTags],
				internalLinks: [...this.selectedLinks],
				externalLinks: [...this.selectedRefs],
				frontmatter: [...this.selectedFrontmatter],
			};
			this.reviewingEnrichment = null;
			this.callbacks.onEnrichmentAcceptSelected(proposal.id, accepted);
		});

		const selectAllBtn = actionBar.createEl('button', { text: 'All' });
		selectAllBtn.addEventListener('click', () => {
			this.selectedTags = new Set(result.tags.map(t => t.tag));
			this.selectedLinks = new Set(result.internalLinks.map(l => l.targetPath));
			this.selectedRefs = new Set(result.externalLinks.map(r => r.url));
			this.selectedFrontmatter = new Set(result.frontmatter.map(f => f.key));
			this.render();
		});

		const noneBtn = actionBar.createEl('button', { text: 'None' });
		noneBtn.addEventListener('click', () => {
			this.selectedTags.clear();
			this.selectedLinks.clear();
			this.selectedRefs.clear();
			this.selectedFrontmatter.clear();
			this.render();
		});

		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingEnrichment = null;
			this.callbacks.onEnrichmentReject(proposal.id);
		});
	}

	private renderChecklistSection<T>(
		container: HTMLElement,
		title: string,
		items: T[],
		config: {
			getId: (item: T) => string;
			getLabel: (item: T) => string;
			selectedSet: Set<string>;
		}
	): void {
		const section = container.createDiv({ cls: 'auto-notes-checklist-section' });
		section.createEl('div', { text: title, cls: 'auto-notes-checklist-heading' });

		for (const item of items) {
			const id = config.getId(item);
			const label = config.getLabel(item);

			const row = section.createEl('label', { cls: 'auto-notes-checklist-row' });
			const checkbox = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
			checkbox.checked = config.selectedSet.has(id);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					config.selectedSet.add(id);
				} else {
					config.selectedSet.delete(id);
				}
			});
			row.createEl('span', { text: label });
		}
	}

	// ── Styles ─────────────────────────────────────────────────

	private injectStyles(): void {
		const id = 'auto-notes-unified-view-styles';
		if (document.getElementById(id)) return;

		const style = document.createElement('style');
		style.id = id;
		style.textContent = `
			/* ── Layout ── */
			.auto-notes-view-root {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
			}
			.auto-notes-view-root > h3 {
				flex-shrink: 0;
				margin: 0 0 8px;
				padding: 0;
			}

			/* ── List Mode ── */
			.auto-notes-proposal-list {
				flex: 1;
				overflow-y: auto;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.auto-notes-proposal-card {
				border-left: 3px solid var(--text-muted);
				padding: 8px 12px;
				margin: 6px 0;
				border-radius: 4px;
				background: var(--background-secondary);
				min-height: 100px;
				flex: 1 0 auto;
				display: flex;
				flex-direction: column;
			}
			.auto-notes-proposal-card .auto-notes-preview {
				flex: 1;
			}
			.auto-notes-proposal-card .auto-notes-actions {
				margin-top: auto;
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
				width: min-content;
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
			.auto-notes-note-link {
				cursor: pointer;
				text-decoration: underline;
				text-decoration-color: transparent;
				transition: text-decoration-color 0.15s, color 0.15s;
			}
			.auto-notes-note-link:hover {
				color: var(--text-accent);
				text-decoration-color: var(--text-accent);
			}
			.auto-notes-empty {
				color: var(--text-muted);
				font-style: italic;
			}

			/* ── Review Mode (shared) ── */
			.auto-notes-review-header {
				flex-shrink: 0;
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 6px;
			}
			.auto-notes-review-back {
				padding: 2px 8px;
				border-radius: 4px;
				font-size: 12px;
				cursor: pointer;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-muted);
				flex-shrink: 0;
			}
			.auto-notes-review-back:hover {
				color: var(--text-normal);
				border-color: var(--text-muted);
			}
			.auto-notes-review-title {
				font-weight: 600;
				font-size: 13px;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.auto-notes-review-reasons {
				flex-shrink: 0;
				display: block;
				color: var(--text-muted);
				margin-bottom: 8px;
				font-size: 11px;
			}
			.auto-notes-review-actions {
				flex-shrink: 0;
				display: flex;
				gap: 8px;
				padding: 8px 0 0;
				border-top: 1px solid var(--background-modifier-border);
				margin-top: 8px;
			}
			.auto-notes-review-actions button {
				padding: 4px 16px;
				border-radius: 4px;
				font-size: 13px;
				cursor: pointer;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-normal);
			}
			.auto-notes-review-actions button.mod-cta {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border-color: var(--interactive-accent);
			}
			.auto-notes-review-actions button:hover {
				opacity: 0.9;
			}

			/* ── Elaboration Review ── */
			.auto-notes-review-pane {
				flex: 1;
				display: flex;
				flex-direction: column;
				min-height: 0;
			}
			.auto-notes-review-pane-label {
				flex-shrink: 0;
				font-size: 11px;
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				padding: 4px 8px;
				border-radius: 4px 4px 0 0;
			}
			.auto-notes-review-pane-label--elaboration {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.auto-notes-review-editor {
				flex: 1;
				padding: 8px;
				font-size: 13px;
				font-family: var(--font-monospace);
				line-height: 1.5;
				background: var(--background-primary);
				border: 1px solid var(--interactive-accent);
				border-top: none;
				border-radius: 0 0 4px 4px;
				resize: none;
				color: var(--text-normal);
				min-height: 120px;
			}
			.auto-notes-review-editor:focus {
				outline: none;
				border-color: var(--interactive-accent-hover);
			}

			/* ── Enrichment Review (checklist) ── */
			.auto-notes-enrichment-checklist {
				flex: 1;
				overflow-y: auto;
				min-height: 0;
			}
			.auto-notes-checklist-section {
				margin-bottom: 12px;
			}
			.auto-notes-checklist-heading {
				font-size: 11px;
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				padding: 4px 8px;
				border-radius: 4px;
				background: var(--color-green);
				color: var(--text-on-accent);
				margin-bottom: 4px;
			}
			.auto-notes-checklist-row {
				display: flex;
				align-items: flex-start;
				gap: 8px;
				padding: 4px 8px;
				border-radius: 4px;
				cursor: pointer;
				font-size: 13px;
				line-height: 1.4;
			}
			.auto-notes-checklist-row:hover {
				background: var(--background-modifier-hover);
			}
			.auto-notes-checklist-row input[type="checkbox"] {
				margin-top: 2px;
				flex-shrink: 0;
			}
			.auto-notes-checklist-row span {
				color: var(--text-normal);
				word-break: break-word;
			}
		`;
		document.head.appendChild(style);
	}
}
