import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Proposal } from '../elaboration';
import type { AcceptedItems, EnrichmentProposal } from '../enrichment';
import type { OrganizeProposal } from '../organize';
import type { DeepDiveProposal } from '../deep-dive';
import type { TitleProposal } from '../title';
import type { RemProposal } from '../rem';
import type { Checkpoint, NotificationManager } from '../shared';
import { fireAndForget } from '../shared';
import type { UnifiedItem, UnifiedViewCallbacks } from './types';
import { badgeClass, cardClass, reviewPaneLabelClass } from './proposal-styles';

export { type UnifiedItem, type UnifiedViewCallbacks } from './types';

export const UNIFIED_VIEW_TYPE = 'synapse-proposals';

/**
 * Single sidebar view that shows both elaboration and enrichment proposals.
 * Three modes:
 * - List: all pending proposals grouped by note
 * - Elaboration review: editable proposed additions
 * - Enrichment review: per-item checkbox selection
 */
export class UnifiedProposalView extends ItemView {
	private items: UnifiedItem[] = [];
	private incompleteCheckpoints: Checkpoint[] = [];
	private callbacks: UnifiedViewCallbacks;
	private notifications: NotificationManager;

	private reviewingElaboration: Proposal | null = null;
	private reviewingEnrichment: EnrichmentProposal | null = null;
	private reviewingOrganize: OrganizeProposal | null = null;
	private reviewingDeepDive: DeepDiveProposal | null = null;
	private reviewingTitle: TitleProposal | null = null;
	private reviewingRem: RemProposal | null = null;

	// REM review selection state
	private selectedRemLinks = new Set<string>();

	private acceptAllInProgress = false;
	private rejectAllInProgress = false;

	// Enrichment review selection state
	private selectedTags = new Set<string>();
	private selectedLinks = new Set<string>();
	private selectedRefs = new Set<string>();
	private selectedFrontmatter = new Set<string>();

	constructor(
		leaf: WorkspaceLeaf,
		callbacks: UnifiedViewCallbacks,
		notifications: NotificationManager,
	) {
		super(leaf);
		this.callbacks = callbacks;
		this.notifications = notifications;
	}

	getViewType(): string {
		return UNIFIED_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Synapse proposals';
	}

	getIcon(): string {
		// Brand S-Signal mark (registered via addIcon in main.ts), matching the
		// "Review proposals" ribbon that opens this view. Not 'sparkles' — that
		// Lucide glyph is on the brand's banned inventory.
		return 'synapse';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setCheckpoints(checkpoints: Checkpoint[]): void {
		this.incompleteCheckpoints = checkpoints;
		this.render();
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
		if (this.reviewingOrganize) {
			const exists = items.some(
				i => i.kind === 'organize' && i.data.id === this.reviewingOrganize!.id
			);
			if (!exists) this.reviewingOrganize = null;
		}
		if (this.reviewingDeepDive) {
			const exists = items.some(
				i => i.kind === 'deep-dive' && i.data.id === this.reviewingDeepDive!.id
			);
			if (!exists) this.reviewingDeepDive = null;
		}
		if (this.reviewingTitle) {
			const exists = items.some(
				i => i.kind === 'title' && i.data.id === this.reviewingTitle!.id
			);
			if (!exists) this.reviewingTitle = null;
		}
		if (this.reviewingRem) {
			const exists = items.some(
				i => i.kind === 'rem' && i.data.id === this.reviewingRem!.id
			);
			if (!exists) this.reviewingRem = null;
		}
		this.render();
	}

	private render(): void {
		if (this.reviewingElaboration) {
			this.renderElaborationReview(this.reviewingElaboration);
		} else if (this.reviewingEnrichment) {
			this.renderEnrichmentReview(this.reviewingEnrichment);
		} else if (this.reviewingOrganize) {
			this.renderOrganizeReview(this.reviewingOrganize);
		} else if (this.reviewingDeepDive) {
			this.renderDeepDiveReview(this.reviewingDeepDive);
		} else if (this.reviewingTitle) {
			this.renderTitleReview(this.reviewingTitle);
		} else if (this.reviewingRem) {
			this.renderRemReview(this.reviewingRem);
		} else {
			this.renderList();
		}
	}

	/**
	 * Register a click handler that invokes a promise-returning callback as
	 * fire-and-forget. The listener receives a synchronous arrow (returning
	 * `void`, never a promise) and any rejection is surfaced to the user via
	 * {@link fireAndForget}, so a failed accept/reject no longer fails silently.
	 *
	 * Use this for click handlers whose entire body is a single async callback
	 * (e.g. Accept/Reject buttons on proposal cards). For handlers that also run
	 * synchronous work before the async call (e.g. clearing review state), call
	 * {@link fireAndForget} directly inside a sync arrow instead.
	 */
	private onClick(el: HTMLElement, fn: () => Promise<unknown>, label: string): void {
		el.addEventListener('click', () => {
			fireAndForget(fn(), label);
		});
	}

	/** Open a note in Obsidian's main editor pane. */
	private openNote(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file) {
			const leaf = this.app.workspace.getLeaf(false);
			fireAndForget(leaf.openFile(file as import('obsidian').TFile), 'Open note');
		}
	}

