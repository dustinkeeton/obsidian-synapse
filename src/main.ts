import { Platform, Plugin } from 'obsidian';
import { AutoNotesSettings, DEFAULT_SETTINGS } from './settings';
import { AutoNotesSettingTab } from './settings-tab';
import { ElaborationModule } from './elaboration';
import { AudioModule } from './audio';
import { VideoModule } from './video';
import { EnrichmentModule } from './enrichment';
import { SummarizeModule } from './summarize';
import { TidyModule } from './tidy';
import { OrganizeModule } from './organize';
import { DeepDiveModule } from './deep-dive';
import { NotificationManager, CheckpointManager } from './shared';
import type { DeferredTask, Checkpoint } from './shared';
import { UnifiedTranscriptionModal, NoteMediaModal } from './transcription';
import { findAudioEmbeds } from './audio';
import { findVideoUrls } from './video';
import {
	UNIFIED_VIEW_TYPE,
	UnifiedProposalView,
	UnifiedItem,
} from './views/unified-proposal-view';

export default class AutoNotesPlugin extends Plugin {
	settings!: AutoNotesSettings;
	notifications!: NotificationManager;
	private checkpointManager!: CheckpointManager;

	private elaboration!: ElaborationModule;
	private audio!: AudioModule;
	private video: VideoModule | null = null;
	private enrichment!: EnrichmentModule;
	private summarize!: SummarizeModule;
	private tidy!: TidyModule;
	private organize!: OrganizeModule;
	private deepDive!: DeepDiveModule;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AutoNotesSettingTab(this.app, this));

		// Centralized notification manager
		this.notifications = new NotificationManager();
		if (Platform.isDesktop) {
			this.notifications.setStatusBarEl(this.addStatusBarItem());
		}

		// Single shared checkpoint manager for all modules (I5)
		this.checkpointManager = new CheckpointManager(this.app);

		const getSettings = () => this.settings;

		// Initialize modules (Audio before Video since Video depends on Audio)
		// Pass checkpointManager to each module instead of letting them create their own
		this.elaboration = new ElaborationModule(this, getSettings, this.notifications, this.checkpointManager);
		this.audio = new AudioModule(this, getSettings, this.notifications, this.checkpointManager);
		if (Platform.isDesktop) {
			this.video = new VideoModule(this, getSettings, this.audio, this.notifications, this.checkpointManager);
		}
		this.enrichment = new EnrichmentModule(this, getSettings, this.notifications, this.checkpointManager);
		this.summarize = new SummarizeModule(
			this, getSettings, this.notifications, this.checkpointManager,
			this.video
				? (url, parentOp) => this.video!.transcribeUrl(url, parentOp)
				: async () => { throw new Error('Video transcription is not available on mobile'); },
			async (audioFile) => {
				const data = await this.app.vault.readBinary(audioFile);
				const result = await this.audio.transcribe(data, audioFile.name);
				return result.processed || result.raw;
			}
		);
		this.tidy = new TidyModule(this, getSettings, this.notifications);
		this.organize = new OrganizeModule(this, getSettings, this.notifications, this.checkpointManager);
		this.deepDive = new DeepDiveModule(this, getSettings, this.notifications, this.checkpointManager);

		// Register the unified proposal view
		this.registerView(UNIFIED_VIEW_TYPE, (leaf) => {
			return new UnifiedProposalView(leaf, {
				onElaborationAccept: (id, content) => this.elaboration.acceptProposal(id, content),
				onElaborationReject: (id) => this.elaboration.rejectProposal(id),
				onEnrichmentAcceptSelected: (id, accepted) => this.enrichment.acceptSelectedFromView(id, accepted),
				onEnrichmentReject: (id) => this.enrichment.rejectFromView(id),
				onOrganizeAccept: (id) => this.organize.acceptProposal(id),
				onOrganizeReject: (id) => this.organize.rejectProposal(id),
				onDeepDiveAccept: (id) => this.deepDive.acceptProposal(id),
				onDeepDiveReject: (id) => this.deepDive.rejectProposal(id),
				onCheckpointDiscard: (id) => this.discardCheckpoint(id),
				onCheckpointResume: (id) => this.resumeCheckpoint(id),
			});
		});

		// Wire refresh callback -- both modules call this to update the shared view
		const refreshView = () => this.refreshUnifiedView();
		this.elaboration.onViewRefreshNeeded = refreshView;
		this.enrichment.onViewRefreshNeeded = refreshView;
		this.organize.onViewRefreshNeeded = refreshView;
		this.deepDive.onViewRefreshNeeded = refreshView;

		// Load enabled modules
		if (this.settings.elaboration.enabled) {
			await this.elaboration.onload();
		}
		if (this.settings.audio.enabled) {
			await this.audio.onload();
		}
		if (this.settings.video.enabled && this.video) {
			await this.video.onload();
		}
		if (this.settings.enrichment.enabled) {
			await this.enrichment.onload();
		}
		if (this.settings.summarize.enabled) {
			await this.summarize.onload();
		}
		if (this.settings.tidy.enabled) {
			await this.tidy.onload();
		}
		if (this.settings.organize.enabled) {
			await this.organize.onload();
		}
		if (this.settings.deepDive.enabled) {
			await this.deepDive.onload();
		}

		// Wire enrichment callbacks -- triggers after other processes complete
		if (this.settings.enrichment.enabled && this.settings.enrichment.autoEnrich) {
			this.elaboration.onProposalAccepted = (filePath: string) => {
				this.enrichment.enrich(filePath, 'elaboration');
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				this.enrichment.enrich(filePath, 'transcription');
			};
			if (this.video) {
				this.video.onTranscriptionComplete = (filePath: string) => {
					this.enrichment.enrich(filePath, 'transcription');
				};
			}
			this.summarize.onSummaryComplete = (filePath: string) => {
				this.enrichment.enrich(filePath, 'summarization');
			};
			if (this.settings.deepDive.autoEnrichOnAccept) {
				this.deepDive.onNoteAccepted = (filePath: string) => {
					this.enrichment.enrich(filePath, 'deep-dive');
				};
			}
		}

		// Wire deep-dive auto-organize callback
		if (this.settings.deepDive.autoOrganizeOnAccept && this.settings.organize.enabled) {
			this.deepDive.onOrganizeRequested = (file) => {
				this.organize.organizeNote(file);
			};
		}

		// Wire summarize auto-organize callback (single-note only, never vault-wide)
		if (this.settings.summarize.autoOrganizeOnSummarize && this.settings.organize.enabled) {
			this.summarize.onOrganizeRequested = (file) => {
				this.organize.organizeNote(file);
			};
		}

		// Single ribbon icon + command for the unified view
		this.addRibbonIcon('sparkles', 'Review proposals', () => {
			this.activateUnifiedView();
		});

		// Unified transcription ribbon icon (desktop only — mic icon implies video support)
		if (Platform.isDesktop) {
			this.addRibbonIcon('mic', 'Transcribe media', () => {
				this.openUnifiedModal();
			});
		}

		this.addCommand({
			id: 'auto-notes:review-proposals',
			name: 'Open proposal review sidebar',
			callback: () => this.activateUnifiedView(),
		});

		this.addCommand({
			id: 'auto-notes:manage-checkpoints',
			name: 'Manage interrupted operations',
			callback: () => this.manageCheckpoints(),
		});

		// Startup check for incomplete checkpoints (delayed to avoid blocking load)
		setTimeout(() => this.checkForIncompleteCheckpoints(), 3000);

		// Unified transcription commands (audio on any platform, video on desktop only)
		const hasTranscription = this.settings.audio.enabled || (this.settings.video.enabled && this.video);
		if (hasTranscription) {
			this.addCommand({
				id: 'auto-notes:transcribe-media',
				name: 'Transcribe media',
				callback: () => this.openUnifiedModal(),
			});

			this.addCommand({
				id: 'auto-notes:transcribe-note-media',
				name: 'Transcribe media from current note',
				editorCallback: async (_editor, ctx) => {
					if (ctx.file) {
						await this.transcribeMediaFromNote(ctx.file);
					}
				},
			});
		}
	}

	onunload(): void {
		this.elaboration?.onunload();
		this.audio?.onunload();
		this.video?.onunload();
		this.enrichment?.onunload();
		this.summarize?.onunload();
		this.tidy?.onunload();
		this.organize?.onunload();
		this.deepDive?.onunload();
	}

	async loadSettings(): Promise<void> {
		this.settings = this.deepMerge(
			DEFAULT_SETTINGS,
			(await this.loadData()) || {}
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openUnifiedModal(): void {
		new UnifiedTranscriptionModal(
			this.app,
			() => this.settings,
			{
				audio: this.settings.audio.enabled,
				video: this.settings.video.enabled && this.video !== null,
			},
			{
				onTranscribeFile: (file) => this.audio.transcribeFileToActiveNote(file),
				onTranscribeUrl: this.video
					? (url) => this.video!.transcribeUrlToActiveNote(url)
					: async () => { /* unreachable: video hidden on mobile */ },
			}
		).open();
	}

	private async transcribeMediaFromNote(file: import('obsidian').TFile): Promise<void> {
		const content = await this.app.vault.read(file);

		const audioEmbeds = this.settings.audio.enabled
			? findAudioEmbeds(content, file.path, this.app.metadataCache)
			: [];
		const videoEmbeds = this.settings.video.enabled && this.video
			? findVideoUrls(content)
			: [];

		if (audioEmbeds.length === 0 && videoEmbeds.length === 0) {
			this.notifications.info('No media found in this note');
			return;
		}

		new NoteMediaModal(
			this.app,
			audioEmbeds,
			videoEmbeds,
			{
				onTranscribeAudio: (selected) => this.audio.transcribeAndInsert(file, selected),
				onTranscribeVideo: this.video
					? (selected) => this.video!.transcribeAndInsert(file, selected)
					: async () => { /* unreachable: video hidden on mobile */ },
			}
		).open();
	}

	private async activateUnifiedView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(UNIFIED_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: UNIFIED_VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		await this.refreshUnifiedView();
	}

	private async discardCheckpoint(id: string): Promise<void> {
		// Confirmation before discarding (M5)
		const proceed = await this.notifications.confirm(
			'Are you sure you want to discard this interrupted operation? Completed items are kept, but remaining items will be abandoned.',
			{ proceedLabel: 'Discard', cancelLabel: 'Cancel', level: 'warning' }
		);
		if (!proceed) return;

		await this.checkpointManager.discard(id);
		this.notifications.info('Interrupted operation discarded');
		await this.refreshUnifiedView();
	}

	/**
	 * Resume a checkpoint by dispatching to the appropriate module (C1).
	 */
	private async resumeCheckpoint(id: string): Promise<void> {
		const checkpoint = await this.checkpointManager.resume(id);
		if (!checkpoint) {
			this.notifications.info('Checkpoint not found or already completed');
			return;
		}

		// Dispatch to the owning module's resume flow
		switch (checkpoint.module) {
			case 'elaboration':
				await this.elaboration.resumeFromCheckpoint(checkpoint);
				break;
			case 'enrichment':
				await this.enrichment.resumeFromCheckpoint(checkpoint);
				break;
			case 'audio':
				await this.audio.resumeFromCheckpoint(checkpoint);
				break;
			case 'video':
				if (this.video) {
					await this.video.resumeFromCheckpoint(checkpoint);
				} else {
					this.notifications.info('Video transcription is not available on mobile');
				}
				break;
			case 'summarize':
				await this.summarize.resumeFromCheckpoint(checkpoint);
				break;
			case 'organize':
				await this.organize.resumeFromCheckpoint(checkpoint);
				break;
			case 'deep-dive':
				await this.deepDive.resumeFromCheckpoint(checkpoint);
				break;
			default:
				this.notifications.info(`Unknown module: ${checkpoint.module}`);
		}

		await this.refreshUnifiedView();
	}

	private async refreshUnifiedView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(UNIFIED_VIEW_TYPE);
		if (leaves.length === 0) return;

		// Gather items from both modules
		const items: UnifiedItem[] = [];

		const elaborationProposals = await this.elaboration.getPendingProposals();
		for (const p of elaborationProposals) {
			items.push({ kind: 'elaboration', data: p });
		}

		const enrichmentProposals = await this.enrichment.getPendingProposals();
		for (const p of enrichmentProposals) {
			items.push({ kind: 'enrichment', data: p });
		}

		const organizeProposals = await this.organize.getPendingProposals();
		for (const p of organizeProposals) {
			items.push({ kind: 'organize', data: p });
		}

		const deepDiveProposals = await this.deepDive.getPendingProposals();
		for (const p of deepDiveProposals) {
			items.push({ kind: 'deep-dive', data: p });
		}

		// Gather incomplete checkpoints for the sidebar banner
		const incompleteCheckpoints = await this.checkpointManager.listIncomplete();

		for (const leaf of leaves) {
			const view = leaf.view as UnifiedProposalView;
			view.setItems(items);
			view.setCheckpoints(incompleteCheckpoints);
		}
	}

	/**
	 * Check for incomplete checkpoints on startup and notify the user.
	 * Offers Resume, Review, or Dismiss options (C1).
	 */
	private async checkForIncompleteCheckpoints(): Promise<void> {
		try {
			const incomplete = await this.checkpointManager.listIncomplete();
			if (incomplete.length === 0) return;

			const labels = incomplete
				.map(cp => `${cp.operationLabel} (${cp.completedItems.length}/${cp.completedItems.length + cp.remainingItems.length} done)`)
				.join(', ');

			const proceed = await this.notifications.confirm(
				`${incomplete.length} interrupted operation${incomplete.length === 1 ? '' : 's'} found: ${labels}. Open manager?`,
				{ proceedLabel: 'Review', cancelLabel: 'Dismiss', level: 'warning' }
			);

			if (proceed) {
				await this.manageCheckpoints();
			}

			// Clean up old completed/discarded checkpoints
			await this.checkpointManager.cleanup();
		} catch (error) {
			console.warn('[Auto Notes] Failed to check for incomplete checkpoints:', error);
		}
	}

	/**
	 * Show checkpoint management dialog: list incomplete operations
	 * with options to resume, discard, or keep each one (C1).
	 */
	private async manageCheckpoints(): Promise<void> {
		const incomplete = await this.checkpointManager.listIncomplete();

		if (incomplete.length === 0) {
			this.notifications.info('No interrupted operations found');
			return;
		}

		for (const cp of incomplete) {
			const total = cp.completedItems.length + cp.remainingItems.length;
			const done = cp.completedItems.length;
			const remaining = cp.remainingItems.length;

			// First ask if they want to resume
			const wantResume = await this.notifications.confirm(
				`${cp.operationLabel}: ${done}/${total} completed, ${remaining} remaining. Resume?`,
				{ proceedLabel: 'Resume', cancelLabel: 'More options', level: 'warning' }
			);

			if (wantResume) {
				await this.resumeCheckpoint(cp.id);
				continue;
			}

			// If they chose "More options", offer Discard or Keep
			const wantDiscard = await this.notifications.confirm(
				`${cp.operationLabel}: Discard remaining items? (Completed items are already saved)`,
				{ proceedLabel: 'Discard', cancelLabel: 'Keep', level: 'warning' }
			);

			if (wantDiscard) {
				await this.checkpointManager.discard(cp.id);
				this.notifications.info(`Discarded: ${cp.operationLabel}`);
			}
		}
	}

	/**
	 * Dispatch deferred tasks returned by checkpoint completion (I1).
	 * Modules call this after completing a checkpoint to execute
	 * any registered deferred tasks.
	 */
	dispatchDeferredTasks(tasks: DeferredTask[]): void {
		for (const task of tasks) {
			switch (task.type) {
				case 'refresh-sidebar-view':
					this.refreshUnifiedView();
					break;
				default:
					console.warn(`[Auto Notes] Unknown deferred task type: ${task.type}`);
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private deepMerge<T>(target: T, source: any): T {
		const output: any = { ...target };
		for (const key of Object.keys(source)) {
			// Guard against prototype pollution
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
				continue;
			}
			if (
				source[key] &&
				typeof source[key] === 'object' &&
				!Array.isArray(source[key]) &&
				key in (target as any) &&
				typeof (target as any)[key] === 'object' &&
				!Array.isArray((target as any)[key])
			) {
				output[key] = this.deepMerge(
					(target as any)[key],
					source[key]
				);
			} else {
				output[key] = source[key];
			}
		}
		return output as T;
	}
}
