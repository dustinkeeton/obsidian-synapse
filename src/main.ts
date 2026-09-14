import { Platform, Plugin } from 'obsidian';
import { SynapseSettings, DEFAULT_SETTINGS } from './settings';
import { SynapseSettingTab } from './settings-ui';
import { ElaborationModule } from './elaboration';
import { AudioModule } from './audio';
import { VideoModule, AudioExtractor, createFfmpegAvailability } from './video';
import { ImageModule } from './image';
import { EnrichmentModule } from './enrichment';
import { SummarizeModule } from './summarize';
import { TidyModule } from './tidy';
import { OrganizeModule } from './organize';
import { DeepDiveModule } from './deep-dive';
import { TitleModule } from './title';
import { RemModule } from './rem';
import { IntakeModule } from './intake';
import { CheckpointRecoveryModule } from './checkpoints';
import type { CheckpointResumeHandlers } from './checkpoints';
import { CommandRegistrar, auditCommands, listPaletteActions } from './commands';
import { runFirstRunOnboarding } from './onboarding';
import { SynapseRunner, buildPostOpHook, buildAutoOrganizeHook } from './pipeline';
import type { PipelineModuleMap, PostOpHookDeps } from './pipeline';
import {
	openScanFolderPicker, NotificationManager, CheckpointManager, NoteOperationQueue, TranscriptCache,
	UpdateChecker, fireAndForget, migrateSettings, migrateDataFolder, deepMergeSettings,
	readSettingsVersion, CURRENT_SETTINGS_VERSION, redactError,
} from './shared';
import { createUrlTranscriptionRouter, appendUrlTranscript, transcribeNoteMedia, openUnifiedTranscriptionModal } from './transcription';
import {
	UNIFIED_VIEW_TYPE, UnifiedProposalView, SYNAPSE_ACTIONS_VIEW_TYPE, SynapseActionsView,
	activateUnifiedView, activateSynapseActionsView, refreshUnifiedView, activeMarkdownFile, runRegisteredCommand,
} from './views';
import type { UnifiedViewSources } from './views';
import { registerSynapseIcons } from './brand-icons';
import { registerPropertiesAutoFold } from './properties-fold';

export default class SynapsePlugin extends Plugin {
	settings!: SynapseSettings;
	notifications!: NotificationManager;
	/** Vault-file transcript store behind every URL-transcription path (#488); cleared from Video settings. */
	transcriptCache!: TranscriptCache;
	private checkpointManager!: CheckpointManager;
	private noteQueue!: NoteOperationQueue;
	private updateChecker!: UpdateChecker;
	private checkpoints!: CheckpointRecoveryModule;

	private elaboration!: ElaborationModule;
	private audio!: AudioModule;
	private video: VideoModule | null = null;
	private image!: ImageModule;
	private enrichment!: EnrichmentModule;
	private summarize!: SummarizeModule;
	private tidy!: TidyModule;
	private organize!: OrganizeModule;
	private deepDive!: DeepDiveModule;
	private title!: TitleModule;
	private rem!: RemModule;
	private intake!: IntakeModule;
	private updateCheckTimeout: number | null = null;
	/** True when `loadData()` returned nothing: a genuine fresh install (#89). */
	private isFreshInstall = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		registerSynapseIcons();
		this.notifications = new NotificationManager();
		await migrateDataFolder(this.app.vault.adapter, this.notifications);
		this.addSettingTab(new SynapseSettingTab(this.app, this));
		if (Platform.isDesktop) {
			this.notifications.setStatusBarEl(this.addStatusBarItem());
		}
		this.checkpointManager = new CheckpointManager(this.app);
		this.noteQueue = new NoteOperationQueue();
		const getSettings = () => this.settings;
		const registrar = new CommandRegistrar(this);

		// Module construction: audio before video (video depends on audio); video desktop-only.
		this.elaboration = new ElaborationModule(this, getSettings, this.notifications, this.checkpointManager, registrar, this.noteQueue, () => this.settings.autoAccept.elaboration);
		const audioExtractor = Platform.isDesktop ? new AudioExtractor(getSettings) : undefined;
		this.audio = new AudioModule(this, getSettings, this.notifications, this.checkpointManager, this.noteQueue, audioExtractor);
		if (Platform.isDesktop) {
			this.video = new VideoModule(this, getSettings, this.audio, this.notifications, this.checkpointManager, registrar, this.noteQueue);
		}
		this.image = new ImageModule(this, getSettings, this.notifications, this.checkpointManager, this.noteQueue);
		this.enrichment = new EnrichmentModule(this, getSettings, this.notifications, this.checkpointManager, registrar, this.noteQueue, () => this.settings.autoAccept.enrichment);

