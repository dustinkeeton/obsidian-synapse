import { Plugin, TFile, normalizePath } from 'obsidian';
import { SynapseSettings, DeepDiveNestingMode } from '../settings';
import { CommandRegistrar } from '../commands';
import {
	NotificationManager, readNote, writeNote, wordCount,
	CheckpointManager, generateId, fireAndForget,
	isPathExcluded, matchesExcludeTag, findMatchingRule,
} from '../shared';
import type { Checkpoint, CheckpointWorkItem, DeferredTask } from '../shared';
import { ContentAnalyzer, DirectoryMatcher } from '../organize';
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
import { selectDepth } from './depth-selector-modal';
import { TopicAnalyzer } from './topic-analyzer';
import {
	DeepDiveProposal,
	DeepDiveRun,
	ExtractedTopic,
} from './types';

export type {
	DeepDiveProposal,
	DeepDiveRun,
	ExtractedTopic,
	QualityScore,
	DeepDiveProposalStatus,
	DeepDiveRunStatus,
} from './types';

export type { TraversalNode, NavigationContext } from './syllabus-navigator';
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

export class DeepDiveModule {
	onViewRefreshNeeded: (() => Promise<void>) | null = null;
	onNoteAccepted: ((filePath: string) => void) | null = null;
	onOrganizeRequested: ((file: TFile) => void) | null = null;

	/** Optional callback to open the unified proposal view. Wired by main.ts (#340). */
	onOpenProposalView: (() => void) | null = null;

	private analyzer: TopicAnalyzer;
	private generator: NoteGenerator;
	private store: DeepDiveStore;
	private contentAnalyzer: ContentAnalyzer;
	private directoryMatcher: DirectoryMatcher;

	/**
	 * Live accessor for the deep-dive auto-accept flag (#228). Wired by main.ts
	 * to `() => this.settings.autoAccept['deep-dive']`. Defaults to "never
	 * auto-accept". Deep dive generates a tree; auto-accept creates every
	 * generated node's note (in creation order, after the run finishes).
	 */
	private shouldAutoAccept: () => boolean = () => false;

