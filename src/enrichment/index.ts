import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { NotificationManager, parseFrontmatter } from '../shared';
import { EnrichmentApplier } from './enrichment-applier';
import { EnrichmentDetailModal } from './enrichment-modal';
import { EnrichmentStore } from './enrichment-store';
import { LinkResolver } from './link-resolver';
import { PromptBuilder } from './prompt-builder';
import { TagScorer } from './tag-scorer';
import { AcceptedItems, EnrichmentProposal, EnrichmentResult, EnrichmentTrigger } from './types';
import { VaultAnalyzer } from './vault-analyzer';

export type {
	AcceptedItems,
	EnrichmentProposal,
	EnrichmentResult,
	EnrichmentTrigger,
	TagCandidate,
	InternalLinkCandidate,
	ExternalLinkCandidate,
	WeightConfig,
} from './types';

export class EnrichmentModule {
	private analyzer: VaultAnalyzer;
	private tagScorer: TagScorer;
	private linkResolver: LinkResolver;
	private promptBuilder: PromptBuilder;
	private applier: EnrichmentApplier;
	private store: EnrichmentStore;

	/** Optional callback to refresh the unified proposal view. Wired by main.ts. */
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager
	) {
		this.analyzer = new VaultAnalyzer(plugin.app);
		this.tagScorer = new TagScorer(this.analyzer, getSettings);
		this.linkResolver = new LinkResolver(plugin.app, this.analyzer, getSettings);
		this.promptBuilder = new PromptBuilder(getSettings);
		this.applier = new EnrichmentApplier(plugin.app, getSettings);
		this.store = new EnrichmentStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		// Invalidate analyzer cache when metadata resolves
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on('resolved', () => {
				this.analyzer.invalidate();
			})
		);

		this.plugin.addCommand({
			id: 'auto-notes:enrich-current-note',
			name: 'Enrich current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.enrich(ctx.file.path, 'manual');
				}
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:undo-enrichment',
			name: 'Undo last enrichment on current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.undoLastEnrichment(ctx.file.path);
				}
			},
		});
	}

	onunload(): void {}

	/** Get all pending proposals (called by main.ts for the unified view). */
	async getPendingProposals(): Promise<EnrichmentProposal[]> {
		return this.store.loadPending();
	}

	/**
	 * Generate an enrichment proposal for a note.
	 * Called by main.ts callbacks after other processes complete,
	 * or directly via command for manual enrichment.
	 */
	async enrich(filePath: string, trigger: EnrichmentTrigger): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		// Check exclusions
		if (this.isExcluded(file)) return;

		const op = this.notifications.startOperation(
			`Enriching ${file.basename}`,
			`enrich-${filePath}`
		);

		try {
			const content = await this.plugin.app.vault.read(file);
			const parsed = parseFrontmatter(content);
			const existingTags = this.analyzer.getFileTags(file);

			// Get existing link paths
			const existingLinkPaths = [
				...this.analyzer.getOutgoingLinks(file.path),
			];

			// Get existing external URLs from content
			const existingExternalLinks = this.extractExternalUrls(content);

			// Run scorers in parallel
			op.update('Analyzing tags');
			const [tags, internalLinks, externalLinks, frontmatter] =
				await Promise.all([
					this.tagScorer.scoreTags(parsed.body, file.path, existingTags),
					Promise.resolve(
						this.linkResolver.findInternalLinks(file, existingLinkPaths)
					),
					this.promptBuilder.suggestExternalLinks(
						parsed.body,
						existingExternalLinks
					),
					this.promptBuilder.suggestFrontmatter(
						parsed.body,
						parsed.frontmatter
					),
				]);

			const result: EnrichmentResult = {
				tags,
				internalLinks,
				externalLinks,
				frontmatter,
			};

			// Only create a proposal if there's something to propose
			const totalItems =
				result.tags.length +
				result.internalLinks.length +
				result.externalLinks.length +
				result.frontmatter.length;

			if (totalItems === 0) {
				op.finish('No enrichments needed');
				return;
			}

			// Create and save proposal
			const proposal: EnrichmentProposal = {
				id: this.generateId(),
				sourceNotePath: file.path,
				createdAt: new Date().toISOString(),
				triggerSource: trigger,
				result,
				status: 'pending',
			};

			await this.store.save(proposal);
			op.finish(
				`Enrichment proposal: ${result.tags.length} tags, ${result.internalLinks.length} links, ${result.externalLinks.length} refs`
			);
			await this.refreshView();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Enrichment failed — ${msg}`);
		}
	}

	/** Accept all items in a proposal. Called from unified view. */
	async acceptAllFromView(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const accepted: AcceptedItems = {
			tags: proposal.result.tags.map(t => t.tag),
			internalLinks: proposal.result.internalLinks.map(l => l.targetPath),
			externalLinks: proposal.result.externalLinks.map(r => r.url),
			frontmatter: proposal.result.frontmatter.map(f => f.key),
		};

		await this.applier.apply(proposal, accepted);
		await this.store.updateStatus(id, 'accepted', accepted);
		this.notifications.success('Enrichment applied');
		await this.refreshView();
	}

	/** Reject a proposal. Called from unified view. */
	async rejectFromView(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		this.notifications.info('Enrichment rejected');
		await this.refreshView();
	}

	/** Show detail modal for a proposal. Called from unified view. */
	async showDetailFromView(id: string): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const modal = new EnrichmentDetailModal(this.plugin.app, proposal, {
			onAccept: (accepted) => this.acceptSelected(id, accepted),
			onReject: () => this.rejectFromView(id),
		});
		modal.open();
	}

	private async acceptSelected(
		id: string,
		accepted: AcceptedItems
	): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal) return;

		const hasItems =
			accepted.tags.length > 0 ||
			accepted.internalLinks.length > 0 ||
			accepted.externalLinks.length > 0 ||
			accepted.frontmatter.length > 0;

		if (!hasItems) {
			await this.rejectFromView(id);
			return;
		}

		await this.applier.apply(proposal, accepted);

		const totalAvailable =
			proposal.result.tags.length +
			proposal.result.internalLinks.length +
			proposal.result.externalLinks.length +
			proposal.result.frontmatter.length;
		const totalAccepted =
			accepted.tags.length +
			accepted.internalLinks.length +
			accepted.externalLinks.length +
			accepted.frontmatter.length;

		const status =
			totalAccepted < totalAvailable ? 'partially-accepted' : 'accepted';

		await this.store.updateStatus(id, status, accepted);
		this.notifications.success(`Enrichment ${status}`);
		await this.refreshView();
	}

	private async undoLastEnrichment(filePath: string): Promise<void> {
		const proposals = await this.store.loadForNote(filePath);
		const accepted = proposals
			.filter(p => p.status === 'accepted' || p.status === 'partially-accepted')
			.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
			);

		if (accepted.length === 0) {
			this.notifications.info('No enrichments to undo');
			return;
		}

		const latest = accepted[0];
		await this.applier.undo(latest);
		await this.store.updateStatus(latest.id, 'rejected');
		this.notifications.success('Enrichment undone');
	}

	private async refreshView(): Promise<void> {
		await this.onViewRefreshNeeded?.();
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings().enrichment;

		// Check excluded folders
		for (const folder of settings.excludeFolders) {
			if (file.path.startsWith(folder + '/')) return true;
		}

		// Check excluded tags
		const tags = this.analyzer.getFileTags(file);
		for (const excludeTag of settings.excludeTags) {
			const normalized = excludeTag.startsWith('#')
				? excludeTag.toLowerCase()
				: `#${excludeTag.toLowerCase()}`;
			if (tags.includes(normalized)) return true;
		}

		return false;
	}

	private extractExternalUrls(content: string): string[] {
		const urlRegex = /https?:\/\/[^\s)\]>]+/g;
		return [...content.matchAll(urlRegex)].map(m => m[0]);
	}

	private generateId(): string {
		return (
			Date.now().toString(36) +
			Math.random().toString(36).slice(2, 10)
		);
	}
}
