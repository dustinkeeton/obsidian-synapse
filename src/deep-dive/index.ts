import { Plugin, TFile, normalizePath } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { NotificationManager, ensureFolder, readNote, writeNote, wordCount } from '../shared';
import { DeepDiveStore } from './deep-dive-store';
import { NoteGenerator } from './note-generator';
import { scoreQuality } from './quality-scorer';
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

export class DeepDiveModule {
	onViewRefreshNeeded: (() => Promise<void>) | null = null;
	onNoteAccepted: ((filePath: string) => void) | null = null;
	onOrganizeRequested: ((file: TFile) => void) | null = null;

	private analyzer: TopicAnalyzer;
	private generator: NoteGenerator;
	private store: DeepDiveStore;

	constructor(
		private plugin: Plugin,
		private getSettings: () => AutoNotesSettings,
		private notifications: NotificationManager
	) {
		this.analyzer = new TopicAnalyzer(plugin.app, getSettings);
		this.generator = new NoteGenerator(getSettings);
		this.store = new DeepDiveStore(plugin.app, getSettings);
	}

	async onload(): Promise<void> {
		await this.store.init();

		this.plugin.addCommand({
			id: 'auto-notes:deep-dive',
			name: 'Deep dive into current note',
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.deepDive(ctx.file);
				}
			},
		});

		this.plugin.addCommand({
			id: 'auto-notes:clear-deep-dive',
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
	 * Accept a proposal: create the new note in the vault.
	 */
	async acceptProposal(id: string): Promise<void> {
		const proposal = await this.store.loadProposal(id);
		if (!proposal) {
			this.notifications.info('Proposal not found');
			return;
		}

		try {
			await writeNote(this.plugin.app, proposal.proposedPath, proposal.proposedContent);
			await this.store.updateProposalStatus(id, 'accepted');
			this.notifications.success(`Created ${proposal.proposedPath}`);

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

			await this.onViewRefreshNeeded?.();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.notifications.notifyError('Failed to accept proposal', error);
			throw new Error(`Accept proposal failed: ${msg}`);
		}
	}

	/**
	 * Reject a proposal and cascade-reject all its children.
	 */
	async rejectProposal(id: string): Promise<void> {
		const rejected = await this.store.cascadeReject(id);
		const count = rejected.length;
		this.notifications.info(
			count > 1 ? `Rejected ${count} proposals (including children)` : 'Proposal rejected'
		);
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
			this.notifications.info('Note is in an excluded folder or has an excluded tag');
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
			scanOp.error(`Topic extraction failed — ${msg}`);
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
			this.notifications.info('All topics already exist in vault — nothing to generate');
			return;
		}

		// Phase 2: Confirm with user
		const proceed = await this.notifications.confirm(
			`Found ${newTopics.length} new topic${newTopics.length === 1 ? '' : 's'} to explore (depth ${settings.maxDepth}). Generate deep dive?`,
			{ proceedLabel: 'Generate', cancelLabel: 'Cancel' }
		);

		if (!proceed) {
			this.notifications.info('Deep dive cancelled');
			return;
		}

		// Phase 3: Recursive generation
		const run: DeepDiveRun = {
			id: this.generateId(),
			rootNotePath: file.path,
			maxDepth: settings.maxDepth,
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

					const proposedPath = this.buildProposedPath(topic.title, file);

					// Score quality using child topics (extracted from generated content)
					const childAncestors = [...item.ancestorTopics, topic.title];
					let childTopics: ExtractedTopic[] = [];

					// Only extract child topics if we haven't reached max depth
					if (item.depth + 1 < settings.maxDepth) {
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
						maxDepth: settings.maxDepth,
						ancestorTopics: item.ancestorTopics,
					});

					// Create proposal
					const proposal: DeepDiveProposal = {
						id: this.generateId(),
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

					// Queue children if quality is above threshold and depth allows
					if (
						quality.score >= settings.qualityThreshold &&
						item.depth + 1 < settings.maxDepth &&
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
						});
					} else if (quality.score < settings.qualityThreshold) {
						run.stats.earlyTerminations++;
					}
				}
			}

			run.status = genOp.cancelled ? 'cancelled' : 'completed';
			await this.store.saveRun(run);

			if (genOp.cancelled) {
				this.notifications.info('Deep dive cancelled');
			} else {
				const depthSummary = Object.entries(run.stats.byDepth)
					.map(([d, c]) => `depth ${d}: ${c}`)
					.join(', ');
				genOp.finish(
					`Generated ${run.stats.totalProposals} proposals (${depthSummary})`
				);
			}

			await this.onViewRefreshNeeded?.();
		} catch (error) {
			run.status = 'cancelled';
			await this.store.saveRun(run);
			const msg = error instanceof Error ? error.message : String(error);
			genOp.error(`Deep dive failed — ${msg}`);
		}
	}

	private async clearProposals(): Promise<void> {
		await this.store.deleteAllProposals();
		this.notifications.success('Deep dive proposals cleared');
		await this.onViewRefreshNeeded?.();
	}

	private buildProposedPath(topicTitle: string, rootFile: TFile): string {
		const settings = this.getSettings().deepDive;
		const safeName = topicTitle.replace(/[\\/:*?"<>|]/g, '-').trim();

		let folder: string;
		if (settings.noteOutputFolder) {
			folder = settings.noteOutputFolder;
		} else {
			// Same folder as the source note
			const parent = rootFile.parent?.path;
			folder = parent || '';
		}

		const path = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;
		return normalizePath(path);
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings().deepDive;

		for (const folder of settings.excludeFolders) {
			if (file.path.startsWith(folder + '/')) return true;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.tags) {
			const fileTags: string[] = Array.isArray(cache.frontmatter.tags)
				? cache.frontmatter.tags
				: [cache.frontmatter.tags];
			for (const excludeTag of settings.excludeTags) {
				const normalized = excludeTag.startsWith('#')
					? excludeTag.slice(1)
					: excludeTag;
				if (fileTags.includes(normalized)) return true;
			}
		}

		return false;
	}

	private generateId(): string {
		return (
			Date.now().toString(36) +
			Math.random().toString(36).slice(2, 10)
		);
	}
}