	constructor(
		private plugin: Plugin,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
		private checkpointManager: CheckpointManager,
		private registrar: CommandRegistrar,
		shouldAutoAccept?: () => boolean
	) {
		if (shouldAutoAccept) this.shouldAutoAccept = shouldAutoAccept;
		this.analyzer = new TopicAnalyzer(plugin.app, getSettings);
		this.generator = new NoteGenerator(getSettings);
		this.store = new DeepDiveStore(plugin.app, getSettings);
		this.contentAnalyzer = new ContentAnalyzer(plugin.app, getSettings);
		this.directoryMatcher = new DirectoryMatcher(plugin.app);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.registrar.register('deep-dive', this.getSettings().deepDive.enabled, {
			name: 'Deep dive current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.deepDive(ctx.file);
				}
			},
		});

		this.registrar.register('clear-deep-dive', this.getSettings().deepDive.enabled, {
			name: 'Clear deep dive proposals',
			callback: async () => {
				await this.clearProposals();
			},
		});
	}

	onunload(): void {}

	async getPendingProposals(): Promise<DeepDiveProposal[]> {
		return this.store.loadPendingProposals();
	}

	/**
	 * Resume a deep-dive from a checkpoint (C1).
	 * The remaining items cannot be directly resumed because deep-dive
	 * uses a recursive topic-extraction queue. Instead, we discard the
	 * checkpoint and notify the user to re-run the deep dive.
	 */
	async resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> {
		this.notifications.info(
			`Deep dive checkpoint has ${checkpoint.remainingItems.length} remaining items. ` +
			`Completed items are already saved. Please re-run deep dive on the source note to continue.`
		);
		await this.checkpointManager.discard(checkpoint.id);
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
	async acceptProposal(id: string, options?: { silent?: boolean }): Promise<void> {
		const proposal = await this.store.loadProposal(id);
		if (!proposal) {
			this.notifications.info('Proposal not found');
			return;
		}
		// Guard against double-acceptance (cascade safety): never create the
		// note twice for the same proposal.
		if (proposal.status !== 'pending') return;

		try {
			await this.store.updateProposalStatus(id, 'accepted');

			// Build navigation for all accepted proposals in this run
			await this.updateRunNavigation(proposal.runId, proposal.proposedPath, proposal.proposedContent);

			if (!options?.silent) {
				this.notifications.success(`Created ${proposal.proposedPath}`);
			}

			// Trigger enrichment on the new note
			this.onNoteAccepted?.(proposal.proposedPath);

			// Trigger organize on the new note if enabled
			if (this.getSettings().deepDive.autoOrganizeOnAccept) {
				const file = this.plugin.app.vault.getAbstractFileByPath(
					normalizePath(proposal.proposedPath)
				);
				if (file instanceof TFile) {
					this.onOrganizeRequested?.(file);
				}
			}

			if (!options?.silent) {
				await this.onViewRefreshNeeded?.();
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to accept proposal', error);
			throw new Error(`Accept proposal failed: ${msg}`);
		}
	}

	/**
	 * Auto-accept all proposals generated in a run (#228), if the deep-dive
	 * auto-accept flag is on. Accepts in creation order (parents before
	 * children, per the BFS queue) so navigation resolves correctly, then emits
	 * a single summary Notice. Returns the number accepted.
	 *
	 * Done AFTER the generation loop (not mid-loop) so the recursive queue is
	 * not disturbed and navigation is not rebuilt on every node mid-flight.
	 */
	private async maybeAutoAcceptRun(proposalIds: string[]): Promise<number> {
		if (!this.shouldAutoAccept()) return 0;
		let accepted = 0;
		for (const id of proposalIds) {
			// acceptProposal re-loads and re-checks pending, so a child whose
			// parent was already accepted is still safe.
			await this.acceptProposal(id, { silent: true });
			accepted++;
		}
		if (accepted > 0) {
			this.notifications.info(
				`Auto-accepted ${accepted} deep dive note${accepted === 1 ? '' : 's'}`
			);
		}
		return accepted;
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
	 * Main deep dive flow:
	 * 1. Extract topics from root note
	 * 2. Confirm with user
	 * 3. Recursive generation loop
	 */
	private async deepDive(file: TFile): Promise<void> {
		if (this.isExcluded(file)) {
			const rule = findMatchingRule(file.path, 'deep-dive', this.getSettings());
			this.notifications.info(
				rule
					? `Skipped — "${file.path}" is excluded by rule "${rule.pattern}"`
					: 'Note is excluded from deep dive (excluded tag)'
			);
			return;
		}

		const settings = this.getSettings().deepDive;
		const content = await readNote(this.plugin.app, file.path);
		if (!content) {
			this.notifications.info('Could not read note content');
			return;
		}

		// Phase 1: Extract topics from root note
		const scanOp = this.notifications.startOperation(
			`Analyzing ${file.basename}`,
			`deep-dive-scan-${file.path}`
		);

		let rootTopics: ExtractedTopic[];
		try {
			rootTopics = await this.analyzer.extractTopics(content, file.basename, []);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			scanOp.error(`Topic extraction failed -- ${msg}`);
			return;
		}

		if (rootTopics.length === 0) {
			scanOp.finish('No topics found');
			return;
		}

		const newTopics = rootTopics.filter(t => !t.existsInVault);
		const existingTopics = rootTopics.filter(t => t.existsInVault);
		scanOp.finish(
			`Found ${rootTopics.length} topics (${newTopics.length} new, ${existingTopics.length} existing)`
		);

		if (newTopics.length === 0) {
			this.notifications.info('All topics already exist in vault -- nothing to generate');
			return;
		}

		// Phase 2a: Select recursion depth
		const selectedDepth = await selectDepth(this.plugin.app, settings.maxDepth);
		if (selectedDepth === null) {
			this.notifications.info('Deep dive cancelled');
			return;
		}

		// Phase 2b: Confirm with user
		const proceed = await this.notifications.confirm(
			`Found ${newTopics.length} new topic${newTopics.length === 1 ? '' : 's'} to explore (depth ${selectedDepth}). Generate deep dive?`,
			{ proceedLabel: 'Generate', cancelLabel: 'Cancel' }
		);

		if (!proceed) {
			this.notifications.info('Deep dive cancelled');
			return;
		}

		// Phase 3: Recursive generation
		const run: DeepDiveRun = {
			id: generateId(),
			rootNotePath: file.path,
			maxDepth: selectedDepth,
			qualityThreshold: settings.qualityThreshold,
			proposalIds: [],
			stats: { totalProposals: 0, byDepth: {}, earlyTerminations: 0 },
			createdAt: new Date().toISOString(),
			status: 'in-progress',
		};

		const genOp = this.notifications.startOperation(
			'Generating deep dive',
			'deep-dive-generate'
		);

		// Create checkpoint for resumability
		// Use topic title as the stable ID (C2) -- titles are unique within a run
		const workItems: CheckpointWorkItem[] = rootTopics
			.filter(t => !t.existsInVault)
			.map((topic) => ({
				id: `topic-${topic.title}`,
				label: topic.title,
				payload: {
					content,
					title: file.basename,
					path: file.path,
					topic,
					depth: 0,
					ancestorTopics: [file.basename],
				},
			}));

		const checkpoint = await this.checkpointManager.create({
			module: 'deep-dive',
			operationLabel: `Deep dive: ${file.basename}`,
			items: workItems,
			metadata: { runId: run.id, rootNotePath: file.path },
		});

		// Register deferred task for sidebar refresh (I1)
		await this.checkpointManager.addDeferredTask(checkpoint.id, {
			id: generateId(),
			type: 'refresh-sidebar-view',
			data: {},
		});

		try {
			// Queue: items to process at each depth
			type QueueItem = {
				content: string;
				title: string;
				path: string;
				topics: ExtractedTopic[];
				depth: number;
				ancestorTopics: string[];
				parentProposalId?: string;
				/** The proposed path of the parent note (used for nested folder placement). */
				parentProposedPath?: string;
			};

			const queue: QueueItem[] = [{
				content,
				title: file.basename,
				path: file.path,
				topics: rootTopics,
				depth: 0,
				ancestorTopics: [file.basename],
			}];

			let processedCount = 0;

			while (queue.length > 0 && processedCount < settings.maxNotesPerRun) {
				if (genOp.cancelled) break;

				const item = queue.shift()!;
				const newTopicsForItem = item.topics.filter(t => !t.existsInVault);

				for (const topic of newTopicsForItem) {
					if (genOp.cancelled || processedCount >= settings.maxNotesPerRun) break;

					processedCount++;
					genOp.progress(processedCount, settings.maxNotesPerRun, 'Generating deep dive');

					// Generate content for this topic
					const noteContent = await this.generator.generateContent(
						topic,
						item.title,
						item.content
					);

					const proposedPath = await this.buildProposedPath(
					topic.title,
					file,
					item.parentProposedPath
				);

					// Score quality using child topics (extracted from generated content)
					const childAncestors = [...item.ancestorTopics, topic.title];
					let childTopics: ExtractedTopic[] = [];

					// Only extract child topics if we haven't reached max depth
					if (item.depth + 1 < run.maxDepth) {
						try {
							childTopics = await this.analyzer.extractTopics(
								noteContent,
								topic.title,
								childAncestors
							);
						} catch {
							// If child extraction fails, score based on content alone
							childTopics = [];
						}
					}

					const quality = scoreQuality({
						title: topic.title,
						childTopicTitles: childTopics.map(t => t.title),
						wordCount: wordCount(noteContent),
						depth: item.depth,
						maxDepth: run.maxDepth,
						ancestorTopics: item.ancestorTopics,
					});

					// Create proposal
					const proposal: DeepDiveProposal = {
						id: generateId(),
						runId: run.id,
						sourceNotePath: item.path,
						topic,
						proposedPath,
						proposedContent: noteContent,
						depth: item.depth,
						qualityScore: quality,
						childProposalIds: [], // Will be populated by children
						createdAt: new Date().toISOString(),
						status: 'pending',
					};

					await this.store.saveProposal(proposal);
					run.proposalIds.push(proposal.id);
					run.stats.totalProposals++;
					run.stats.byDepth[item.depth] = (run.stats.byDepth[item.depth] || 0) + 1;

					// Link child to parent
					if (item.parentProposalId) {
						const parent = await this.store.loadProposal(item.parentProposalId);
						if (parent) {
							parent.childProposalIds.push(proposal.id);
							await this.store.saveProposal(parent);
						}
					}

					// Save checkpoint progress using stable topic-title ID (C2)
					const itemId = `topic-${topic.title}`;
					await this.checkpointManager.completeItem(checkpoint.id, itemId);

					// Queue children if quality is above threshold and depth allows
					if (
						quality.score >= settings.qualityThreshold &&
						item.depth + 1 < run.maxDepth &&
						childTopics.length > 0
					) {
						queue.push({
							content: noteContent,
							title: topic.title,
							path: proposedPath,
							topics: childTopics,
							depth: item.depth + 1,
							ancestorTopics: childAncestors,
							parentProposalId: proposal.id,
							parentProposedPath: proposedPath,
						});
					} else if (quality.score < settings.qualityThreshold) {
						run.stats.earlyTerminations++;
					}
				}
			}

			run.status = genOp.cancelled ? 'cancelled' : 'completed';
			await this.store.saveRun(run);

			if (genOp.cancelled) {
				// Discard checkpoint on user cancellation (C3)
				await this.checkpointManager.discard(checkpoint.id);
				this.notifications.info('Deep dive cancelled');
			} else {
				// Mark checkpoint completed and dispatch deferred tasks (I1)
				const tasks = await this.checkpointManager.complete(checkpoint.id);
				this.dispatchDeferredTasks(tasks);
				const depthSummary = Object.entries(run.stats.byDepth)
					.map(([d, c]) => `depth ${d}: ${c}`)
					.join(', ');
				// Review action only when proposals remain pending — auto-accept
				// (applied right after) creates every note, leaving nothing to
				// review (#340).
				genOp.finish(
					`Generated ${run.stats.totalProposals} proposals (${depthSummary})`,
					run.stats.totalProposals > 0 && !this.shouldAutoAccept()
						? { label: 'Review', onClick: () => this.onOpenProposalView?.() }
						: undefined
				);

				// Auto-accept the whole generated tree if enabled (#228), in
				// creation order so navigation resolves. Skipped on cancellation.
				await this.maybeAutoAcceptRun(run.proposalIds);
			}

			await this.onViewRefreshNeeded?.();
		} catch (error) {
			run.status = 'cancelled';
			await this.store.saveRun(run);
			// Discard checkpoint on error (M7)
			await this.checkpointManager.discard(checkpoint.id);
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Deep dive failed -- ${msg}`);
		}
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
			const sPath = syllabusPath(run.rootNotePath, this.getSettings().deepDive.noteOutputFolder);
			const existingSyllabus = this.plugin.app.vault.getAbstractFileByPath(normalizePath(sPath));
			if (existingSyllabus instanceof TFile) {
				// trashFile honors the user's "Deleted files" preference so the
				// syllabus is recoverable rather than permanently deleted.
				await this.plugin.app.fileManager.trashFile(existingSyllabus);
			}
			return;
		}

		const sPath = syllabusPath(run.rootNotePath, this.getSettings().deepDive.noteOutputFolder);

		// Write or update the syllabus index note
		const syllabusContent = renderSyllabusContent(nodes, run);
		await writeNote(this.plugin.app, sPath, syllabusContent);

		// Update navigation in each accepted note
		for (const node of nodes) {
			const ctx = buildNavigationContext(node.proposalId, nodes, run, sPath);
			if (!ctx) continue;

			const navBlock = renderNavigationBlock(ctx);

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
		parentProposedPath?: string
	): Promise<string> {
		const settings = this.getSettings().deepDive;
		const mode = settings.nestingMode || 'nested';

		if (mode === 'auto-organize') {
			return this.buildAutoOrganizedPath(topicTitle, rootFile, parentProposedPath);
		}

		return buildDeepDivePath(topicTitle, rootFile, settings, parentProposedPath);
	}

	/**
	 * Use the organize module's ContentAnalyzer + DirectoryMatcher to
	 * determine the best placement based on content semantics.
	 * Falls back to nested placement if no good match is found.
	 */
	private async buildAutoOrganizedPath(
		topicTitle: string,
		rootFile: TFile,
		parentProposedPath?: string
	): Promise<string> {
		const settings = this.getSettings().deepDive;
		try {
			const topics = await this.contentAnalyzer.extractTopics(
				topicTitle,
				[]
			);

			if (topics.length > 0) {
				// Build a synthetic ContentAnalysis to pass to the directory matcher
				const analysis = {
					notePath: '',
					topics,
					tags: [],
					links: [],
				};

				const scores = this.directoryMatcher.scoreDirectories(analysis);
				if (scores.length > 0 && scores[0].score >= 0.6) {
					const safeName = topicTitle.replace(/[\\/:*?"<>|]/g, '-').trim();
					const path = `${scores[0].directoryPath}/${safeName}.md`;
					return normalizePath(path);
				}
			}
		} catch {
			// Fall back to nested if AI analysis fails
		}

		// Default: fall back to nested placement
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
	const safeName = topicTitle.replace(/[\\/:*?"<>|]/g, '-').trim();
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
