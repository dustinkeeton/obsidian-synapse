import { Plugin, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { CommandRegistrar } from '../commands';
import {
	getMarkdownFiles, parseFrontmatter, generateId, fireAndForget, openScanFolderPicker,
	isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, redactError,
	resolveInsertionPoint, applyInsertion, locateRegion, wordCount, parseCalloutHeader, CALLOUT_TYPES,
} from '../shared';
import type {
	CacheUse, Checkpoint, CheckpointWorkItem, DeferredTask, OperationHandle, ModuleDeps, FeatureModule,
	NotificationManager, CheckpointManager, NoteOperationQueue, InsertionAnchor, SourceContext, SourceImage, RegionLocator, ResolveInsertionOptions,
} from '../shared';
import { NoteAnalyzer } from './note-analyzer';
import { IllustrateStore } from './proposal-store';
import { AssetWriter } from './asset-writer';
import { WikimediaProvider } from './providers/wikimedia';
import { OpenverseProvider } from './providers/openverse';
import { SourceProvider } from './providers/source';
import { fetchLinkedPageImages, MAX_LINKED_PAGE_IMAGES } from './linked-pages';
import { isLicenseAllowed } from './license';
import { buildXyChart } from './chart';
import { validateMermaid } from './diagram';
import { buildMermaidItemBlock, buildPhotoBlock } from './inserter';
import { isEligibleNote, hasIllustrations, MIN_WORDS_TO_ILLUSTRATE } from './note-scanner';
import type { IllustrateItem, IllustrateProposal, IllustrateSpot, MediaCandidate, MediaProvider } from './types';

export type {
	IllustrateItem, IllustrateProposal, IllustrateProposalStatus, IllustrateSettings, IllustrateSpot,
	IllustrateSpotKind, MediaCandidate, MediaProvider, MediaProviderId, RepositoryProviderId, IllustrateRunAfterKey, MediaSearchOptions, ChartData,
} from './types';
export { WikimediaProvider } from './providers/wikimedia';
export { OpenverseProvider } from './providers/openverse';
export { SourceProvider } from './providers/source';
export { fetchLinkedPageImages } from './linked-pages';
export { normalizeLicense, isLicenseAllowed, LICENSE_NAMES, DEFAULT_LICENSE_FILTER } from './license';
export { validateMermaid } from './diagram';
export { buildXyChart, parseChartData } from './chart';

const CANDIDATES_PER_QUERY = 5;
const NOTHING_ENABLED_MESSAGE = 'Illustrate has nothing to propose: enable a photo provider or Mermaid diagrams and charts in settings';
/** Below this many source images a post-op run may fetch linked pages for more. */
const MIN_SOURCE_IMAGES = 3;

/** The analyzer copies anchors verbatim, so a leading `#` is the only heading signal. */
function anchorFor(text: string): InsertionAnchor {
	return { kind: /^#{1,6}\s/.test(text) ? 'heading' : 'paragraph', text };
}

/** Callout regions resolve inside the container; the ad hoc/whole-note path never enters one. */
function resolveOptions(region?: RegionLocator): ResolveInsertionOptions {
	return region?.kind === 'callout' ? { within: region, insideContainers: true } : {};
}

/** True when a `synapse-illustrate` callout (either spelling) titled `caption` is already in the note. */
function hasCaptionCallout(content: string, caption: string): boolean {
	return content.split('\n').some((line) => {
		const header = parseCalloutHeader(line);
		return header?.identity === CALLOUT_TYPES.illustrate && header.title === caption;
	});
}

/** Accept is idempotent: a visual whose caption callout or Mermaid body is already in the note is skipped. */
function alreadyInserted(content: string, item: IllustrateItem): boolean {
	if (hasCaptionCallout(content, item.caption)) return true;
	return item.kind !== 'photo' && content.includes(item.mermaid);
}

export class IllustrateModule implements FeatureModule {
	private plugin: Plugin;
	private getSettings: () => SynapseSettings;
	private notifications: NotificationManager;
	private checkpointManager: CheckpointManager;
	private registrar: CommandRegistrar;
	private noteQueue: NoteOperationQueue;
	private analyzer: NoteAnalyzer;
	private store: IllustrateStore;
	private assets: AssetWriter;
	private wikimedia = new WikimediaProvider();
	private openverse = new OpenverseProvider();
	/** Note paths with a post-op run in progress; a second chained trigger for the same note is dropped. */
	private inFlight = new Set<string>();

	onViewRefreshNeeded: (() => Promise<void>) | null = null;
	onOpenProposalView: (() => void) | null = null;
	private shouldAutoAccept: () => boolean = () => false;

	constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean) {
		this.plugin = deps.plugin;
		this.getSettings = deps.getSettings;
		this.notifications = deps.notifications;
		this.checkpointManager = deps.checkpointManager;
		this.registrar = deps.registrar;
		this.noteQueue = deps.noteQueue;
		if (shouldAutoAccept) this.shouldAutoAccept = shouldAutoAccept;
		this.analyzer = new NoteAnalyzer(deps.getSettings);
		this.store = new IllustrateStore(deps.plugin.app, deps.getSettings);
		this.assets = new AssetWriter(deps.plugin.app);
	}

	async onload(): Promise<void> {
		await this.store.init();
		this.registrar.register('illustrate-current-note', this.getSettings().illustrate.enabled, {
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) await this.illustrateNote(ctx.file.path);
			},
		});
		this.registrar.register('illustrate-folder', this.getSettings().illustrate.enabled, {
			callback: () => {
				openScanFolderPicker(this.plugin.app, (path) => {
					fireAndForget(this.scanVault(path), 'Scan folder for notes to illustrate', { notifications: this.notifications });
				});
			},
		});
	}

	onunload(): void {}

	async getPendingProposals(): Promise<IllustrateProposal[]> {
		return this.store.loadPending();
	}

	/** Providers enabled in settings, in preference order. */
	private activeProviders(): MediaProvider[] {
		const flags = this.getSettings().illustrate.providers;
		const providers: MediaProvider[] = [];
		if (flags.wikimedia) providers.push(this.wikimedia);
		if (flags.openverse) providers.push(this.openverse);
		return providers;
	}

	private async findPhoto(query: string, sourceImages?: SourceImage[]): Promise<MediaCandidate | null> {
		const allowed = this.getSettings().illustrate.licenseFilter;
		const providers: MediaProvider[] = sourceImages && sourceImages.length > 0
			? [new SourceProvider(sourceImages), ...this.activeProviders()]
			: this.activeProviders();
		for (const provider of providers) {
			try {
				const candidates = await provider.search(query, { limit: CANDIDATES_PER_QUERY });
				const match = candidates.find((c) => isLicenseAllowed(c.license, allowed));
				if (match) return match;
			} catch (error) {
				console.warn(`[Synapse] Illustrate: ${provider.id} search failed: ${redactError(error)}`);
			}
		}
		return null;
	}

	/** False when a run has no output kind it can produce (no photo provider, Mermaid off). */
	private hasOutputKind(): boolean {
		const { mermaid } = this.getSettings().illustrate;
		return mermaid || this.activeProviders().length > 0;
	}

	private async resolveItem(spot: IllustrateSpot, content: string, sourceImages?: SourceImage[], region?: RegionLocator): Promise<IllustrateItem | null> {
		if (spot.kind !== 'photo' && !this.getSettings().illustrate.mermaid) return null;
		const placement = resolveInsertionPoint(content, anchorFor(spot.anchor), resolveOptions(region));
		const base = { id: generateId(), anchor: spot.anchor, caption: spot.caption, rationale: spot.rationale, placement, region };
		if (spot.kind === 'photo') {
			const candidate = await this.findPhoto(`${spot.query} ${spot.caption}`, sourceImages);
			return candidate ? { ...base, kind: 'photo', candidate } : null;
		}
		if (spot.kind === 'diagram') return { ...base, kind: 'diagram', mermaid: spot.mermaid };
		const mermaid = validateMermaid(buildXyChart(spot.chart));
		return mermaid ? { ...base, kind: 'chart', mermaid } : null;
	}

	/** Analyze one note (or just the produced region) and persist a proposal; null when nothing is worth illustrating. */
	private async buildProposal(file: TFile, cacheUse: CacheUse, sourceImages?: SourceImage[], producedRegion?: RegionLocator): Promise<string | null> {
		const content = await this.plugin.app.vault.read(file);
		let text = parseFrontmatter(content).body;
		let region: RegionLocator | undefined;
		if (producedRegion?.kind === 'callout') {
			const located = locateRegion(content, producedRegion);
			if (located) {
				if (hasIllustrations(located.text)) return null;
				text = located.text;
				region = producedRegion;
			}
		}
		const spots = await this.analyzer.analyze(file.path, text, trackAiCache(cacheUse));
		const items: IllustrateItem[] = [];
		for (const spot of spots) {
			const item = await this.resolveItem(spot, content, sourceImages, region);
			if (item) items.push(item);
		}
		if (items.length === 0) return null;
		const proposal: IllustrateProposal = {
			id: generateId(),
			sourceNotePath: file.path,
			createdAt: new Date().toISOString(),
			items,
			status: 'pending',
		};
		await this.store.save(proposal);
		return proposal.id;
	}

	/** Single-note flow; with `ctx` (post-op chaining, #213) it runs silently and sources from the acted-on material first. */
	async illustrateNote(filePath: string, ctx?: SourceContext): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		if (ctx) {
			if (!this.isExcluded(file)) await this.illustrateFromContext(file, ctx);
			return;
		}
		if (this.isExcluded(file)) {
			const rule = findMatchingRule(file.path, 'illustrate', this.getSettings());
			this.notifications.info(rule
				? `Skipped — "${file.path}" is excluded by rule "${rule.pattern}"`
				: 'Note is excluded from illustration (excluded tag)');
			return;
		}
		if (!this.hasOutputKind()) {
			this.notifications.info(NOTHING_ENABLED_MESSAGE);
			return;
		}
		const op = this.notifications.startOperation(`Illustrating ${file.basename}`, `illustrate-${filePath}`);
		this.openverse.resetRun();
		const cacheUse: CacheUse = {};
		try {
			const id = await this.noteQueue.run(file.path, () => this.buildProposal(file, cacheUse));
			if (!id) {
				op.finish(withCacheReport('No visuals proposed for this note', [cacheUse]));
				return;
			}
			op.finish(
				withCacheReport('Illustration proposal created', [cacheUse]),
				reviewAction({ generated: true, shouldAutoAccept: this.shouldAutoAccept, openProposalView: this.onOpenProposalView }),
			);
			await this.maybeAutoAccept(id);
			await this.refreshView();
		} catch (error) {
			op.error(`Illustration failed -- ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async illustrateFromContext(file: TFile, ctx: SourceContext): Promise<void> {
		const settings = this.getSettings().illustrate;
		if (this.inFlight.has(file.path)) {
			console.debug(`[Synapse] Illustrate: skipped ${file.path} (run already in flight)`);
			return;
		}
		this.inFlight.add(file.path);
		try {
			await this.runFromContext(file, ctx, settings);
		} finally {
			this.inFlight.delete(file.path);
		}
	}

	private async runFromContext(file: TFile, ctx: SourceContext, settings: SynapseSettings['illustrate']): Promise<void> {
		if (wordCount(await this.plugin.app.vault.cachedRead(file)) < MIN_WORDS_TO_ILLUSTRATE) return;
		if ((await this.store.loadPending()).some((p) => p.sourceNotePath === file.path)) {
			console.debug(`[Synapse] Illustrate: skipped ${file.path} (a proposal is already pending)`);
			return;
		}
		let images = ctx.sourceImages ?? [];
		const urls = (ctx.sourceUrls ?? []).filter((url) => /^https?:\/\//i.test(url));
		if (settings.fetchLinkedPages && urls.length > 0 && images.length < MIN_SOURCE_IMAGES) {
			const fetched = await fetchLinkedPageImages(urls, {
				maxPages: settings.maxLinkedPagesPerNote,
				maxImages: Math.max(0, MAX_LINKED_PAGE_IMAGES - images.length),
			});
			images = [...images, ...fetched];
		}
		this.openverse.resetRun();
		try {
			const id = await this.noteQueue.run(file.path, () => this.buildProposal(file, {}, images, ctx.producedRegion));
			if (!id) return;
			await this.maybeAutoAccept(id);
			await this.refreshView();
		} catch (error) {
			this.notifications.notifyError(`Illustration failed for ${file.basename}`, error);
		}
	}

	async scanVault(folderPath?: string, skipConfirmation = false, onlyFile?: TFile): Promise<number> {
		if (!this.hasOutputKind()) {
			this.notifications.info(NOTHING_ENABLED_MESSAGE);
			return 0;
		}
		const scopeLabel = folderPath ? `Scanning ${folderPath}` : 'Scanning vault';
		const scanOp = this.notifications.startOperation(`${scopeLabel} for notes to illustrate`, 'illustrate-vault-scan');
		let allFiles = getMarkdownFiles(this.plugin.app, folderPath);
		if (onlyFile) allFiles = allFiles.filter((f) => f.path === onlyFile.path);
		const eligible: TFile[] = [];
		try {
			for (let i = 0; i < allFiles.length; i++) {
				scanOp.progress(i + 1, allFiles.length, scopeLabel);
				const file = allFiles[i];
				if (this.isExcluded(file)) continue;
				if (isEligibleNote(await this.plugin.app.vault.cachedRead(file))) eligible.push(file);
			}
		} catch (error) {
			scanOp.error(`Vault scan failed -- ${error instanceof Error ? error.message : String(error)}`);
			return 0;
		}
		scanOp.finish(`Found ${eligible.length} notes`);
		if (eligible.length === 0) return 0;

		if (!skipConfirmation) {
			const proceed = await this.notifications.confirm(
				`Found ${eligible.length} note${eligible.length === 1 ? '' : 's'} to illustrate. Generate proposals?`,
				{ proceedLabel: 'Generate', cancelLabel: 'Skip' },
			);
			if (!proceed) {
				this.notifications.info('Illustration scan skipped');
				return 0;
			}
		}

		const checkpointItems: CheckpointWorkItem[] = eligible.map((f, i) => ({
			id: `illustrate-${i}-${f.path}`,
			label: f.path,
			payload: { filePath: f.path },
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'illustrate',
			operationLabel: `Illustrate: vault scan${folderPath ? ` (${folderPath})` : ''}`,
			items: checkpointItems,
		});
		await this.checkpointManager.addDeferredTask(checkpoint.id, { id: generateId(), type: 'refresh-sidebar-view', data: {} });
		const genOp = this.notifications.startOperation('Generating illustration proposals', 'illustrate-vault-generate');
		return this.runBatch(genOp, checkpoint.id, checkpointItems, 'Generating illustration proposals');
	}

	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		const op = this.notifications.startOperation('Resuming illustration scan', 'illustrate-resume');
		await this.runBatch(op, checkpoint.id, checkpoint.remainingItems, 'Resuming illustration scan');
	}

	/** Shared batch core for scan and resume: one proposal per work item, checkpointed per item. */
	private async runBatch(op: OperationHandle, checkpointId: string, items: CheckpointWorkItem[], label: string): Promise<number> {
		this.openverse.resetRun();
		const created: string[] = [];
		const cacheUses: CacheUse[] = [];
		let autoAccepted = 0;
		try {
			for (let i = 0; i < items.length; i++) {
				if (op.cancelled) break;
				op.progress(i + 1, items.length, label);
				const file = this.plugin.app.vault.getAbstractFileByPath(items[i].payload.filePath as string);
				if (file instanceof TFile && !this.isExcluded(file)) {
					const cacheUse: CacheUse = {};
					const id = await this.noteQueue.run(file.path, () => this.buildProposal(file, cacheUse));
					cacheUses.push(cacheUse);
					if (id) {
						created.push(id);
						if (await this.maybeAutoAccept(id, true)) autoAccepted++;
					}
				}
				await this.checkpointManager.completeItem(checkpointId, items[i].id);
			}
		} catch (error) {
			op.error(`Illustration generation failed -- ${error instanceof Error ? error.message : String(error)}`);
			await this.rejectBatch(created);
			await this.refreshView();
			return 0;
		}
		if (op.cancelled) {
			await this.checkpointManager.discard(checkpointId);
			await this.rejectBatch(created);
			await this.refreshView();
			return 0;
		}
		const tasks = await this.checkpointManager.complete(checkpointId);
		this.dispatchDeferredTasks(tasks);
		op.finish(
			withCacheReport(`Generated ${created.length} proposal${created.length === 1 ? '' : 's'}`, cacheUses, 'note'),
			reviewAction({ generated: created.length > 0, shouldAutoAccept: this.shouldAutoAccept, openProposalView: this.onOpenProposalView }),
		);
		if (autoAccepted > 0) {
			this.notifications.info(`Auto-accepted ${autoAccepted} illustration proposal${autoAccepted === 1 ? '' : 's'}`);
		}
		await this.refreshView();
		return created.length;
	}

	/** Insert the accepted items into the note; photos are downloaded first unless the setting says otherwise. */
	async acceptProposal(id: string, acceptedItemIds: string[], options?: { silent?: boolean }): Promise<void> {
		const proposal = await this.store.load(id);
		if (!proposal || proposal.status !== 'pending') return;
		const file = this.plugin.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) {
			this.notifications.info('Source note no longer exists');
			return;
		}
		const accepted = proposal.items.filter((item) => acceptedItemIds.includes(item.id));
		if (accepted.length === 0) {
			await this.rejectProposal(id);
			return;
		}
		let inserted = 0;
		await this.noteQueue.run(file.path, async () => {
			const current = await this.plugin.app.vault.read(file);
			const fresh = accepted.filter((item) => !alreadyInserted(current, item));
			const blocks: Array<{ item: IllustrateItem; block: string }> = [];
			for (const item of fresh) {
				blocks.push({ item, block: await this.buildBlock(item, file) });
			}
			if (blocks.length === 0) return;
			// Re-resolve against the live note: the stored placement is only the review preview.
			await this.plugin.app.vault.process(file, (content) =>
				blocks.reduce((acc, { item, block }) => {
					if (alreadyInserted(acc, item)) return acc;
					inserted++;
					return applyInsertion(acc, resolveInsertionPoint(acc, anchorFor(item.anchor), resolveOptions(item.region)), block);
				}, content)
			);
		});
		const status = accepted.length === proposal.items.length ? 'accepted' : 'partially-accepted';
		await this.store.updateStatus(id, status, accepted.map((item) => item.id));
		if (!options?.silent) {
			const skipped = accepted.length - inserted;
			this.notifications.success(`Inserted ${inserted} visual${inserted === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} already present)` : ''}`);
			await this.refreshView();
		}
	}

	private async buildBlock(item: IllustrateItem, note: TFile): Promise<string> {
		if (item.kind !== 'photo') return buildMermaidItemBlock(item);
		if (!this.getSettings().illustrate.preferDownload) return buildPhotoBlock(item, null);
		try {
			const asset = await this.assets.download(item.candidate, note);
			return buildPhotoBlock(item, asset.path);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.debug(`[Synapse] Illustrate: download failed for ${item.candidate.fileUrl}: ${redactError(error)}`);
			this.notifications.info(`Could not download "${item.candidate.title}" — embedding the remote URL instead (${reason})`);
			return buildPhotoBlock(item, null, reason);
		}
	}

	async rejectProposal(id: string): Promise<void> {
		await this.store.updateStatus(id, 'rejected');
		await this.refreshView();
	}

	private async maybeAutoAccept(id: string, batch = false): Promise<boolean> {
		if (!this.shouldAutoAccept()) return false;
		const proposal = await this.store.load(id);
		if (!proposal || proposal.status !== 'pending') return false;
		await this.acceptProposal(id, proposal.items.map((item) => item.id), { silent: batch });
		if (!batch) this.notifications.info(`Auto-accepted illustrations for ${proposal.sourceNotePath}`);
		return true;
	}

	private async rejectBatch(ids: string[]): Promise<void> {
		for (const id of ids) await this.store.updateStatus(id, 'rejected');
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings();
		return (
			isPathExcluded(file.path, 'illustrate', settings) ||
			matchesExcludeTag(file, settings.illustrate.excludeTags, this.plugin.app.metadataCache)
		);
	}

	/** A sidebar refresh failure is logged, never reported as an illustration failure. */
	private async refreshView(): Promise<void> {
		if (!this.onViewRefreshNeeded) return;
		try {
			await this.onViewRefreshNeeded();
		} catch (error) {
			console.warn(`[Synapse] Illustrate: proposal view refresh failed: ${redactError(error)}`);
		}
	}

	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			if (task.type === 'refresh-sidebar-view') {
				if (this.onViewRefreshNeeded) fireAndForget(this.onViewRefreshNeeded(), 'Refresh proposal view', { background: true });
			} else {
				console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

export { renderIllustrateSettings, ILLUSTRATE_FEATURE_TOOLTIP } from './settings-section';
