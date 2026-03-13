import { App, Modal } from 'obsidian';
import { AcceptedItems, EnrichmentProposal } from './types';

/**
 * Detail modal for reviewing an enrichment proposal with per-item toggles.
 * Users can individually select/deselect tags, links, refs, and frontmatter items.
 */
export class EnrichmentDetailModal extends Modal {
	private onAccept: (accepted: AcceptedItems) => void;
	private onReject: () => void;

	// Track which items are selected
	private selectedTags: Set<string>;
	private selectedLinks: Set<string>;
	private selectedRefs: Set<string>;
	private selectedFrontmatter: Set<string>;

	constructor(
		app: App,
		private proposal: EnrichmentProposal,
		callbacks: {
			onAccept: (accepted: AcceptedItems) => void;
			onReject: () => void;
		}
	) {
		super(app);
		this.onAccept = callbacks.onAccept;
		this.onReject = callbacks.onReject;

		// Default all items to selected
		this.selectedTags = new Set(proposal.result.tags.map(t => t.tag));
		this.selectedLinks = new Set(proposal.result.internalLinks.map(l => l.targetPath));
		this.selectedRefs = new Set(proposal.result.externalLinks.map(r => r.url));
		this.selectedFrontmatter = new Set(proposal.result.frontmatter.map(f => f.key));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('auto-notes-enrichment-detail');

		contentEl.createEl('h2', { text: `Enrichment: ${this.proposal.sourceNotePath}` });
		contentEl.createEl('small', {
			text: `Triggered by: ${this.proposal.triggerSource} | ${this.proposal.createdAt}`,
		});

		// Tags section
		const { result } = this.proposal;
		if (result.tags.length > 0) {
			this.renderSection(contentEl, 'Tags', result.tags, {
				getId: t => t.tag,
				getLabel: t => `${t.tag} (score: ${t.weightedScore.toFixed(2)}, used by ${t.sources.length} files)`,
				selectedSet: this.selectedTags,
			});
		}

		// Internal links section
		if (result.internalLinks.length > 0) {
			this.renderSection(contentEl, 'Related Notes', result.internalLinks, {
				getId: l => l.targetPath,
				getLabel: l => `[[${l.displayText}]] — ${l.reason} (score: ${l.relevanceScore.toFixed(2)})`,
				selectedSet: this.selectedLinks,
			});
		}

		// External references section
		if (result.externalLinks.length > 0) {
			this.renderSection(contentEl, 'External References', result.externalLinks, {
				getId: r => r.url,
				getLabel: r => `${r.title} — ${r.reason}`,
				selectedSet: this.selectedRefs,
			});
		}

		// Frontmatter section
		if (result.frontmatter.length > 0) {
			this.renderSection(contentEl, 'Frontmatter Attributes', result.frontmatter, {
				getId: f => f.key,
				getLabel: f => `${f.key}: ${JSON.stringify(f.value)} (${f.action})`,
				selectedSet: this.selectedFrontmatter,
			});
		}

		// Action buttons
		const actions = contentEl.createDiv({ cls: 'auto-notes-modal-actions' });

		const acceptBtn = actions.createEl('button', {
			text: 'Accept Selected',
			cls: 'mod-cta',
		});
		acceptBtn.addEventListener('click', () => {
			this.onAccept({
				tags: [...this.selectedTags],
				internalLinks: [...this.selectedLinks],
				externalLinks: [...this.selectedRefs],
				frontmatter: [...this.selectedFrontmatter],
			});
			this.close();
		});

		const selectAllBtn = actions.createEl('button', { text: 'Select All' });
		selectAllBtn.addEventListener('click', () => {
			this.selectAll();
			this.onOpen(); // Re-render
		});

		const deselectBtn = actions.createEl('button', { text: 'Deselect All' });
		deselectBtn.addEventListener('click', () => {
			this.deselectAll();
			this.onOpen(); // Re-render
		});

		const rejectBtn = actions.createEl('button', { text: 'Reject All' });
		rejectBtn.addEventListener('click', () => {
			this.onReject();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderSection<T>(
		container: HTMLElement,
		title: string,
		items: T[],
		config: {
			getId: (item: T) => string;
			getLabel: (item: T) => string;
			selectedSet: Set<string>;
		}
	): void {
		const section = container.createDiv({ cls: 'auto-notes-enrichment-section' });
		section.createEl('h3', { text: title });

		for (const item of items) {
			const id = config.getId(item);
			const label = config.getLabel(item);

			const row = section.createDiv({ cls: 'auto-notes-enrichment-item' });
			const checkbox = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
			checkbox.checked = config.selectedSet.has(id);
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					config.selectedSet.add(id);
				} else {
					config.selectedSet.delete(id);
				}
			});

			row.createEl('label', { text: label });
		}
	}

	private selectAll(): void {
		const { result } = this.proposal;
		this.selectedTags = new Set(result.tags.map(t => t.tag));
		this.selectedLinks = new Set(result.internalLinks.map(l => l.targetPath));
		this.selectedRefs = new Set(result.externalLinks.map(r => r.url));
		this.selectedFrontmatter = new Set(result.frontmatter.map(f => f.key));
	}

	private deselectAll(): void {
		this.selectedTags.clear();
		this.selectedLinks.clear();
		this.selectedRefs.clear();
		this.selectedFrontmatter.clear();
	}
}