	private exitReview(): void {
		this.reviewingElaboration = null;
		this.reviewingEnrichment = null;
		this.reviewingOrganize = null;
		this.reviewingDeepDive = null;
		this.reviewingTitle = null;
		this.reviewingRem = null;
		this.render();
	}

	// ── Accept All ─────────────────────────────────────────────

	/**
	 * Accept every pending proposal in presentation order (top to bottom).
	 * Runs sequentially because organize proposals may affect file paths.
	 * Stops on the first failure, leaving remaining proposals untouched.
	 */
	private async acceptAll(): Promise<void> {
		if (this.acceptAllInProgress || this.rejectAllInProgress) return;
		this.acceptAllInProgress = true;

		// Snapshot the items in current presentation order
		const snapshot = [...this.items];
		const total = snapshot.length;
		let accepted = 0;

		// Show initial progress
		this.renderAcceptAllProgress(accepted, total);

		for (const item of snapshot) {
			try {
				await this.acceptSingleItem(item);
				accepted++;
				this.renderAcceptAllProgress(accepted, total);
			} catch (err) {
				this.acceptAllInProgress = false;
				const label = this.itemLabel(item);
				const message = err instanceof Error ? err.message : String(err);
				this.notifications.error(
					`Accept All stopped: failed on "${label}" -- ${message}. ` +
					`${accepted}/${total} accepted, ${total - accepted} remaining.`
				);
				this.render();
				return;
			}
		}

		this.acceptAllInProgress = false;
		this.notifications.success(`${accepted} proposal${accepted === 1 ? '' : 's'} accepted`);
		this.render();
	}

	/**
	 * Call the appropriate accept callback for a single proposal item.
	 * For enrichment proposals, all suggested items are accepted (same as
	 * clicking "Accept All" on an individual enrichment card).
	 */
	private async acceptSingleItem(item: UnifiedItem): Promise<void> {
		switch (item.kind) {
			case 'elaboration':
				await this.callbacks.onElaborationAccept(
					item.data.id,
					item.data.proposedAdditions
				);
				break;
			case 'enrichment': {
				const { result } = item.data;
				const all: AcceptedItems = {
					tags: result.tags.map(t => t.tag),
					internalLinks: result.internalLinks.map(l => l.targetPath),
					externalLinks: result.externalLinks.map(r => r.url),
					frontmatter: result.frontmatter.map(f => f.key),
				};
				await this.callbacks.onEnrichmentAcceptSelected(item.data.id, all);
				break;
			}
			case 'organize':
				await this.callbacks.onOrganizeAccept(item.data.id);
				break;
			case 'deep-dive':
				await this.callbacks.onDeepDiveAccept(item.data.id);
				break;
			case 'title':
				await this.callbacks.onTitleAccept(item.data.id);
				break;
			case 'rem': {
				const allTexts = item.data.candidates.map(c => c.matchedText);
				await this.callbacks.onRemAcceptSelected(item.data.id, allTexts);
				break;
			}
		}
	}

	/** Human-readable label for a proposal, used in error messages. */
	private itemLabel(item: UnifiedItem): string {
		switch (item.kind) {
			case 'elaboration':
				return `Elaboration: ${item.data.sourceNotePath}`;
			case 'enrichment':
				return `Enrichment: ${item.data.sourceNotePath}`;
			case 'organize':
				return `Organize: ${item.data.sourceNotePath}`;
			case 'deep-dive':
				return `Deep Dive: ${item.data.topic.title}`;
			case 'title':
				return `Title: ${item.data.sourceNotePath}`;
			case 'rem':
				return `REM: ${item.data.sourceNotePath}`;
		}
	}

	/** Render a minimal progress indicator during batch accept. */
	private renderAcceptAllProgress(current: number, total: number): void {
		this.renderBulkProgress('Accepting', current, total);
	}

	// ── Reject All ────────────────────────────────────────────

