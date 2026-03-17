import { Plugin } from 'obsidian';
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
import { NotificationManager } from './shared';
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

	private elaboration!: ElaborationModule;
	private audio!: AudioModule;
	private video!: VideoModule;
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
		this.notifications.setStatusBarEl(this.addStatusBarItem());

		const getSettings = () => this.settings;

		// Initialize modules (Audio before Video since Video depends on Audio)
		this.elaboration = new ElaborationModule(this, getSettings, this.notifications);
		this.audio = new AudioModule(this, getSettings, this.notifications);
		this.video = new VideoModule(this, getSettings, this.audio, this.notifications);
		this.enrichment = new EnrichmentModule(this, getSettings, this.notifications);
		this.summarize = new SummarizeModule(
			this, getSettings, this.notifications,
			(url, parentOp) => this.video.transcribeUrl(url, parentOp)
		);
		this.tidy = new TidyModule(this, getSettings, this.notifications);
		this.organize = new OrganizeModule(this, getSettings, this.notifications);
		this.deepDive = new DeepDiveModule(this, getSettings, this.notifications);

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
			});
		});

		// Wire refresh callback — both modules call this to update the shared view
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
		if (this.settings.video.enabled) {
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

		// Wire enrichment callbacks — triggers after other processes complete
		if (this.settings.enrichment.enabled && this.settings.enrichment.autoEnrich) {
			this.elaboration.onProposalAccepted = (filePath: string) => {
				this.enrichment.enrich(filePath, 'elaboration');
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				this.enrichment.enrich(filePath, 'transcription');
			};
			this.video.onTranscriptionComplete = (filePath: string) => {
				this.enrichment.enrich(filePath, 'transcription');
			};
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

		// Unified transcription ribbon icon
		this.addRibbonIcon('mic', 'Transcribe media', () => {
			this.openUnifiedModal();
		});

		this.addCommand({
			id: 'auto-notes:review-proposals',
			name: 'Open proposal review sidebar',
			callback: () => this.activateUnifiedView(),
		});

		// Unified transcription commands (if either audio or video enabled)
		if (this.settings.audio.enabled || this.settings.video.enabled) {
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
				video: this.settings.video.enabled,
			},
			{
				onTranscribeFile: (file) => this.audio.transcribeFileToActiveNote(file),
				onTranscribeUrl: (url) => this.video.transcribeUrlToActiveNote(url),
			}
		).open();
	}

	private async transcribeMediaFromNote(file: import('obsidian').TFile): Promise<void> {
		const content = await this.app.vault.read(file);

		const audioEmbeds = this.settings.audio.enabled
			? findAudioEmbeds(content, file.path, this.app.metadataCache)
			: [];
		const videoEmbeds = this.settings.video.enabled
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
				onTranscribeVideo: (selected) => this.video.transcribeAndInsert(file, selected),
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

		for (const leaf of leaves) {
			const view = leaf.view as UnifiedProposalView;
			view.setItems(items);
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