		const video = this.video;
		this.transcriptCache = new TranscriptCache(this.app);
		const urlTranscription = createUrlTranscriptionRouter({
			getSettings,
			processTranscriptText: (raw, opts) => this.audio.processTranscriptText(raw, opts),
			extract: video
				? (url, opts) => video.processUrl(url, { insertMode: false, timeRange: opts.timeRange }, opts.update ? { update: opts.update } : undefined)
				: undefined,
			store: this.transcriptCache,
		});
		if (video) {
			video.urlTranscriber = (url, parentOp) =>
				urlTranscription.transcribe(url, { update: parentOp ? (msg) => parentOp.update(msg) : undefined });
		}

		this.summarize = new SummarizeModule(
			this, getSettings, this.notifications, this.checkpointManager, registrar, this.noteQueue,
			async (url, parentOp) => {
				const result = await urlTranscription.transcribe(url, { update: parentOp ? (msg) => parentOp.update(msg) : undefined });
				return result.text;
			},
			async (audioFile) => {
				const data = await this.app.vault.readBinary(audioFile);
				const result = await this.audio.transcribe(data, audioFile.name);
				return result.processed || result.raw;
			}
		);
		this.tidy = new TidyModule(this, getSettings, this.notifications, registrar, this.noteQueue);
		this.organize = new OrganizeModule(this, getSettings, this.notifications, this.checkpointManager, registrar, this.noteQueue, () => this.settings.autoAccept.organize);
		this.deepDive = new DeepDiveModule(this, getSettings, this.notifications, this.checkpointManager, registrar, this.noteQueue, () => this.settings.autoAccept['deep-dive']);
		this.title = new TitleModule(this, getSettings, this.notifications, this.noteQueue, () => this.settings.autoAccept.title);
		this.rem = new RemModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.rem);
		this.updateChecker = new UpdateChecker({
			currentVersion: this.manifest.version,
			app: this.app,
			notifications: this.notifications,
			getSettings,
			saveSettings: () => this.saveSettings(),
		});

		const viewSources: UnifiedViewSources = {
			elaboration: () => this.elaboration.getPendingProposals(),
			enrichment: () => this.enrichment.getPendingProposals(),
			organize: () => this.organize.getPendingProposals(),
			'deep-dive': () => this.deepDive.getPendingProposals(),
			title: () => this.title.getPendingProposals(),
			rem: () => this.rem.getPendingProposals(),
			checkpoints: () => this.checkpointManager.listIncomplete(),
		};
		const refreshView = () => refreshUnifiedView(this.app.workspace, viewSources);
		const openProposalView = () =>
			fireAndForget(activateUnifiedView(this.app.workspace, viewSources), 'Open proposal review', { notifications: this.notifications });

		const resumeHandlers: CheckpointResumeHandlers = {
			elaboration: (cp) => this.elaboration.resumeFromCheckpoint(cp),
			enrichment: (cp) => this.enrichment.resumeFromCheckpoint(cp),
			audio: (cp) => this.audio.resumeFromCheckpoint(cp),
			video: video
				? (cp) => video.resumeFromCheckpoint(cp)
				: async () => this.notifications.info('Video transcription is not available on mobile'),
			image: (cp) => this.image.resumeFromCheckpoint(cp),
			summarize: (cp) => this.summarize.resumeFromCheckpoint(cp),
			organize: (cp) => this.organize.resumeFromCheckpoint(cp),
			'deep-dive': (cp) => this.deepDive.resumeFromCheckpoint(cp),
			rem: (cp) => this.rem.resumeFromCheckpoint(cp),
		};
		this.checkpoints = new CheckpointRecoveryModule({
			checkpointManager: this.checkpointManager,
			notifications: this.notifications,
			registrar,
			resumeHandlers,
			refreshView,
		});

		this.registerView(UNIFIED_VIEW_TYPE, (leaf) => new UnifiedProposalView(leaf, {
			onElaborationAccept: (id, content) => this.elaboration.acceptProposal(id, content),
			onElaborationReject: (id) => this.elaboration.rejectProposal(id),
			onEnrichmentAcceptSelected: (id, accepted) => this.enrichment.acceptSelectedFromView(id, accepted),
			onEnrichmentReject: (id) => this.enrichment.rejectFromView(id),
			onOrganizeAccept: (id) => this.organize.acceptProposal(id),
			onOrganizeReject: (id) => this.organize.rejectProposal(id),
			onDeepDiveAccept: (id) => this.deepDive.acceptProposal(id),
			onDeepDiveReject: (id) => this.deepDive.rejectProposal(id),
			onTitleAccept: (id, resolution) =>
				this.title.acceptProposal(id, resolution ? { resolution } : undefined).then(() => {}),
			onTitleReject: (id) => this.title.rejectProposal(id),
			onRemAcceptSelected: (id, texts) => this.rem.acceptProposal(id, texts),
			onRemReject: (id) => this.rem.rejectProposal(id),
			onCheckpointDiscard: (id) => this.checkpoints.discard(id),
			onCheckpointResume: (id) => this.checkpoints.resume(id),
		}, this.notifications));

		// Registry-driven actions sidebar (#289); the factory runs post-onload, so getRegistered() is complete.
		this.registerView(SYNAPSE_ACTIONS_VIEW_TYPE, (leaf) => new SynapseActionsView(leaf, {
			getActions: () => listPaletteActions(registrar.getRegistered()),
			runAction: (id) => runRegisteredCommand(this.app, this.manifest.id, id, this.notifications),
			isNoteActive: () => activeMarkdownFile(this.app) !== null,
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const view = this.app.workspace.getLeavesOfType(SYNAPSE_ACTIONS_VIEW_TYPE)[0]?.view;
			if (view instanceof SynapseActionsView) view.refresh();
		}));
		registerPropertiesAutoFold(this, getSettings);

		for (const module of [this.elaboration, this.enrichment, this.organize, this.deepDive, this.title, this.rem]) {
			module.onViewRefreshNeeded = refreshView;
			module.onOpenProposalView = openProposalView;
		}

		if (this.settings.elaboration.enabled) await this.elaboration.onload();
		if (this.settings.audio.enabled) await this.audio.onload();
		if (this.settings.video.enabled && video) await video.onload();
		if (this.settings.image.enabled) await this.image.onload();
		if (this.settings.enrichment.enabled) await this.enrichment.onload();
		if (this.settings.summarize.enabled) await this.summarize.onload();
		if (this.settings.tidy.enabled) await this.tidy.onload();
		if (this.settings.organize.enabled) await this.organize.onload();
		if (this.settings.deepDive.enabled) await this.deepDive.onload();
		if (this.settings.title.enabled) await this.title.onload();
		if (this.settings.rem.enabled) await this.rem.onload();

		// Post-op chaining (enrich -> title check, auto-organize); each hook is gated at wire time by settings.
		const postOpDeps: PostOpHookDeps = {
			getSettings,
			notifications: this.notifications,
			enrich: (filePath, trigger) => this.enrichment.enrich(filePath, trigger, { postOp: true }),
			checkTitle: (filePath) => this.title.checkTitle(filePath, { postOp: true }),
			organizeNote: (file) => this.organize.organizeNote(file),
		};
		this.elaboration.onProposalAccepted = buildPostOpHook(postOpDeps, 'elaboration');
		this.audio.onTranscriptionComplete = buildPostOpHook(postOpDeps, 'audio');
		if (video) video.onTranscriptionComplete = buildPostOpHook(postOpDeps, 'video');
		this.image.onExtractionComplete = buildPostOpHook(postOpDeps, 'image');
		this.summarize.onSummaryComplete = buildPostOpHook(postOpDeps, 'summarize');
		this.deepDive.onNoteAccepted = buildPostOpHook(postOpDeps, 'deep-dive');
		this.deepDive.onOrganizeRequested = buildAutoOrganizeHook(postOpDeps, 'deep-dive');
		this.summarize.onOrganizeRequested = buildAutoOrganizeHook(postOpDeps, 'summarize');

		const openUnifiedModal = () => openUnifiedTranscriptionModal({
			app: this.app,
			getSettings,
			notifications: this.notifications,
			router: urlTranscription,
			noteQueue: this.noteQueue,
			onTranscribeFile: (file, timeRange) => this.audio.transcribeFileToActiveNote(file, timeRange),
			onComplete: (filePath) => this.audio.onTranscriptionComplete?.(filePath),
		});
		const isFfmpegAvailable = createFfmpegAvailability(audioExtractor);

		this.addRibbonIcon('synapse', 'Review proposals', openProposalView);
		this.addRibbonIcon('synapse-transcribe', 'Transcribe media', openUnifiedModal);
		this.addRibbonIcon('synapse-actions', 'Synapse actions', () => {
			fireAndForget(activateSynapseActionsView(this.app.workspace), 'Open Synapse actions', { notifications: this.notifications });
		});

		registrar.register('review-proposals', true, {
			callback: () => activateUnifiedView(this.app.workspace, viewSources),
		});
		this.checkpoints.onload();
		this.updateCheckTimeout = window.setTimeout(() => { void this.updateChecker.maybeCheck(); }, 5000);

		// Always attempted so the registry audit sees them; userEnabled gates actual registration.
		const hasTranscription = this.settings.audio.enabled || this.settings.video.enabled || this.settings.image.enabled;
		registrar.register('transcribe-media', !!hasTranscription, {
			callback: openUnifiedModal,
		});
		registrar.register('transcribe-note-media', !!hasTranscription, {
			editorCallback: async (_editor, ctx) => {
				if (!ctx.file) return;
				await transcribeNoteMedia({
					app: this.app,
					getSettings,
					notifications: this.notifications,
					isFfmpegAvailable,
					onTranscribeAudio: (file, embeds, combine) => combine
						? this.audio.transcribeAndInsertCombined(file, embeds)
						: this.audio.transcribeAndInsert(file, embeds),
					onTranscribeVideo: video ? (file, embeds) => video.transcribeAndInsert(file, embeds) : undefined,
					onExtractImages: (file, embeds) => this.image.extractAndInsert(file, embeds),
				}, ctx.file);
			},
		});

		const moduleMap: PipelineModuleMap = {
			elaboration: (fp, sc, of) => this.elaboration.scanVault(fp, sc, of),
			summarize: (fp, sc, of) => this.summarize.scanVault(fp, sc, of),
			enrichment: (fp, sc, of) => this.enrichment.scanVault(fp, sc, of),
			rem: (fp, sc, of) => this.rem.remScanDirectory(fp, sc, of),
			tidy: (fp, sc, of) => this.tidy.scanVault(fp, sc, of),
			organize: (fp, sc, of) => this.organize.scanDirectory(fp, sc, of),
		};
		const synapseRunner = new SynapseRunner(moduleMap, getSettings, this.notifications);

		// Intake (#111) never imports feature modules; cross-module work is injected.
		this.intake = new IntakeModule(this, getSettings, this.notifications, {
			fireOnFile: (file) => synapseRunner.fireOnFile(file),
			transcribeUrlToNote: (url, _mediaType, file) => appendUrlTranscript(
				{ app: this.app, getSettings, notifications: this.notifications, router: urlTranscription },
				url,
				file
			),
		});
		if (this.settings.intake.enabled) await this.intake.onload();

		registrar.register('fire', true, {
			callback: () => {
				openScanFolderPicker(this.app, (path) => {
					fireAndForget(synapseRunner.fire(path), 'Run all features on a folder', { notifications: this.notifications });
				});
			},
		});

		auditCommands(registrar.getAttempted()).forEach(w => console.warn('[Synapse] ' + w));
		await runFirstRunOnboarding({
			getSettings,
			isFreshInstall: this.isFreshInstall,
			markSeen: async () => {
				this.settings.onboarding.hasSeenWelcome = true;
				await this.saveSettings();
			},
			notifications: this.notifications,
		});
	}

	onunload(): void {
		if (this.updateCheckTimeout !== null) {
			window.clearTimeout(this.updateCheckTimeout);
			this.updateCheckTimeout = null;
		}
		const modules = [
			this.checkpoints, this.elaboration, this.audio, this.video, this.image, this.enrichment,
			this.summarize, this.tidy, this.organize, this.deepDive, this.title, this.rem, this.intake,
		];
		for (const module of modules) module?.onunload();
		this.notifications?.dispose();
	}

	/** #93: replay versioned migrations over the raw record, merge over defaults, persist once on upgrade. */
	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Record<string, unknown> | null;
		this.isFreshInstall = !raw || Object.keys(raw).length === 0;
		const fromVersion = readSettingsVersion(raw);
		let migrated: Record<string, unknown> = raw ?? {};
		if (!this.isFreshInstall && raw) {
			try {
				migrated = migrateSettings(raw, fromVersion);
			} catch (error) {
				console.warn('[Synapse] settings migration failed:', redactError(error));
				migrated = raw;
			}
		}
		this.settings = deepMergeSettings(DEFAULT_SETTINGS, migrated);
		this.settings.settingsVersion = CURRENT_SETTINGS_VERSION;
		if (!this.isFreshInstall && fromVersion < CURRENT_SETTINGS_VERSION) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