	/**
	 * Reject every pending proposal in presentation order (top to bottom).
	 * Runs sequentially to match acceptAll() behavior.
	 * Stops on the first failure, leaving remaining proposals untouched.
	 */
	private async rejectAll(): Promise<void> {
		if (this.rejectAllInProgress || this.acceptAllInProgress) return;
		this.rejectAllInProgress = true;

		// Snapshot the items in current presentation order
		const snapshot = [...this.items];
		const total = snapshot.length;
		let rejected = 0;

		// Show initial progress
		this.renderRejectAllProgress(rejected, total);

		for (const item of snapshot) {
			try {
				await this.rejectSingleItem(item);
				rejected++;
				this.renderRejectAllProgress(rejected, total);
			} catch (err) {
				this.rejectAllInProgress = false;
				const label = this.itemLabel(item);
				const message = err instanceof Error ? err.message : String(err);
				this.notifications.error(
					`Reject All stopped: failed on "${label}" -- ${message}. ` +
					`${rejected}/${total} rejected, ${total - rejected} remaining.`
				);
				this.render();
				return;
			}
		}

		this.rejectAllInProgress = false;
		this.notifications.info(`${rejected} proposal${rejected === 1 ? '' : 's'} rejected`);
		this.render();
	}

	/** Call the appropriate reject callback for a single proposal item. */
	private async rejectSingleItem(item: UnifiedItem): Promise<void> {
		switch (item.kind) {
			case 'elaboration':
				await this.callbacks.onElaborationReject(item.data.id);
				break;
			case 'enrichment':
				await this.callbacks.onEnrichmentReject(item.data.id);
				break;
			case 'organize':
				await this.callbacks.onOrganizeReject(item.data.id);
				break;
			case 'deep-dive':
				await this.callbacks.onDeepDiveReject(item.data.id);
				break;
			case 'title':
				await this.callbacks.onTitleReject(item.data.id);
				break;
			case 'rem':
				await this.callbacks.onRemReject(item.data.id);
				break;
		}
	}

	/** Render a minimal progress indicator during batch reject. */
	private renderRejectAllProgress(current: number, total: number): void {
		this.renderBulkProgress('Rejecting', current, total);
	}

	/** Render a progress indicator for bulk accept/reject operations. */
	private renderBulkProgress(verb: string, current: number, total: number): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');
		contentEl.createEl('h3', { text: 'Pending proposals' });

		const progressBar = contentEl.createDiv({ cls: 'synapse-accept-all-progress' });
		progressBar.createEl('p', {
			text: `${verb} ${current + 1}/${total}...`,
			cls: 'synapse-accept-all-progress-text',
		});

