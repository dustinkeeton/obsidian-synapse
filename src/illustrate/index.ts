import { Plugin, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { CommandRegistrar } from '../commands';
import {
	getMarkdownFiles, parseFrontmatter, generateId, fireAndForget, openScanFolderPicker,
	isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, redactError,
} from '../shared';
import type {
	CacheUse, Checkpoint, CheckpointWorkItem, DeferredTask, OperationHandle, ModuleDeps, FeatureModule,
	NotificationManager, CheckpointManager, NoteOperationQueue,
} from '../shared';
import { NoteAnalyzer } from './note-analyzer';
import { IllustrateStore } from './proposal-store';
import { AssetWriter } from './asset-writer';
import { WikimediaProvider } from './providers/wikimedia';
import { OpenverseProvider } from './providers/openverse';
import { isLicenseAllowed } from './license';
import { buildXyChart } from './chart';
import { validateMermaid } from './diagram';
import { buildMermaidItemBlock, buildPhotoBlock, insertAtAnchor } from './inserter';
import { isEligibleNote } from './note-scanner';
import type { IllustrateItem, IllustrateProposal, IllustrateSpot, MediaCandidate, MediaProvider } from './types';

export type {
	IllustrateItem, IllustrateProposal, IllustrateProposalStatus, IllustrateSettings, IllustrateSpot,
	IllustrateSpotKind, MediaCandidate, MediaProvider, MediaProviderId, MediaSearchOptions, ChartData,
} from './types';
export { WikimediaProvider } from './providers/wikimedia';
export { OpenverseProvider } from './providers/openverse';
export { normalizeLicense, isLicenseAllowed, LICENSE_NAMES, DEFAULT_LICENSE_FILTER } from './license';
export { validateMermaid } from './diagram';
export { buildXyChart, parseChartData } from './chart';
export { insertAtAnchor } from './inserter';

const CANDIDATES_PER_QUERY = 5;

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

	private async findPhoto(query: string): Promise<MediaCandidate | null> {
		const allowed = this.getSettings().illustrate.licenseFilter;
		for (const provider of this.activeProviders()) {
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

	private async resolveItem(spot: IllustrateSpot): Promise<IllustrateItem | null> {
		const base = { id: generateId(), anchor: spot.anchor, caption: spot.caption, rationale: spot.rationale };
		if (spot.kind === 'photo') {
			const candidate = await this.findPhoto(spot.query);
			return candidate ? { ...base, kind: 'photo', candidate } : null;
		}
		if (spot.kind === 'diagram') return { ...base, kind: 'diagram', mermaid: spot.mermaid };
		const mermaid = validateMermaid(buildXyChart(spot.chart));
		return mermaid ? { ...base, kind: 'chart', mermaid } : null;
	}

	/** Analyze one note and persist a proposal; returns its id or null when nothing is worth illustrating. */
	private async buildProposal(file: TFile, cacheUse: CacheUse): Promise<string | null> {
		const content = await this.plugin.app.vault.read(file);
		const { body } = parseFrontmatter(content);
		const spots = await this.analyzer.analyze(file.path, body, trackAiCache(cacheUse));
		const items: IllustrateItem[] = [];
		for (const spot of spots) {
			const item = await this.resolveItem(spot);
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

	async illustrateNote(filePath: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		if (this.isExcluded(file)) {
			const rule = findMatchingRule(file.path, 'illustrate', this.getSettings());
			this.notifications.info(rule
				? `Skipped — "${file.path}" is excluded by rule "${rule.pattern}"`
				: 'Note is excluded from illustration (excluded tag)');
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

	async scanVault(folderPath?: string, skipConfirmation = false, onlyFile?: TFile): Promise<number> {
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
		await this.noteQueue.run(file.path, async () => {
			const blocks: Array<{ anchor: string; block: string }> = [];
			for (const item of accepted) {
				blocks.push({ anchor: item.anchor, block: await this.buildBlock(item, file) });
			}
			await this.plugin.app.vault.process(file, (content) =>
				blocks.reduce((acc, { anchor, block }) => insertAtAnchor(acc, anchor, block), content)
			);
		});
		const status = accepted.length === proposal.items.length ? 'accepted' : 'partially-accepted';
		await this.store.updateStatus(id, status, accepted.map((item) => item.id));
		if (!options?.silent) {
			this.notifications.success(`Inserted ${accepted.length} visual${accepted.length === 1 ? '' : 's'}`);
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
			this.notifications.info(`Could not download "${item.candidate.title}" — embedding the remote URL instead (${error instanceof Error ? error.message : String(error)})`);
			return buildPhotoBlock(item, null);
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

	private async refreshView(): Promise<void> {
		await this.onViewRefreshNeeded?.();
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
