import { Plugin, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import {
	FolderPickerModal, getMarkdownFiles, NotificationManager, parseFrontmatter,
	CheckpointManager, generateId,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { EnrichmentApplier } from './enrichment-applier';
import { EnrichmentStore } from './enrichment-store';
import { LinkResolver } from './link-resolver';
import { MetadataClassifier } from './metadata-classifier';
import { PromptBuilder } from './prompt-builder';
import { TopicExtractor } from './topic-extractor';
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
export type { TagVocabularyEntry } from '../settings';

export class EnrichmentModule {
	private analyzer: VaultAnalyzer;
	private classifier: MetadataClassifier;
	private topicExtractor: TopicExtractor;
	private linkResolver: LinkResolver;
	private promptBuilder: PromptBuilder;
	private applier: EnrichmentApplier;
	private store: EnrichmentStore;

	/** Optional callback to refresh the unified proposal view. Wired by main.ts. */
	onViewRefreshNeeded: (() => Promise<void>) | null = null;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager
	) {
		this.analyzer = new VaultAnalyzer(plugin.app);
		this.classifier = new MetadataClassifier(getSettings);
		this.topicExtractor = new TopicExtractor(plugin.app, this.analyzer, getSettings);
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
			id: 'auto-notes:scan-vault-enrichment',
			name: 'Scan vault for enrichment',
			callback: () => {
				const defaultPath = this.plugin.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.plugin.app,
					(folder) => this.scanVault(folder.isRoot() ? undefined : folder.path),
					defaultPath
				).open();
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
	 * Resume enrichment from a checkpoint (C1).
	 * Re-enriches the remaining files from the checkpoint.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		this.topicExtractor.clearPending();

		const genOp = this.notifications.startOperation(
			'Resuming enrichment',
			'enrichment-vault-resume'
		);
		const createdProposals: Array<{ id: string; notePath: string }> = [];
		let proposalCount = 0;

		try {
			for (let i = 0; i < checkpoint.remainingItems.length; i++) {
				if (genOp.cancelled) break;

				const item = checkpoint.remainingItems[i];
				const filePath = item.payload.filePath as string;

				genOp.progress(i + 1, checkpoint.remainingItems.length, 'Resuming enrichment');

				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) continue;
				if (this.isExcluded(file)) continue;

				const id = await this.enrichFile(file, 'manual');
				if (id) {
					createdProposals.push({ id, notePath: file.path });
					proposalCount++;
				}

				await this.checkpointManager.completeItem(checkpoint.id, item.id);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Resume failed -- ${msg}`);
			this.topicExtractor.clearPending();
			await this.rejectProposalBatch(createdProposals.map(p => p.id));
			await this.refreshView();
			return;
		}

		if (genOp.cancelled) {
			await this.checkpointManager.discard(checkpoint.id);
			this.topicExtractor.clearPending();
			await this.rejectProposalBatch(createdProposals.map(p => p.id));
			await this.refreshView();
			return;
		}

		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);
		genOp.finish(`Resumed -- generated ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`);
		await this.refreshView();
	}

	/**
	 * Scan every note in the vault for enrichment opportunities.
	 *
	 * Four-phase flow:
	 * 1. Lightweight scan -- collect eligible files, warm analyzer caches
	 * 2. User confirmation
	 * 3. Heavy AI enrichment per file (cancellable, with rollback)
	 * 4. Resolve cross-note new-note candidates -- only topics referenced
	 *    by 2+ notes become new-note link suggestions
	 */
	async scanVault(folderPath?: string): Promise<number> {
		// -- Phase 1: Collect eligible files & warm caches --
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(
			`${scopeLabel} for enrichment`,
			'enrichment-vault-scan'
		);

		const allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		const eligible: TFile[] = [];

		try {
			for (let i = 0; i < allFiles.length; i++) {
				scanOp.progress(i + 1, allFiles.length, scopeLabel);
				if (!this.isExcluded(allFiles[i])) {
					eligible.push(allFiles[i]);
				}
			}

			// Warm the vault-wide caches so every note benefits from
			// the full tag index and link graph during enrichment
			this.analyzer.buildTagIndex();
			this.analyzer.buildLinkGraph();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Vault scan failed -- ${msg}`);
			return 0;
		}

		scanOp.finish(`Found ${eligible.length} notes`);

		if (eligible.length === 0) {
			return 0;
		}

		// -- Phase 2: User confirmation --
		const proceed = await this.notifications.confirm(
			`Found ${eligible.length} note${eligible.length === 1 ? '' : 's'} to enrich. Generate proposals?`,
			{ proceedLabel: 'Generate', cancelLabel: 'Skip' }
		);

		if (!proceed) {
			this.notifications.info('Enrichment scan skipped');
			return 0;
		}

		// -- Phase 3: Generate proposals (heavy, cancellable, checkpointed) --
		// Clear any stale pending topics before starting
		this.topicExtractor.clearPending();

		const genOp = this.notifications.startOperation(
			'Generating enrichment proposals',
			'enrichment-vault-generate'
		);
		// Track proposal IDs mapped to note paths for Phase 4 injection
		const createdProposals: Array<{ id: string; notePath: string }> = [];
		let proposalCount = 0;

		// Create checkpoint for resumability
		const checkpointItems: CheckpointWorkItem[] = eligible.map((f, i) => ({
			id: `enrich-${i}-${f.path}`,
			label: f.path,
			payload: { filePath: f.path } as Record<string, unknown>,
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'enrichment',
			operationLabel: `Enrichment: vault scan${folderPath ? ` (${folderPath})` : ''}`,
			items: checkpointItems,
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		try {
			for (let i = 0; i < eligible.length; i++) {
				if (genOp.cancelled) break;

				genOp.progress(
					i + 1,
					eligible.length,
					'Generating enrichment proposals'
				);
				const id = await this.enrichFile(eligible[i], 'manual');
				if (id) {
					createdProposals.push({ id, notePath: eligible[i].path });
					proposalCount++;
				}

				// Save checkpoint progress
				await this.checkpointManager.completeItem(
					checkpoint.id,
					checkpointItems[i].id
				);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Enrichment generation failed -- ${msg}`);
			this.topicExtractor.clearPending();
			await this.rejectProposalBatch(createdProposals.map(p => p.id));
			await this.refreshView();
			return 0;
		}

		if (genOp.cancelled) {
			// Discard checkpoint on user cancellation (C3)
			await this.checkpointManager.discard(checkpoint.id);
			this.topicExtractor.clearPending();
			await this.rejectProposalBatch(createdProposals.map(p => p.id));
			await this.refreshView();
			return 0;
		}

		// -- Phase 4: Resolve cross-note new-note candidates --
		// Only topics referenced by 2+ notes become new-note suggestions
		const newNoteCandidates = this.topicExtractor.resolveNewNoteCandidates();

		if (newNoteCandidates.size > 0) {
			for (const { id, notePath } of createdProposals) {
				const extras = newNoteCandidates.get(notePath);
				if (!extras || extras.length === 0) continue;

				const proposal = await this.store.load(id);
				if (!proposal) continue;

				// Merge new-note candidates into existing internal links
				proposal.result.internalLinks =
					this.linkResolver.mergeTopicCandidates(
						extras,
						proposal.result.internalLinks
					);
				await this.store.save(proposal);
			}
		}

		// Mark checkpoint completed and dispatch deferred tasks (I1)
		const tasks = await this.checkpointManager.complete(checkpoint.id);
		this.dispatchDeferredTasks(tasks);
		genOp.finish(
			`Generated ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`
		);
		await this.refreshView();
		return proposalCount;
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
			const id = await this.enrichFile(file, trigger);
			// Single-note enrichment has no cross-note evidence for new notes,
			// so discard any accumulated unmatched topics
			this.topicExtractor.clearPending();
			if (id) {
				op.finish('Enrichment proposal created');
			} else {
				op.finish('No enrichments needed');
			}
			await this.refreshView();
		} catch (error) {
			this.topicExtractor.clearPending();
			const msg = error instanceof Error ? error.message : String(error);
			op.error(`Enrichment failed -- ${msg}`);
		}
	}

	/**
	 * Core enrichment logic for a single file.
	 * Returns the proposal ID if one was created, null otherwise.
	 */
	private async enrichFile(
		file: TFile,
		trigger: EnrichmentTrigger
	): Promise<string | null> {
		const content = await this.plugin.app.vault.read(file);
		const parsed = parseFrontmatter(content);
		const existingTags = this.analyzer.getFileTags(file);
		const existingLinkPaths = [...this.analyzer.getOutgoingLinks(file.path)];
		const existingExternalLinks = this.extractExternalUrls(content);

		// Run classifiers in parallel
		const [tags, graphLinks, topicLinks, externalLinks, frontmatter] =
			await Promise.all([
				this.classifier.classify(parsed.body, existingTags),
				Promise.resolve(
					this.linkResolver.findInternalLinks(file, existingLinkPaths)
				),
				this.topicExtractor.extractTopics(
					parsed.body,
					file.path,
					existingLinkPaths
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

		// Merge topic-extracted links with graph-based links
		const internalLinks = this.linkResolver.mergeTopicCandidates(
			topicLinks,
			graphLinks
		);

		const result: EnrichmentResult = {
			tags,
			internalLinks,
			externalLinks,
			frontmatter,
		};

		const totalItems =
			result.tags.length +
			result.internalLinks.length +
			result.externalLinks.length +
			result.frontmatter.length;

		if (totalItems === 0) return null;

		const proposal: EnrichmentProposal = {
			id: generateId(),
			sourceNotePath: file.path,
			createdAt: new Date().toISOString(),
			triggerSource: trigger,
			result,
			status: 'pending',
		};

		await this.store.save(proposal);
		return proposal.id;
	}

	/** Accept selected items in a proposal. Called from unified view. */
	async acceptSelectedFromView(id: string, accepted: AcceptedItems): Promise<void> {
		await this.acceptSelected(id, accepted);
	}

	/** Reject a proposal. Called from unified view. */
	async rejectFromView(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		this.notifications.info('Enrichment rejected');
		await this.refreshView();
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

	private async rejectProposalBatch(ids: string[]): Promise<void> {
		for (const id of ids) {
			await this.store.updateStatus(id, 'rejected');
		}
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

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					this.onViewRefreshNeeded?.();
					break;
				default:
					console.warn(`[Auto Notes] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}