		const track = progressBar.createDiv({ cls: 'synapse-accept-all-track' });
		const fill = track.createDiv({ cls: 'synapse-accept-all-fill' });
		fill.style.width = `${Math.round((current / total) * 100)}%`;
	}

	// ── List Mode ──────────────────────────────────────────────

	private renderList(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');
		contentEl.createEl('h3', { text: 'Pending proposals' });

		// Render incomplete checkpoints banner
		if (this.incompleteCheckpoints.length > 0) {
			this.renderCheckpointBanner(contentEl);
		}

		if (this.items.length === 0 && this.incompleteCheckpoints.length === 0) {
			contentEl.createEl('p', {
				text: 'No pending proposals. Scan your vault or enrich a note to get started.',
				cls: 'synapse-empty',
			});
			return;
		}

		if (this.items.length === 0) {
			return;
		}

		// Accept All / Reject All buttons — only when 2+ proposals are pending
		if (this.items.length >= 2) {
			const bulkBar = contentEl.createDiv({ cls: 'synapse-accept-all-bar' });
			const bulkInProgress = this.acceptAllInProgress || this.rejectAllInProgress;

			const acceptAllBtn = bulkBar.createEl('button', {
				text: 'Accept all',
				cls: 'synapse-accept-all-btn mod-cta',
			});
			if (bulkInProgress) {
				acceptAllBtn.disabled = true;
			}
			this.onClick(acceptAllBtn, () => this.acceptAll(), 'Accept all proposals');

			const rejectAllBtn = bulkBar.createEl('button', {
				text: 'Reject all',
				cls: 'synapse-reject-all-btn',
			});
			if (bulkInProgress) {
				rejectAllBtn.disabled = true;
			}
			this.onClick(rejectAllBtn, () => this.rejectAll(), 'Reject all proposals');
		}

		const list = contentEl.createDiv({ cls: 'synapse-proposal-list' });

		const grouped = new Map<string, UnifiedItem[]>();
		for (const item of this.items) {
			const path = item.data.sourceNotePath;
			const existing = grouped.get(path) || [];
			existing.push(item);
			grouped.set(path, existing);
		}

		for (const [notePath, noteItems] of grouped) {
			const section = list.createDiv({ cls: 'synapse-proposal-group' });
			const heading = section.createEl('h4', {
				text: notePath,
				cls: 'synapse-note-link',
			});
			heading.addEventListener('click', () => this.openNote(notePath));

			for (const item of noteItems) {
				if (item.kind === 'elaboration') {
					this.renderElaborationCard(section, item.data);
				} else if (item.kind === 'enrichment') {
					this.renderEnrichmentCard(section, item.data);
				} else if (item.kind === 'organize') {
					this.renderOrganizeCard(section, item.data);
				} else if (item.kind === 'deep-dive') {
					this.renderDeepDiveCard(section, item.data);
				} else if (item.kind === 'title') {
					this.renderTitleCard(section, item.data);
				} else if (item.kind === 'rem') {
					this.renderRemCard(section, item.data);
				}
			}
		}
	}

	private renderElaborationCard(container: HTMLElement, proposal: Proposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('elaboration')}`,
		});

		card.createEl('span', {
			text: 'Elaboration',
			cls: `synapse-badge ${badgeClass('elaboration')}`,
		});

		const reasons = proposal.detectionReasons.map(r => r.type).join(', ');
		card.createEl('small', { text: reasons, cls: 'synapse-reasons' });

		const preview = proposal.proposedAdditions.slice(0, 200);
		card.createEl('p', {
			text: preview + (proposal.proposedAdditions.length > 200 ? '...' : ''),
			cls: 'synapse-preview',
		});

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.reviewingElaboration = proposal;
			this.render();
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept' });
		this.onClick(
			acceptBtn,
			() => this.callbacks.onElaborationAccept(proposal.id, proposal.proposedAdditions),
			'Accept elaboration'
		);

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onElaborationReject(proposal.id), 'Reject elaboration');
	}

	private renderEnrichmentCard(container: HTMLElement, proposal: EnrichmentProposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('enrichment')}`,
		});

		card.createEl('span', {
			text: 'Enrichment',
			cls: `synapse-badge ${badgeClass('enrichment')}`,
		});

		const { result } = proposal;
		const parts: string[] = [];
		if (result.tags.length > 0) parts.push(`${result.tags.length} tags`);
		if (result.internalLinks.length > 0) parts.push(`${result.internalLinks.length} links`);
		if (result.externalLinks.length > 0) parts.push(`${result.externalLinks.length} refs`);
		if (result.frontmatter.length > 0) parts.push(`${result.frontmatter.length} attrs`);

		card.createEl('small', {
			text: `${proposal.triggerSource} | ${parts.join(', ')}`,
			cls: 'synapse-reasons',
		});

		if (result.tags.length > 0) {
			// Group tags by category for preview
			const byCategory = new Map<string, string[]>();
			for (const t of result.tags.slice(0, 5)) {
				const cat = t.category || 'Other';
				const existing = byCategory.get(cat) || [];
				existing.push(t.tag.replace(/^#/, ''));
				byCategory.set(cat, existing);
			}
			const tagPreview = [...byCategory.entries()]
				.map(([cat, tags]) => `${cat}: ${tags.join(', ')}`)
				.join('; ');
			card.createEl('p', {
				text: tagPreview + (result.tags.length > 5 ? '...' : ''),
				cls: 'synapse-preview',
			});
		}

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.enterEnrichmentReview(proposal);
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept all' });
		acceptBtn.addEventListener('click', () => {
			const all: AcceptedItems = {
				tags: result.tags.map(t => t.tag),
				internalLinks: result.internalLinks.map(l => l.targetPath),
				externalLinks: result.externalLinks.map(r => r.url),
				frontmatter: result.frontmatter.map(f => f.key),
			};
			fireAndForget(
				this.callbacks.onEnrichmentAcceptSelected(proposal.id, all),
				'Accept enrichment'
			);
		});

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onEnrichmentReject(proposal.id), 'Reject enrichment');
	}

	private renderOrganizeCard(container: HTMLElement, proposal: OrganizeProposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('organize')}`,
		});

		card.createEl('span', {
			text: 'Organize',
			cls: `synapse-badge ${badgeClass('organize')}`,
		});

		card.createEl('small', {
			text: `Move to ${proposal.proposedDirectory}`,
			cls: 'synapse-reasons',
		});

		const preview = proposal.reasoning.slice(0, 200);
		card.createEl('p', {
			text: preview + (proposal.reasoning.length > 200 ? '...' : ''),
			cls: 'synapse-preview',
		});

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.reviewingOrganize = proposal;
			this.render();
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept' });
		this.onClick(acceptBtn, () => this.callbacks.onOrganizeAccept(proposal.id), 'Accept organize');

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onOrganizeReject(proposal.id), 'Reject organize');
	}

	// ── Elaboration Review ─────────────────────────────────────

	private renderElaborationReview(proposal: Proposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');

		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'synapse-review-title synapse-note-link',
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

		contentEl.createEl('small', { text: reasons, cls: 'synapse-review-reasons' });

		const editorPane = contentEl.createDiv({ cls: 'synapse-review-pane' });
		editorPane.createEl('div', {
			text: 'Proposed additions',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('elaboration')}`,
		});
		const textarea = editorPane.createEl('textarea', {
			cls: 'synapse-review-editor synapse-review-editor--elaboration',
		});
		textarea.value = proposal.proposedAdditions;

		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });
		const acceptBtn = actionBar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			this.reviewingElaboration = null;
			fireAndForget(
				this.callbacks.onElaborationAccept(proposal.id, textarea.value),
				'Accept elaboration'
			);
		});
		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingElaboration = null;
			fireAndForget(this.callbacks.onElaborationReject(proposal.id), 'Reject elaboration');
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
		contentEl.addClass('synapse-view-root');

		// Header
		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'synapse-review-title synapse-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		contentEl.createEl('small', {
			text: `${proposal.triggerSource} | ${proposal.createdAt.split('T')[0]}`,
			cls: 'synapse-review-reasons',
		});

		// Scrollable checklist
		const checklist = contentEl.createDiv({ cls: 'synapse-enrichment-checklist' });

		const { result } = proposal;

		if (result.tags.length > 0) {
			this.renderChecklistSection(checklist, 'Metadata Tags', result.tags, {
				getId: t => t.tag,
				getLabel: t => `${t.tag} (${t.category})`,
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
		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });

		const acceptBtn = actionBar.createEl('button', { text: 'Accept selected', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			const accepted: AcceptedItems = {
				tags: [...this.selectedTags],
				internalLinks: [...this.selectedLinks],
				externalLinks: [...this.selectedRefs],
				frontmatter: [...this.selectedFrontmatter],
			};
			this.reviewingEnrichment = null;
			fireAndForget(
				this.callbacks.onEnrichmentAcceptSelected(proposal.id, accepted),
				'Accept enrichment'
			);
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
			fireAndForget(this.callbacks.onEnrichmentReject(proposal.id), 'Reject enrichment');
		});
	}

	// ── Organize Review ───────────────────────────────────────

	private renderOrganizeReview(proposal: OrganizeProposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');

		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'synapse-review-title synapse-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		contentEl.createEl('small', {
			text: `Proposed ${proposal.createdAt.split('T')[0]}`,
			cls: 'synapse-review-reasons',
		});

		// Proposed directory
		const dirPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		dirPane.createEl('div', {
			text: 'Proposed directory',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('organize')}`,
		});
		dirPane.createEl('p', {
			text: proposal.proposedDirectory,
			cls: 'synapse-organize-directory synapse-review-box--organize',
		});

		// Reasoning
		const reasonPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		reasonPane.createEl('div', {
			text: 'Reasoning',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('organize')}`,
		});
		reasonPane.createEl('p', {
			text: proposal.reasoning,
			cls: 'synapse-organize-reasoning synapse-review-box--organize',
		});

		// Action bar
		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });
		const acceptBtn = actionBar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			this.reviewingOrganize = null;
			fireAndForget(this.callbacks.onOrganizeAccept(proposal.id), 'Accept organize');
		});
		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingOrganize = null;
			fireAndForget(this.callbacks.onOrganizeReject(proposal.id), 'Reject organize');
		});
	}

	// ── Deep Dive Card ────────────────────────────────────────

	private renderDeepDiveCard(container: HTMLElement, proposal: DeepDiveProposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('deep-dive')}`,
		});

		const badgeRow = card.createDiv({ cls: 'synapse-badge-row' });
		badgeRow.createEl('span', {
			text: 'Deep dive',
			cls: `synapse-badge ${badgeClass('deep-dive')}`,
		});
		badgeRow.createEl('span', {
			text: `D${proposal.depth}`,
			cls: 'synapse-depth-badge',
		});
		badgeRow.createEl('span', {
			text: `Q: ${proposal.qualityScore.score.toFixed(2)}`,
			cls: 'synapse-quality-badge',
		});

		card.createEl('strong', { text: proposal.topic.title });

		card.createEl('small', {
			text: proposal.topic.description,
			cls: 'synapse-reasons',
		});

		const preview = proposal.proposedContent.slice(0, 200);
		card.createEl('p', {
			text: preview + (proposal.proposedContent.length > 200 ? '...' : ''),
			cls: 'synapse-preview',
		});

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.reviewingDeepDive = proposal;
			this.render();
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept' });
		this.onClick(acceptBtn, () => this.callbacks.onDeepDiveAccept(proposal.id), 'Accept deep dive');

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onDeepDiveReject(proposal.id), 'Reject deep dive');
	}

	// ── Deep Dive Review ──────────────────────────────────────

	private renderDeepDiveReview(proposal: DeepDiveProposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');

		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		header.createEl('span', {
			text: proposal.topic.title,
			cls: 'synapse-review-title',
		});

		// Metadata row
		const meta = contentEl.createDiv({ cls: 'synapse-deep-dive-meta' });
		meta.createEl('span', { text: `Depth: ${proposal.depth}`, cls: 'synapse-depth-badge' });
		meta.createEl('span', {
			text: `Quality: ${proposal.qualityScore.score.toFixed(2)}`,
			cls: 'synapse-quality-badge',
		});

		contentEl.createEl('small', {
			text: `From: ${proposal.sourceNotePath}`,
			cls: 'synapse-review-reasons',
		});

		contentEl.createEl('small', {
			text: proposal.qualityScore.reasoning,
			cls: 'synapse-review-reasons',
		});

		// Proposed path
		const pathPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		pathPane.createEl('div', {
			text: 'Proposed path',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('deep-dive')}`,
		});
		pathPane.createEl('p', {
			text: proposal.proposedPath,
			cls: 'synapse-organize-directory synapse-review-box--deep-dive',
		});

		// Content preview
		const editorPane = contentEl.createDiv({ cls: 'synapse-review-pane' });
		editorPane.createEl('div', {
			text: 'Proposed content',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('deep-dive')}`,
		});
		const textarea = editorPane.createEl('textarea', { cls: 'synapse-review-editor synapse-review-editor--deep-dive' });
		textarea.value = proposal.proposedContent;
		textarea.readOnly = true;

		// Child count
		if (proposal.childProposalIds.length > 0) {
			contentEl.createEl('small', {
				text: `${proposal.childProposalIds.length} child proposal${proposal.childProposalIds.length === 1 ? '' : 's'} — rejecting will cascade`,
				cls: 'synapse-review-reasons',
			});
		}

		// Action bar
		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });
		const acceptBtn = actionBar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			this.reviewingDeepDive = null;
			fireAndForget(this.callbacks.onDeepDiveAccept(proposal.id), 'Accept deep dive');
		});
		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingDeepDive = null;
			fireAndForget(this.callbacks.onDeepDiveReject(proposal.id), 'Reject deep dive');
		});
	}

	// ── Title Card ───────────────────────────────────────────

	private renderTitleCard(container: HTMLElement, proposal: TitleProposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('title')}`,
		});

		card.createEl('span', {
			text: 'Title',
			cls: `synapse-badge ${badgeClass('title')}`,
		});

		const triggerLabel = proposal.trigger === 'untitled' ? 'Untitled note' : 'Content mismatch';
		card.createEl('small', {
			text: `${triggerLabel} | "${proposal.currentTitle}" -> "${proposal.proposedTitle}"`,
			cls: 'synapse-reasons',
		});

		card.createEl('p', {
			text: proposal.reasoning,
			cls: 'synapse-preview',
		});

		// Collision hint (#408): the proposed title already exists in this folder.
		if (proposal.conflictsWith) {
			card.createEl('small', {
				text: `"${proposal.proposedTitle}" already exists here — add a suffix or merge.`,
				cls: 'synapse-reasons synapse-title-conflict',
			});
		}

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.reviewingTitle = proposal;
			this.render();
		});

		if (proposal.conflictsWith) {
			// Replace the single Accept with the two collision resolutions (#408).
			const suffixBtn = actions.createEl('button', { text: 'Add suffix' });
			this.onClick(suffixBtn, () => this.callbacks.onTitleAccept(proposal.id, 'iterate'), 'Add suffix to title');

			const mergeBtn = actions.createEl('button', { text: 'Merge into existing' });
			this.onClick(mergeBtn, () => this.callbacks.onTitleAccept(proposal.id, 'merge'), 'Merge into existing note');
		} else {
			const acceptBtn = actions.createEl('button', { text: 'Accept' });
			this.onClick(acceptBtn, () => this.callbacks.onTitleAccept(proposal.id), 'Accept title');
		}

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onTitleReject(proposal.id), 'Reject title');
	}

	// ── Title Review ─────────────────────────────────────────

	private renderTitleReview(proposal: TitleProposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');

		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'synapse-review-title synapse-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		const triggerLabel = proposal.trigger === 'untitled' ? 'Untitled note detected' : 'Title/content mismatch detected';
		contentEl.createEl('small', {
			text: `${triggerLabel} | ${proposal.createdAt.split('T')[0]}`,
			cls: 'synapse-review-reasons',
		});

		// Current title
		const currentPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		currentPane.createEl('div', {
			text: 'Current title',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('title')}`,
		});
		currentPane.createEl('p', {
			text: proposal.currentTitle,
			cls: 'synapse-organize-directory synapse-review-box--title',
		});

		// Proposed title
		const proposedPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		proposedPane.createEl('div', {
			text: 'Proposed title',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('title')}`,
		});
		proposedPane.createEl('p', {
			text: proposal.proposedTitle,
			cls: 'synapse-organize-directory synapse-review-box--title',
		});

		// Reasoning
		const reasonPane = contentEl.createDiv({ cls: 'synapse-organize-detail' });
		reasonPane.createEl('div', {
			text: 'Reasoning',
			cls: `synapse-review-pane-label ${reviewPaneLabelClass('title')}`,
		});
		reasonPane.createEl('p', {
			text: proposal.reasoning,
			cls: 'synapse-organize-reasoning synapse-review-box--title',
		});

		// Collision hint (#408): the proposed title already exists in this folder.
		if (proposal.conflictsWith) {
			contentEl.createEl('small', {
				text: `A note named "${proposal.proposedTitle}" already exists in this folder. Add a suffix to keep both, or merge into the existing note.`,
				cls: 'synapse-review-reasons synapse-title-conflict',
			});
		}

		// Action bar
		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });
		if (proposal.conflictsWith) {
			const suffixBtn = actionBar.createEl('button', { text: 'Add suffix', cls: 'mod-cta' });
			suffixBtn.addEventListener('click', () => {
				this.reviewingTitle = null;
				fireAndForget(this.callbacks.onTitleAccept(proposal.id, 'iterate'), 'Add suffix to title');
			});
			const mergeBtn = actionBar.createEl('button', { text: 'Merge into existing' });
			mergeBtn.addEventListener('click', () => {
				this.reviewingTitle = null;
				fireAndForget(this.callbacks.onTitleAccept(proposal.id, 'merge'), 'Merge into existing note');
			});
		} else {
			const acceptBtn = actionBar.createEl('button', { text: 'Accept', cls: 'mod-cta' });
			acceptBtn.addEventListener('click', () => {
				this.reviewingTitle = null;
				fireAndForget(this.callbacks.onTitleAccept(proposal.id), 'Accept title');
			});
		}
		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingTitle = null;
			fireAndForget(this.callbacks.onTitleReject(proposal.id), 'Reject title');
		});
	}

	// ── REM Card ─────────────────────────────────────────────

	private renderRemCard(container: HTMLElement, proposal: RemProposal): void {
		const card = container.createDiv({
			cls: `synapse-proposal-card ${cardClass('rem')}`,
		});

		card.createEl('span', {
			text: 'REM',
			cls: `synapse-badge ${badgeClass('rem')}`,
		});

		const { candidates } = proposal;
		const parts: string[] = [];
		const titleCount = candidates.filter(c => c.matchType === 'title').length;
		const aliasCount = candidates.filter(c => c.matchType === 'alias').length;
		const semanticCount = candidates.filter(c => c.matchType === 'semantic').length;
		if (titleCount > 0) parts.push(`${titleCount} title`);
		if (aliasCount > 0) parts.push(`${aliasCount} alias`);
		if (semanticCount > 0) parts.push(`${semanticCount} semantic`);

		card.createEl('small', {
			text: `${candidates.length} link${candidates.length === 1 ? '' : 's'} | ${parts.join(', ')}`,
			cls: 'synapse-reasons',
		});

		// Preview: show first few candidates
		const previewItems = candidates.slice(0, 3);
		const previewText = previewItems
			.map(c => `${c.matchedText} → [[${c.targetDisplayName}]]`)
			.join('; ');
		card.createEl('p', {
			text: previewText + (candidates.length > 3 ? '...' : ''),
			cls: 'synapse-preview',
		});

		const actions = card.createDiv({ cls: 'synapse-actions' });

		const viewBtn = actions.createEl('button', { text: 'Review' });
		viewBtn.addEventListener('click', () => {
			this.enterRemReview(proposal);
		});

		const acceptBtn = actions.createEl('button', { text: 'Accept all' });
		acceptBtn.addEventListener('click', () => {
			const allTexts = candidates.map(c => c.matchedText);
			fireAndForget(
				this.callbacks.onRemAcceptSelected(proposal.id, allTexts),
				'Accept REM links'
			);
		});

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		this.onClick(rejectBtn, () => this.callbacks.onRemReject(proposal.id), 'Reject REM links');
	}

	// ── REM Review ───────────────────────────────────────────

	private enterRemReview(proposal: RemProposal): void {
		this.reviewingRem = proposal;
		this.selectedRemLinks = new Set(proposal.candidates.map(c => c.matchedText));
		this.render();
	}

	private renderRemReview(proposal: RemProposal): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-view-root');

		// Header
		const header = contentEl.createDiv({ cls: 'synapse-review-header' });
		const backBtn = header.createEl('button', { text: 'Back', cls: 'synapse-review-back' });
		backBtn.addEventListener('click', () => this.exitReview());

		const titleLink = header.createEl('span', {
			text: proposal.sourceNotePath,
			cls: 'synapse-review-title synapse-note-link',
		});
		titleLink.addEventListener('click', () => this.openNote(proposal.sourceNotePath));

		contentEl.createEl('small', {
			text: `${proposal.candidates.length} linkable mention${proposal.candidates.length === 1 ? '' : 's'} | ${proposal.createdAt.split('T')[0]}`,
			cls: 'synapse-review-reasons',
		});

		// Scrollable checklist of candidates
		const checklist = contentEl.createDiv({ cls: 'synapse-enrichment-checklist' });

		for (const candidate of proposal.candidates) {
			const section = checklist.createDiv({ cls: 'synapse-checklist-section' });

			// Header: target name + match type badge
			const headingRow = section.createDiv({ cls: 'synapse-rem-candidate-header' });
			headingRow.createEl('span', {
				text: `[[${candidate.targetDisplayName}]]`,
				cls: 'synapse-rem-target',
			});
			headingRow.createEl('span', {
				text: candidate.matchType,
				cls: `synapse-badge synapse-badge--rem-${candidate.matchType}`,
			});
			if (candidate.matchType === 'semantic') {
				headingRow.createEl('span', {
					text: `${Math.round(candidate.confidence * 100)}%`,
					cls: 'synapse-quality-badge',
				});
			}

			// Checkbox row for this candidate
			const row = section.createEl('label', { cls: 'synapse-checklist-row' });
			const checkbox = row.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedRemLinks.has(candidate.matchedText);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedRemLinks.add(candidate.matchedText);
				} else {
					this.selectedRemLinks.delete(candidate.matchedText);
				}
			});

			const label = row.createEl('span');
			label.createEl('strong', { text: `"${candidate.matchedText}"` });
			label.createEl('span', {
				text: ` (${candidate.occurrences.length} occurrence${candidate.occurrences.length === 1 ? '' : 's'})`,
			});

			// Show context for first occurrence
			if (candidate.occurrences.length > 0) {
				const occ = candidate.occurrences[0];
				const contextEl = section.createEl('div', { cls: 'synapse-rem-context' });
				const before = occ.lineText.slice(Math.max(0, occ.startOffset - 30), occ.startOffset);
				const matched = occ.lineText.slice(occ.startOffset, occ.endOffset);
				const after = occ.lineText.slice(occ.endOffset, occ.endOffset + 30);
				contextEl.createEl('span', { text: `...${before}` });
				contextEl.createEl('mark', { text: matched });
				contextEl.createEl('span', { text: `${after}...` });
			}
		}

		// Action bar
		const actionBar = contentEl.createDiv({ cls: 'synapse-review-actions' });

		const acceptBtn = actionBar.createEl('button', { text: 'Accept selected', cls: 'mod-cta' });
		acceptBtn.addEventListener('click', () => {
			const accepted = [...this.selectedRemLinks];
			this.reviewingRem = null;
			fireAndForget(
				this.callbacks.onRemAcceptSelected(proposal.id, accepted),
				'Accept REM links'
			);
		});

		const selectAllBtn = actionBar.createEl('button', { text: 'All' });
		selectAllBtn.addEventListener('click', () => {
			this.selectedRemLinks = new Set(proposal.candidates.map(c => c.matchedText));
			this.render();
		});

		const noneBtn = actionBar.createEl('button', { text: 'None' });
		noneBtn.addEventListener('click', () => {
			this.selectedRemLinks.clear();
			this.render();
		});

		const rejectBtn = actionBar.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.reviewingRem = null;
			fireAndForget(this.callbacks.onRemReject(proposal.id), 'Reject REM links');
		});
	}

	// ── Checkpoint Banner ─────────────────────────────────────

	private renderCheckpointBanner(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'synapse-checkpoint-banner' });
		section.createEl('div', {
			text: 'Interrupted operations',
			cls: 'synapse-checkpoint-heading',
		});

		for (const cp of this.incompleteCheckpoints) {
			const total = cp.completedItems.length + cp.remainingItems.length;
			const done = cp.completedItems.length;

			const card = section.createDiv({ cls: 'synapse-checkpoint-card' });

			const info = card.createDiv({ cls: 'synapse-checkpoint-info' });
			info.createEl('strong', { text: cp.operationLabel });
			info.createEl('small', {
				text: `${done}/${total} completed -- ${cp.remainingItems.length} remaining`,
				cls: 'synapse-reasons',
			});

			// Progress bar
			const track = card.createDiv({ cls: 'synapse-checkpoint-track' });
			const fill = track.createDiv({ cls: 'synapse-checkpoint-fill' });
			fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;

			const actions = card.createDiv({ cls: 'synapse-actions' });

			const resumeBtn = actions.createEl('button', { text: 'Resume', cls: 'mod-cta' });
			this.onClick(resumeBtn, () => this.callbacks.onCheckpointResume(cp.id), 'Resume operation');

			const discardBtn = actions.createEl('button', { text: 'Discard' });
			this.onClick(discardBtn, () => this.callbacks.onCheckpointDiscard(cp.id), 'Discard operation');
		}
	}

	// ── Checklist Helper ──────────────────────────────────────

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
		const section = container.createDiv({ cls: 'synapse-checklist-section' });
		section.createEl('div', { text: title, cls: 'synapse-checklist-heading' });

		for (const item of items) {
			const id = config.getId(item);
			const label = config.getLabel(item);

			const row = section.createEl('label', { cls: 'synapse-checklist-row' });
			const checkbox = row.createEl('input', { type: 'checkbox' });
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
}
