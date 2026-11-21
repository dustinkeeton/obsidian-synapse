import { Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { extractUrls, linkpathFor } from '../shared';
import type { SourceContext } from '../shared';
import { SynapseSettings, DeepDiveNestingMode } from '../settings';
import { CommandRegistrar } from '../commands';
import {
	NotificationManager, readNote, writeNote, wordCount,
	CheckpointManager, NoteOperationQueue, generateId, fireAndForget,
	isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport,
	stripUnresolvedLinks, assertVaultRelativePath, mergeCacheUse, jobOpId, combineAIOptions, isJobCallRefused,
} from '../shared';
import { acceptApplied, acceptNotApplied, acceptWrote, PROPOSAL_NOT_FOUND, PROPOSAL_NOT_PENDING } from '../shared';
import type { AcceptResult, AIRequestOptions, AIResponseInfo, CacheUse, OperationStatus, Checkpoint, CheckpointWorkItem, DeferredTask, ModuleDeps, FeatureModule } from '../shared';
import { DeepDiveStore } from './deep-dive-store';
import { NoteGenerator } from './note-generator';
import { scoreQuality } from './quality-scorer';
import {
	computeTraversalOrder,
	buildNavigationContext,
	renderNavigationBlock,
	renderSyllabusContent,
	syllabusPath,
	injectNavigationBlock,
} from './syllabus-navigator';
import { selectDepth, MIN_DEPTH, MAX_DEPTH } from './depth-selector-modal';
import { mergeRegeneratedNote } from './regenerate';
import { TopicAnalyzer } from './topic-analyzer';
import type {
	ContinuableDeepDiveRun,
	DeepDiveEndReason,
	DeepDiveJobOptions,
	DeepDiveOutcome,
	DeepDiveProposal,
	DeepDiveRegenerateTarget,
	DeepDiveRun,
	DeepDiveRunOptions,
	DeepDiveTask,
	ExtractedTopic,
	SuggestDirectory,
} from './types';

const DEEP_DIVE_RESUMING_MESSAGE = 'Deep dive paused while Obsidian was in the background — resuming';

type PreparedRun =
	| { ok: true; content: string; newTopics: ExtractedTopic[]; cacheUse: CacheUse }
	| { ok: false; message: string; cacheUse: CacheUse; cancelled?: boolean };

function failedOutcome(message: string, cacheUse: CacheUse = {}, status: 'failed' | 'cancelled' = 'failed'): DeepDiveOutcome {
	return { status, message, proposalIds: [], writtenPaths: [], cacheUse };
}

function clampDepth(depth: number): number {
	return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.floor(depth)));
}

interface TaskSource {
	content: string;
	title: string;
	path: string;
	parentProposedPath?: string;
}

export type {
	ContinuableDeepDiveRun,
	DeepDiveEndReason,
	DeepDiveJobOptions,
	DeepDiveOutcome,
	DeepDiveRegenerateTarget,
	DeepDiveRunOptions,
	DeepDiveProposal,
	DeepDiveRun,
	ExtractedTopic,
	QualityScore,
	DeepDiveProposalStatus,
	DeepDiveRunStatus,
	TraversalNode,
	NavigationContext,
} from './types';

export {
	computeTraversalOrder,
	buildNavigationContext,
	renderNavigationBlock,
	renderSyllabusContent,
	buildTreeFromNodes,
	syllabusTitle,
	syllabusPath,
	injectNavigationBlock,
} from './syllabus-navigator';

export class DeepDiveModule implements FeatureModule {
	onViewRefreshNeeded: (() => Promise<void>) | null = null;
	onNoteAccepted: ((filePath: string, ctx?: SourceContext) => void) | null = null;
	onOrganizeRequested: ((file: TFile) => void) | null = null;

	/** Optional callback to open the unified proposal view. Wired by main.ts (#340). */
	onOpenProposalView: (() => void) | null = null;

	private plugin: Plugin;
	private getSettings: () => SynapseSettings;
	private notifications: NotificationManager;
	private checkpointManager: CheckpointManager;
	private registrar: CommandRegistrar;
	private noteQueue: NoteOperationQueue;
	private analyzer: TopicAnalyzer;
	private generator: NoteGenerator;
	private store: DeepDiveStore;
	private renames: Promise<void> = Promise.resolve();
	/** Runs `continueRun` is generating right now; a second continue of one is refused. */
	private readonly continuing = new Set<string>();
	/** Organize's folder suggestion, injected by the module registry; null means nested placement only. */
	private suggestDirectory: SuggestDirectory | null;

	/**
	 * Live accessor for the deep-dive auto-accept flag (#228). Wired by main.ts
	 * to `() => this.settings.autoAccept['deep-dive']`. Defaults to "never
	 * auto-accept". Deep dive generates a tree; auto-accept creates every
	 * generated node's note (in creation order, after the run finishes).
	 */
	private shouldAutoAccept: () => boolean = () => false;

	constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean, suggestDirectory?: SuggestDirectory) {
		const { plugin, getSettings } = deps;
		this.plugin = plugin;
		this.getSettings = getSettings;
		this.notifications = deps.notifications;
		this.checkpointManager = deps.checkpointManager;
		this.registrar = deps.registrar;
		this.noteQueue = deps.noteQueue;
		if (shouldAutoAccept) this.shouldAutoAccept = shouldAutoAccept;
		this.analyzer = new TopicAnalyzer(plugin.app, getSettings);
		this.generator = new NoteGenerator(getSettings, (path) => linkpathFor(plugin.app, path));
		this.store = new DeepDiveStore(plugin.app, getSettings);
		this.suggestDirectory = suggestDirectory ?? null;
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
			fireAndForget(this.followRename(oldPath, file.path), 'Follow a renamed deep dive note');
		}));

		this.registrar.register('deep-dive', this.getSettings().deepDive.enabled, {
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.deepDive(ctx.file);
				}
			},
		});

		this.registrar.register('clear-deep-dive', this.getSettings().deepDive.enabled, {
			callback: async () => {
				await this.clearProposals();
			},
		});
	}

	onunload(): void {}

	/**
	 * Follows a renamed or moved note or folder (#632): accepted notes, source paths, run roots and syllabus notes
	 * keep pointing at it, so regenerate, nav refresh and continue find them. Renames apply one at a time.
	 */
	followRename(oldPath: string, newPath: string): Promise<void> {
		const next = this.renames.then(() => this.applyRename(normalizePath(oldPath), normalizePath(newPath)));
		this.renames = next.catch(() => undefined);
		return next;
	}

	private async applyRename(oldPath: string, newPath: string): Promise<void> {
		if (oldPath === newPath) return;
		if (!await this.store.mayReference(oldPath, this.getSettings().deepDive.noteOutputFolder)) return;
		const inside = (path: string): string | null => (path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : null);
		const moved = (path: string): string | null => (path === oldPath ? newPath : inside(path));
		// An accepted note follows any rename. A pending note is not written yet: its planned path follows a moved
		// folder, but an exact match means another file took that name.
		const plan = (proposal: DeepDiveProposal) => (proposal.status === 'accepted' ? moved : inside)(proposal.proposedPath);
		const proposals: DeepDiveProposal[] = [];
		for (const scanned of await this.store.loadAllProposals()) {
			proposals.push(scanned);
			if (!plan(scanned) && !moved(scanned.sourceNotePath)) continue;
			// Re-read: an accept or regenerate may have saved the proposal since the scan.
			const proposal = await this.store.loadProposal(scanned.id);
			if (!proposal) continue;
			proposals[proposals.length - 1] = proposal;
			const note = plan(proposal);
			const source = moved(proposal.sourceNotePath);
			if (!note && !source) continue;
			const paths = { ...(note ? { proposedPath: note } : {}), ...(source ? { sourceNotePath: source } : {}) };
			Object.assign(proposal, paths);
			this.store.followProposal(proposal.id, paths);
			await this.store.saveProposal(proposal);
		}
		const runs: DeepDiveRun[] = [];
		for (const { id } of await this.store.loadAllRuns()) {
			const run = await this.store.loadRun(id);
			if (!run) continue;
			runs.push(run);
			const syllabus = this.syllabusPathFor(run);
			const root = moved(run.rootNotePath);
			const movedSyllabus = moved(syllabus);
			if (!root && !movedSyllabus) continue;
			// A syllabus already written is pinned, so a renamed root never starts a second one under its new name.
			const paths = {
				rootNotePath: root ?? run.rootNotePath,
				syllabusPath: movedSyllabus ?? run.syllabusPath ?? (this.noteExists(syllabus) ? syllabus : undefined),
			};
			Object.assign(run, paths);
			this.store.followRun(run.id, paths);
			await this.store.saveRun(run);
		}
		this.store.indexPaths(proposals, runs);
	}

	private syllabusPathFor(run: DeepDiveRun): string {
		return run.syllabusPath ?? syllabusPath(run.rootNotePath, this.getSettings().deepDive.noteOutputFolder);
	}

	async getPendingProposals(): Promise<DeepDiveProposal[]> {
		return this.store.loadPendingProposals();
	}

	/** Resume an interrupted deep-dive from its persisted generation queue (C1). */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		const runId = checkpoint.metadata.runId;
		const run = typeof runId === 'string' ? await this.store.loadRun(runId) : null;
		const rootFile = run ? this.plugin.app.vault.getAbstractFileByPath(run.rootNotePath) : null;
		const rootContent = rootFile instanceof TFile ? await readNote(this.plugin.app, rootFile.path) : null;
		if (!run?.pending || !(rootFile instanceof TFile) || !rootContent) {
			this.notifications.info(
				'This deep dive cannot be resumed. Completed proposals are already saved; re-run deep dive on the source note to continue.'
			);
			await this.checkpointManager.discard(checkpoint.id);
			return;
		}
		await this.runGeneration(rootFile, rootContent, run, checkpoint.id);
	}

	/**
	 * Accept a proposal: create the new note in the vault with navigation,
	 * generate/update the syllabus index, and update navigation in all
	 * previously accepted notes in the same run.
	 *
	 * `options.silent` suppresses the per-note success Notice and the view
	 * refresh; used by batch auto-accept so the run emits a single summary
	 * Notice and refreshes once. The enrichment / organize follow-on hooks
	 * still fire (they are the intended, acyclic chain).
	 */
	async acceptProposal(id: string, options?: { silent?: boolean }): Promise<AcceptResult> {
		const queued = await this.store.loadProposal(id);
		if (!queued) {
			this.notifications.info(PROPOSAL_NOT_FOUND);
			return acceptNotApplied('skipped', PROPOSAL_NOT_FOUND);
		}
		return this.noteQueue.run(queued.proposedPath, () => this.applyAccept(id, options));
	}

	/** Queue-free core of acceptProposal; runs holding the new note's queue slot (#483). */
	private async applyAccept(id: string, options?: { silent?: boolean }): Promise<AcceptResult> {
		const proposal = await this.store.loadProposal(id);
		if (!proposal) return acceptNotApplied('skipped', PROPOSAL_NOT_FOUND);
		// Guard against double-acceptance (cascade safety): never create the
		// note twice for the same proposal.
		if (proposal.status !== 'pending') return acceptNotApplied('skipped', PROPOSAL_NOT_PENDING);

		try {
			assertVaultRelativePath(proposal.proposedPath);
			// The saved copy carries a folder move followed since the load above (#632), so the note is written there.
			const accepted = (await this.store.updateProposalStatus(id, 'accepted')) ?? proposal;
			assertVaultRelativePath(accepted.proposedPath);

			// Links resolve at write time: a rejected or not-yet-accepted parent becomes plain text (#581).
			const content = stripUnresolvedLinks(proposal.proposedContent, this.plugin.app.metadataCache, accepted.proposedPath);
			await this.updateRunNavigation(proposal.runId, accepted.proposedPath, content);

			if (!options?.silent) {
				this.notifications.success(`Created ${accepted.proposedPath}`);
			}

			// Trigger enrichment on the new note
			this.onNoteAccepted?.(accepted.proposedPath, {
				sourceUrls: [...new Set([...(Array.isArray(proposal.topic.relatedUrls) ? proposal.topic.relatedUrls : []), ...extractUrls(proposal.proposedContent)])],
				producedRegion: { kind: 'whole-note' },
			});

			// Trigger organize on the new note if enabled
			if (this.getSettings().deepDive.autoOrganizeOnAccept) {
				const file = this.plugin.app.vault.getAbstractFileByPath(
					normalizePath(accepted.proposedPath)
				);
				if (file instanceof TFile) {
					this.onOrganizeRequested?.(file);
				}
			}

			if (!options?.silent) {
				await this.onViewRefreshNeeded?.();
			}
			return acceptApplied([accepted.proposedPath]);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to accept proposal', error);
			throw new Error(`Accept proposal failed: ${msg}`);
		}
	}

	/**
	 * Accept every proposal generated in a run (#228), in creation order (parents
	 * before children, per the BFS queue) so navigation resolves, then emit a
	 * single summary Notice. Returns the paths of the notes created.
	 *
	 * Done AFTER the generation loop (not mid-loop) so the recursive queue is
	 * not disturbed and navigation is not rebuilt on every node mid-flight.
	 */
	private async autoAcceptRun(proposalIds: string[]): Promise<string[]> {
		const created: string[] = [];
		for (const id of proposalIds) {
			// acceptProposal re-loads and re-checks pending, so a child whose
			// parent was already accepted is still safe.
			const result = await this.acceptProposal(id, { silent: true });
			if (acceptWrote(result)) created.push(...result.written);
		}
		if (created.length > 0) {
			this.notifications.info(
				`Auto-accepted ${created.length} deep dive note${created.length === 1 ? '' : 's'}`
			);
		}
		return created;
	}

	/**
	 * Reject a proposal and cascade-reject all its children.
	 * Updates navigation in remaining accepted notes.
	 */
	async rejectProposal(id: string): Promise<void> {
		const proposal = await this.store.loadProposal(id);
		const rejected = await this.store.cascadeReject(id);
		const count = rejected.length;
		this.notifications.info(
			count > 1 ? `Rejected ${count} proposals (including children)` : 'Proposal rejected'
		);

		// Update navigation for remaining accepted notes in the run
		if (proposal) {
			await this.updateRunNavigation(proposal.runId);
		}

		await this.onViewRefreshNeeded?.();
	}

	/**
	 * Main deep dive flow (palette command): extract topics, then ask for depth and
	 * confirmation, then generate. `run` is the same flow with the answers supplied.
	 */
	private async deepDive(file: TFile): Promise<void> {
		const prepared = await this.prepareRun(file, {});
		if (!prepared.ok) return;
		const { newTopics } = prepared;

		const selectedDepth = await selectDepth(this.plugin.app, this.getSettings().deepDive.maxDepth);
		if (selectedDepth === null) {
			this.notifications.info('Deep dive cancelled');
			return;
		}

		const proceed = await this.notifications.confirm(
			`Found ${newTopics.length} new topic${newTopics.length === 1 ? '' : 's'} to explore (depth ${selectedDepth}). Generate deep dive?`,
			{ proceedLabel: 'Generate', cancelLabel: 'Cancel' }
		);

		if (!proceed) {
			this.notifications.info('Deep dive cancelled');
			return;
		}

		await this.startRun(file, prepared.content, newTopics, { depth: selectedDepth });
	}

	/**
	 * Run a deep dive on a note without any modal: `options` answer the depth picker
	 * and stand in for the confirmation. Resolves when generation (and any
	 * auto-accept) finishes; toasts and the in-progress row behave as for the command.
	 */
	async run(notePath: string, options: DeepDiveRunOptions = {}): Promise<DeepDiveOutcome> {
		const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(notePath));
		if (!(file instanceof TFile)) {
			return failedOutcome(`Note not found: ${notePath}`);
		}
		const prepared = await this.prepareRun(file, options);
		if (!prepared.ok) return failedOutcome(prepared.message, prepared.cacheUse, prepared.cancelled ? 'cancelled' : 'failed');
		const depth = clampDepth(options.depth ?? this.getSettings().deepDive.maxDepth);
		const outcome = await this.startRun(file, prepared.content, prepared.newTopics, { ...options, depth });
		return { ...outcome, cacheUse: mergeCacheUse([prepared.cacheUse, outcome.cacheUse]) };
	}

	/**
	 * Rewrite one deep-dive note from its topic and source note, always with a fresh
	 * model call. A pending proposal gets new `proposedContent`; an accepted note gets a
	 * new body under its own frontmatter, keeping its nav block and enrichment sections.
	 * The store/vault write re-reads the proposal under its note's queue slot, so an
	 * accept that lands mid-generation is honored. Rejected proposals are refused.
	 */
	async regenerate(target: DeepDiveRegenerateTarget, job: DeepDiveJobOptions = {}): Promise<DeepDiveOutcome> {
		const proposal = await this.findProposal(target);
		if (!proposal) return failedOutcome('No deep dive proposal matches that target');
		if (proposal.status === 'rejected') return failedOutcome(`Proposal ${proposal.id} was rejected; nothing to regenerate`);
		if (proposal.status === 'accepted' && !this.noteExists(proposal.proposedPath)) {
			return failedOutcome(`Note not found at ${proposal.proposedPath}; it was deleted, or moved while deep dive was turned off`);
		}

		const sourceFile = this.plugin.app.vault.getAbstractFileByPath(normalizePath(proposal.sourceNotePath));
		if (sourceFile instanceof TFile && this.isExcluded(sourceFile)) {
			return failedOutcome(`Skipped — "${sourceFile.path}" is excluded from deep dive`);
		}
		const source = await this.resolveRegenerateSource(proposal);
		if (!source) return failedOutcome(`Source note not found: ${proposal.sourceNotePath}`);

		const cacheUse: CacheUse = {};
		const op = this.notifications.startOperation(
			`Regenerating ${proposal.topic.title}`,
			jobOpId(`deep-dive-regenerate-${proposal.id}`, job), { kind: 'deep-dive', target: proposal.proposedPath }
		);
		try {
			let generation: AIResponseInfo | undefined;
			const content = await this.generator.generateContent(
				proposal.topic, source.title, proposal.sourceNotePath, source.content,
				combineAIOptions(trackAiCache(cacheUse), { bypassCache: true, onResponse: (info) => { generation = info; } }, job.ai)
			);
			const written = await this.noteQueue.run(proposal.proposedPath, () => this.applyRegenerated(proposal.id, content, generation));
			if (typeof written === 'string') {
				op.error(written);
				return failedOutcome(written, cacheUse);
			}
			const message = `Regenerated ${proposal.topic.title}`;
			op.finish(message);
			await this.onViewRefreshNeeded?.();
			return { status: 'completed', message, runId: proposal.runId, proposalIds: [proposal.id], writtenPaths: written.writtenPaths, cacheUse };
		} catch (error) {
			const message = `Regeneration failed -- ${error instanceof Error ? error.message : String(error)}`;
			op.error(message);
			return failedOutcome(message, cacheUse);
		}
	}

	/** Queue-free core of regenerate's write; a string is the reason nothing was written. */
	private async applyRegenerated(id: string, content: string, generation?: AIResponseInfo): Promise<{ writtenPaths: string[] } | string> {
		const latest = await this.store.loadProposal(id);
		if (!latest || latest.status === 'rejected') return `Proposal ${id} was rejected or removed during regeneration`;
		const writtenPaths: string[] = [];
		if (latest.status === 'accepted') {
			if (!(await this.rewriteAcceptedNote(latest.proposedPath, content))) {
				return `Note not found at ${latest.proposedPath}; it was deleted, or moved while deep dive was turned off`;
			}
			writtenPaths.push(latest.proposedPath);
		}
		latest.proposedContent = content;
		if (generation) latest.generation = generation;
		else delete latest.generation;
		await this.store.saveProposal(latest);
		return { writtenPaths };
	}

	private noteExists(path: string): boolean {
		return this.plugin.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
	}

	/** By id, or the newest non-rejected proposal whose `proposedPath` is the note (any status when all are rejected). */
	private async findProposal(target: DeepDiveRegenerateTarget): Promise<DeepDiveProposal | null> {
		if ('proposalId' in target) return this.store.loadProposal(target.proposalId);
		const path = normalizePath(target.notePath);
		const matches = (await this.store.loadAllProposals())
			.filter(p => p.proposedPath === path)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return matches.find(p => p.status !== 'rejected') ?? matches[0] ?? null;
	}

	/** The note a proposal was generated from: the vault note when it exists, else the parent proposal's content. */
	private async resolveRegenerateSource(proposal: DeepDiveProposal): Promise<{ title: string; content: string } | null> {
		const parent = (await this.store.loadProposalsByRunId(proposal.runId))
			.find(p => p.proposedPath === proposal.sourceNotePath && p.status !== 'rejected');
		const fromVault = await readNote(this.plugin.app, proposal.sourceNotePath);
		const content = fromVault || parent?.proposedContent;
		if (!content) return null;
		const basename = proposal.sourceNotePath.split('/').pop()?.replace(/\.md$/, '') ?? proposal.sourceNotePath;
		return { title: parent?.topic.title ?? basename, content };
	}

	/** Queue-free core of regenerate's note write; false when the note is gone. */
	private async rewriteAcceptedNote(path: string, generated: string): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return false;
		const body = stripUnresolvedLinks(generated, this.plugin.app.metadataCache, path);
		await this.plugin.app.vault.process(file, (data) => mergeRegeneratedNote(data, body));
		return true;
	}

	/** Exclusion check, read, topic extraction; every stop is already toasted when this returns `ok: false`. */
	private async prepareRun(file: TFile, job: DeepDiveJobOptions): Promise<PreparedRun> {
		const scanUse: CacheUse = {};
		const stop = (message: string): PreparedRun => ({ ok: false, message, cacheUse: scanUse });

		if (this.isExcluded(file)) {
			const rule = findMatchingRule(file.path, 'deep-dive', this.getSettings());
			const message = rule
				? `Skipped — "${file.path}" is excluded by rule "${rule.pattern}"`
				: 'Note is excluded from deep dive (excluded tag)';
			this.notifications.info(message);
			return stop(message);
		}

		const content = await readNote(this.plugin.app, file.path);
		if (!content) {
			this.notifications.info('Could not read note content');
			return stop('Could not read note content');
		}

		const scanOp = this.notifications.startOperation(
			`Analyzing ${file.basename}`,
			jobOpId(`deep-dive-scan-${file.path}`, job), { kind: 'deep-dive', target: file.path }
		);

		let rootTopics: ExtractedTopic[];
		try {
			rootTopics = await this.analyzer.extractTopics(content, file.basename, [], combineAIOptions(trackAiCache(scanUse), job.ai));
		} catch (error) {
			if (scanOp.cancelled) return { ok: false, message: 'Deep dive cancelled', cacheUse: scanUse, cancelled: true };
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Topic extraction failed -- ${msg}`);
			return stop(`Topic extraction failed -- ${msg}`);
		}
		// Cancelled while the model was extracting: stop before a run or checkpoint exists.
		if (scanOp.cancelled) return { ok: false, message: 'Deep dive cancelled', cacheUse: scanUse, cancelled: true };

		if (rootTopics.length === 0) {
			scanOp.finish(withCacheReport('No topics found', [scanUse]));
			return stop('No topics found');
		}

		const newTopics = rootTopics.filter(t => !t.existsInVault);
		const existingTopics = rootTopics.filter(t => t.existsInVault);
		scanOp.finish(withCacheReport(
			`Found ${rootTopics.length} topics (${newTopics.length} new, ${existingTopics.length} existing)`,
			[scanUse]
		));

		if (newTopics.length === 0) {
			this.notifications.info('All topics already exist in vault -- nothing to generate');
			return stop('All topics already exist in vault -- nothing to generate');
		}
		return { ok: true, content, newTopics, cacheUse: scanUse };
	}

	/** Create the run and its checkpoint, then generate. */
	private async startRun(
		file: TFile,
		content: string,
		newTopics: ExtractedTopic[],
		options: DeepDiveRunOptions & { depth: number }
	): Promise<DeepDiveOutcome> {
		const settings = this.getSettings().deepDive;
		const run: DeepDiveRun = {
			id: generateId(),
			rootNotePath: file.path,
			maxDepth: options.depth,
			qualityThreshold: settings.qualityThreshold,
			proposalIds: [],
			stats: { totalProposals: 0, byDepth: {}, earlyTerminations: 0 },
			createdAt: new Date().toISOString(),
			status: 'in-progress',
		};
		if (options.maxNotes !== undefined) run.maxNotes = Math.max(1, Math.floor(options.maxNotes));
		if (options.autoAccept !== undefined) run.autoAccept = options.autoAccept;
		const tasks: DeepDiveTask[] = newTopics.map(topic => ({
			topic,
			depth: 0,
			ancestorTopics: [file.basename],
		}));
		run.pending = { tasks, processedCount: 0 };
		await this.store.saveRun(run);
		const checkpointId = await this.createRunCheckpoint(run, file, tasks);
		return this.runGeneration(file, content, run, checkpointId, options);
	}

	/** A checkpoint over `tasks`, so an interrupted run resumes; its deferred task refreshes the sidebar (I1). */
	private async createRunCheckpoint(run: DeepDiveRun, file: TFile, tasks: DeepDiveTask[]): Promise<string> {
		// Topic title is the stable item ID (C2) -- titles are unique within a run
		const workItems: CheckpointWorkItem[] = tasks.map(task => ({
			id: `topic-${task.topic.title}`,
			label: task.topic.title,
			payload: { path: file.path, topic: task.topic, depth: task.depth },
		}));
		const checkpoint = await this.checkpointManager.create({
			module: 'deep-dive',
			operationLabel: `Deep dive: ${file.basename}`,
			items: workItems,
			metadata: { runId: run.id, rootNotePath: file.path },
		});
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});
		return checkpoint.id;
	}

	/** Capped runs whose remaining topics can still be generated (#625), newest first. */
	async listContinuableRuns(): Promise<ContinuableDeepDiveRun[]> {
		const runs = await this.store.loadCappedRuns();
		return runs
			.filter(run => !this.continuing.has(run.id))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map(run => ({
				runId: run.id,
				rootNotePath: run.rootNotePath,
				remainingTopics: run.pending?.tasks.length ?? 0,
				totalProposals: run.stats.totalProposals,
				createdAt: run.createdAt,
			}));
	}

	/**
	 * Generate the topics a capped run had left (#625), under a fresh cap: `options.maxNotes`, else the
	 * run's own. Toasts like a run; auto-accept (`options.autoAccept`, else the run's setting) covers only
	 * the proposals this pass generates. Each refusal is toasted, since the toast and sidebar ignore the outcome.
	 */
	async continueRun(runId: string, options: Omit<DeepDiveRunOptions, 'depth'> = {}): Promise<DeepDiveOutcome> {
		const refuse = (message: string): DeepDiveOutcome => {
			this.notifications.info(message);
			return failedOutcome(message);
		};
		const run = await this.store.loadRun(runId);
		if (!run) return refuse(`No deep dive run with id ${runId}`);
		if (this.continuing.has(run.id)) return refuse('This deep dive is already continuing');
		if (run.endReason !== 'cap' || !run.pending || run.pending.tasks.length === 0) {
			return refuse('This deep dive has no remaining topics to continue');
		}
		const rootFile = this.plugin.app.vault.getAbstractFileByPath(run.rootNotePath);
		const rootContent = rootFile instanceof TFile ? await readNote(this.plugin.app, rootFile.path) : null;
		if (!(rootFile instanceof TFile) || rootContent === null) {
			return refuse(`Source note not found: ${run.rootNotePath}. Discard its remaining topics from the proposal sidebar.`);
		}
		if (this.isExcluded(rootFile)) return refuse(`Skipped — "${rootFile.path}" is excluded from deep dive`);
		this.continuing.add(run.id);
		try {
			run.pending.processedCount = 0;
			if (options.maxNotes !== undefined) run.maxNotes = Math.max(1, Math.floor(options.maxNotes));
			if (options.autoAccept !== undefined) run.autoAccept = options.autoAccept;
			const checkpointId = await this.createRunCheckpoint(run, rootFile, run.pending.tasks);
			return await this.runGeneration(rootFile, rootContent, run, checkpointId, options);
		} finally {
			this.continuing.delete(run.id);
		}
	}

	/** Drop a capped run's remaining topics, so it is no longer offered for continuing. */
	async discardContinuation(runId: string): Promise<boolean> {
		const run = await this.store.loadRun(runId);
		if (!run || run.endReason !== 'cap' || !run.pending || this.continuing.has(run.id)) return false;
		delete run.pending;
		await this.store.saveRun(run);
		await this.onViewRefreshNeeded?.();
		return true;
	}

	/**
	 * Breadth-first generation over `run.pending`, persisted after every proposal.
	 * A failure (e.g. the connection dropping when iOS suspends the app) keeps the
	 * checkpoint active so the run resumes where it stopped.
	 */
	private async runGeneration(rootFile: TFile, rootContent: string, run: DeepDiveRun, checkpointId: string, job: DeepDiveJobOptions = {}): Promise<DeepDiveOutcome> {
		const settings = this.getSettings().deepDive;
		const maxNotes = run.maxNotes ?? settings.maxNotesPerRun;
		const autoAccept = run.autoAccept ?? this.shouldAutoAccept();
		const pending = run.pending ?? { tasks: [], processedCount: 0 };
		run.pending = pending;
		run.status = 'in-progress';
		delete run.endReason;
		const genOp = this.notifications.startOperation('Generating deep dive', jobOpId(`deep-dive-generate-${run.id}`, job), { kind: 'deep-dive', target: rootFile.path });
		const sources = new Map<string, TaskSource>();
		const cacheUses: CacheUse[] = [];
		const generatedIds: string[] = [];
		const outcome = (status: OperationStatus, message: string, writtenPaths: string[] = []): DeepDiveOutcome => ({
			status, message, runId: run.id, proposalIds: generatedIds, writtenPaths, cacheUse: mergeCacheUse(cacheUses),
			...(run.endReason ? { endReason: run.endReason } : {}),
			...(run.endReason === 'cap' ? { remainingTopics: pending.tasks.length } : {}),
		});
		// Discards the checkpoint on user cancellation (C3).
		const endCancelled = async (): Promise<DeepDiveOutcome> => {
			run.status = 'cancelled';
			run.endReason = 'cancelled';
			delete run.pending;
			await this.store.saveRun(run);
			await this.checkpointManager.discard(checkpointId);
			this.notifications.info('Deep dive cancelled');
			await this.onViewRefreshNeeded?.();
			return outcome('cancelled', 'Deep dive cancelled');
		};
		const stopPauseNotice = this.watchMobilePause();

		try {
			while (pending.tasks.length > 0 && pending.processedCount < maxNotes) {
				if (genOp.cancelled) break;

				const task = pending.tasks[0];
				const source = await this.resolveTaskSource(task, rootFile, rootContent, sources);
				if (!source) {
					pending.tasks.shift();
					continue;
				}
				genOp.progress(pending.processedCount + 1, maxNotes, 'Generating deep dive');

				const { topic } = task;
				const cacheUse: CacheUse = {};
				const aiOpts = combineAIOptions(trackAiCache(cacheUse), job.ai);
				let generation: AIResponseInfo | undefined;
				const noteContent = await this.generator.generateContent(
					topic, source.title, source.path, source.content, combineAIOptions(aiOpts, { onResponse: (info) => { generation = info; } })
				);
				const proposedPath = await this.buildProposedPath(topic.title, rootFile, source.parentProposedPath, aiOpts);

				// Score quality using child topics (extracted from generated content)
				const childAncestors = [...task.ancestorTopics, topic.title];
				let childTopics: ExtractedTopic[] = [];
				if (task.depth + 1 < run.maxDepth) {
					try {
						childTopics = await this.analyzer.extractTopics(noteContent, topic.title, childAncestors, aiOpts);
					} catch (error) {
						if (isJobCallRefused(error)) throw error;
						childTopics = [];
					}
				}

				const quality = scoreQuality({
					title: topic.title,
					childTopicTitles: childTopics.map(t => t.title),
					wordCount: wordCount(noteContent),
					depth: task.depth,
					maxDepth: run.maxDepth,
					ancestorTopics: task.ancestorTopics,
				});

				const proposal: DeepDiveProposal = {
					id: generateId(),
					runId: run.id,
					sourceNotePath: source.path,
					topic,
					proposedPath,
					proposedContent: noteContent,
					depth: task.depth,
					qualityScore: quality,
					childProposalIds: [],
					createdAt: new Date().toISOString(),
					status: 'pending',
					...(generation ? { generation } : {}),
				};

				await this.store.saveProposal(proposal);
				cacheUses.push(cacheUse);
				sources.set(proposal.id, { content: noteContent, title: topic.title, path: proposedPath, parentProposedPath: proposedPath });
				run.proposalIds.push(proposal.id);
				generatedIds.push(proposal.id);
				run.stats.totalProposals++;
				run.stats.byDepth[task.depth] = (run.stats.byDepth[task.depth] || 0) + 1;

				if (task.parentProposalId) {
					const parent = await this.store.loadProposal(task.parentProposalId);
					if (parent) {
						parent.childProposalIds.push(proposal.id);
						await this.store.saveProposal(parent);
					}
				}

				await this.checkpointManager.completeItem(checkpointId, `topic-${topic.title}`);

				pending.tasks.shift();
				pending.processedCount++;
				if (quality.score >= settings.qualityThreshold && task.depth + 1 < run.maxDepth) {
					for (const child of childTopics.filter(t => !t.existsInVault)) {
						pending.tasks.push({
							topic: child,
							depth: task.depth + 1,
							ancestorTopics: childAncestors,
							parentProposalId: proposal.id,
						});
					}
				} else if (quality.score < settings.qualityThreshold) {
					run.stats.earlyTerminations++;
				}
				await this.store.saveRun(run);
			}

			if (genOp.cancelled) return await endCancelled();
			const endReason: DeepDiveEndReason = pending.tasks.length > 0 ? 'cap' : 'exhausted';
			run.status = 'completed';
			run.endReason = endReason;
			if (endReason !== 'cap') delete run.pending;
			await this.store.saveRun(run);

			// Mark checkpoint completed and dispatch deferred tasks (I1)
			const deferred = await this.checkpointManager.complete(checkpointId);
			this.dispatchDeferredTasks(deferred);
			const depthSummary = Object.entries(run.stats.byDepth)
				.map(([d, c]) => `depth ${d}: ${c}`)
				.join(', ');
			// Review action only when proposals were generated AND deep-dive
			// auto-accept is off — auto-accept (applied right after) creates
			// every note, leaving nothing to review (#366).
			const capNote = endReason === 'cap'
				? ` -- stopped at the ${maxNotes}-note cap with ${pending.tasks.length} ${pending.tasks.length === 1 ? 'topic' : 'topics'} left`
				: '';
			const finishLine = withCacheReport(`Generated ${run.stats.totalProposals} proposals (${depthSummary})${capNote}`, cacheUses, 'proposal');
			genOp.finish(
				finishLine,
				endReason === 'cap'
					? { label: 'Continue', onClick: () => fireAndForget(this.continueRun(run.id), 'Continue deep dive') }
					: reviewAction({
						generated: run.stats.totalProposals > 0,
						shouldAutoAccept: () => autoAccept,
						openProposalView: this.onOpenProposalView,
					})
			);

			// Auto-accept the whole generated tree if enabled (#228), in
			// creation order so navigation resolves. Skipped on cancellation.
			const accepted = autoAccept ? await this.autoAcceptRun(generatedIds) : [];
			await this.onViewRefreshNeeded?.();
			return outcome('completed', finishLine, accepted);
		} catch (error) {
			// A cancel that rejected a model call in flight (e.g. an external request, #626) ends the run as cancelled.
			if (genOp.cancelled) return await endCancelled();
			// Keep the run and checkpoint resumable; generated proposals stay saved.
			run.endReason = 'error';
			try {
				await this.store.saveRun(run);
			} catch {
				// The last per-proposal save still holds the queue up to the previous step
			}
			const msg = error instanceof Error ? error.message : String(error);
			const message = `Deep dive interrupted -- ${msg}. Resume it from "Manage interrupted operations".`;
			genOp.error(message);
			await this.onViewRefreshNeeded?.();
			return outcome('failed', message);
		} finally {
			stopPauseNotice();
		}
	}

	/** On mobile the OS suspends a backgrounded app, so tell the user the run is picking back up when they return. */
	private watchMobilePause(): () => void {
		const doc = typeof activeDocument === 'undefined' ? undefined : activeDocument;
		if (!Platform.isMobile || !doc) return () => {};
		let wasHidden = false;
		const onChange = () => {
			if (doc.visibilityState === 'hidden') {
				wasHidden = true;
			} else if (wasHidden) {
				wasHidden = false;
				this.notifications.info(DEEP_DIVE_RESUMING_MESSAGE);
			}
		};
		doc.addEventListener('visibilitychange', onChange);
		return () => doc.removeEventListener('visibilitychange', onChange);
	}

	/** Source note for a task: the root note, or its parent proposal (null when that proposal is gone). */
	private async resolveTaskSource(
		task: DeepDiveTask,
		rootFile: TFile,
		rootContent: string,
		sources: Map<string, TaskSource>
	): Promise<TaskSource | null> {
		if (!task.parentProposalId) {
			return { content: rootContent, title: rootFile.basename, path: rootFile.path };
		}
		const known = sources.get(task.parentProposalId);
		if (known) return known;
		const parent = await this.store.loadProposal(task.parentProposalId);
		if (!parent || parent.status === 'rejected') return null;
		const source = { content: parent.proposedContent, title: parent.topic.title, path: parent.proposedPath, parentProposedPath: parent.proposedPath };
		sources.set(parent.id, source);
		return source;
	}

	/**
	 * Recompute and update navigation for all accepted proposals in a run.
	 *
	 * When newNotePath and newNoteContent are provided (accept flow), the new
	 * note is written with navigation injected. All previously accepted notes
	 * in the run are also updated with refreshed prev/next links. The syllabus
	 * index note is generated or updated.
	 */
	private async updateRunNavigation(
		runId: string,
		newNotePath?: string,
		newNoteContent?: string
	): Promise<void> {
		const run = await this.store.loadRun(runId);
		if (!run) return;

		const proposals = await this.store.loadProposalsByRunId(runId);
		const nodes = computeTraversalOrder(proposals, run);

		if (nodes.length === 0) {
			// All proposals rejected -- remove syllabus if it exists
			const sPath = this.syllabusPathFor(run);
			const existingSyllabus = this.plugin.app.vault.getAbstractFileByPath(normalizePath(sPath));
			if (existingSyllabus instanceof TFile) {
				// trashFile honors the user's "Deleted files" preference so the
				// syllabus is recoverable rather than permanently deleted.
				await this.plugin.app.fileManager.trashFile(existingSyllabus);
			}
			return;
		}

		const sPath = this.syllabusPathFor(run);

		// Write or update the syllabus index note
		const syllabusContent = renderSyllabusContent(nodes, run, (path) => linkpathFor(this.plugin.app, path));
		await writeNote(this.plugin.app, sPath, syllabusContent);

		// Update navigation in each accepted note
		for (const node of nodes) {
			const ctx = buildNavigationContext(node.proposalId, nodes, run, sPath);
			if (!ctx) continue;

			const navBlock = renderNavigationBlock(ctx, (path) => linkpathFor(this.plugin.app, path));

			if (newNotePath && node.proposedPath === newNotePath && newNoteContent) {
				// This is the newly accepted note -- inject nav into its content and write
				const contentWithNav = injectNavigationBlock(newNoteContent, navBlock);
				await writeNote(this.plugin.app, node.proposedPath, contentWithNav);
			} else {
				// Previously accepted note -- read current content, update nav, write back
				const existing = await readNote(this.plugin.app, node.proposedPath);
				if (existing) {
					const updated = injectNavigationBlock(existing, navBlock);
					await writeNote(this.plugin.app, node.proposedPath, updated);
				}
			}
		}
	}

	private async clearProposals(): Promise<void> {
		await this.store.deleteAllProposals();
		this.notifications.success('Deep dive proposals cleared');
		await this.onViewRefreshNeeded?.();
	}

	private async buildProposedPath(
		topicTitle: string,
		rootFile: TFile,
		parentProposedPath?: string,
		aiOpts?: AIRequestOptions
	): Promise<string> {
		const settings = this.getSettings().deepDive;
		const mode = settings.nestingMode || 'nested';

		if (mode === 'auto-organize') {
			return this.buildAutoOrganizedPath(topicTitle, rootFile, parentProposedPath, aiOpts);
		}

		return buildDeepDivePath(topicTitle, rootFile, settings, parentProposedPath);
	}

	/** Place via organize's folder suggestion when wired; nested placement otherwise or on any failure. */
	private async buildAutoOrganizedPath(
		topicTitle: string,
		rootFile: TFile,
		parentProposedPath?: string,
		aiOpts?: AIRequestOptions
	): Promise<string> {
		const settings = this.getSettings().deepDive;
		if (this.suggestDirectory) {
			try {
				const directory = await this.suggestDirectory(topicTitle, aiOpts);
				if (directory) {
					const safeName = safeNoteName(topicTitle);
					return normalizePath(`${directory}/${safeName}.md`);
				}
			} catch (error) {
				if (isJobCallRefused(error)) throw error;
				// Fall back to nested if the suggestion fails
			}
		}
		return buildDeepDivePath(topicTitle, rootFile, settings, parentProposedPath);
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings();
		return (
			isPathExcluded(file.path, 'deep-dive', settings) ||
			matchesExcludeTag(file, settings.deepDive.excludeTags, this.plugin.app.metadataCache)
		);
	}

	/** Dispatch deferred tasks (I1). */
	private dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					if (this.onViewRefreshNeeded) {
						fireAndForget(this.onViewRefreshNeeded(), 'Refresh proposal view', {
							background: true,
						});
					}
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}
}

/** AI-chosen topic title as a file/folder name: no separators, and no leading dots (a `..` segment or a hidden file). */
function safeNoteName(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, '-').trim().replace(/^\.+/, '').trim() || 'Untitled';
}

/**
 * Exported for testing. Builds the proposed vault path for a deep-dive note.
 *
 * When nestingMode is 'nested' and a parentProposedPath is provided,
 * children are placed in a subfolder named after the parent topic:
 *
 *   Deep Dives/Machine Learning/
 *     Neural Networks.md
 *     Neural Networks/
 *       Backpropagation.md
 *       Activation Functions.md
 *
 * When nestingMode is 'flat' (or no parentProposedPath), all notes land
 * in the root subfolder: Deep Dives/Machine Learning/Backpropagation.md
 */
export function buildDeepDivePath(
	topicTitle: string,
	rootFile: TFile,
	settings: { noteOutputFolder: string; nestingMode?: DeepDiveNestingMode },
	parentProposedPath?: string,
): string {
	const safeName = safeNoteName(topicTitle);
	const mode = settings.nestingMode || 'nested';

	// In nested mode with a parent, place children under a subfolder
	// named after the parent note (derived from the parent's proposed path).
	if (mode === 'nested' && parentProposedPath) {
		// parentProposedPath is e.g. "Deep Dives/Machine Learning/Neural Networks.md"
		// We want: "Deep Dives/Machine Learning/Neural Networks/Backpropagation.md"
		const parentFolder = parentProposedPath.replace(/\.md$/, '');
		const path = `${parentFolder}/${safeName}.md`;
		return normalizePath(path);
	}

	// Flat mode or root-level topics: place in the root subfolder
	let folder: string;
	if (settings.noteOutputFolder) {
		// Per-root subfolder: Deep Dives/Machine Learning/
		folder = `${settings.noteOutputFolder}/${rootFile.basename}`;
	} else {
		// Same folder as source note (user explicitly cleared the setting)
		const parent = rootFile.parent?.path;
		folder = parent || '';
	}

	const path = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;
	return normalizePath(path);
}

// Settings section renderer (#243)
export { renderDeepDiveSettings } from './settings-section';
