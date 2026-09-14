import { Platform, Plugin } from 'obsidian';
import { SynapseSettings, DEFAULT_SETTINGS } from './settings';
import { SynapseSettingTab } from './settings-ui';
import { createFfmpegAvailability } from './video';
import { CheckpointRecoveryModule } from './checkpoints';
import type { CheckpointResumeHandlers } from './checkpoints';
import { CommandRegistrar, auditCommands, listPaletteActions } from './commands';
import { runFirstRunOnboarding } from './onboarding';
import { SynapseRunner, buildPostOpHook, buildAutoOrganizeHook } from './pipeline';
import type { PipelineModuleMap, PostOpHookDeps } from './pipeline';
import { constructFeatureModules, listFeatureModules, loadFeatureModules, unloadFeatureModules } from './modules';
import type { FeatureModules } from './modules';
import {
	openScanFolderPicker, NotificationManager, CheckpointManager, NoteOperationQueue, TranscriptCache,
	UpdateChecker, fireAndForget, migrateSettings, migrateDataFolder, deepMergeSettings,
	readSettingsVersion, CURRENT_SETTINGS_VERSION, redactError,
} from './shared';
import type { ModuleDeps } from './shared';
import { createUrlTranscriptionRouter, appendUrlTranscript, transcribeNoteMedia, openUnifiedTranscriptionModal } from './transcription';
import type { UrlTranscriptionRouter } from './transcription';
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
	private modules: FeatureModules | null = null;
	/** Built after the modules; the registry wiring closures that reach these only run at operation time. */
	private urlTranscription!: UrlTranscriptionRouter;
	private synapseRunner!: SynapseRunner;
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
		this.transcriptCache = new TranscriptCache(this.app);
		const getSettings = () => this.settings;
		const registrar = new CommandRegistrar(this);
		const deps: ModuleDeps = {
			plugin: this,
			getSettings,
			notifications: this.notifications,
			checkpointManager: this.checkpointManager,
			registrar,
			noteQueue: this.noteQueue,
		};

		const modules = constructFeatureModules(deps, {
			transcribeUrl: (url, parentOp) =>
				this.urlTranscription.transcribe(url, { update: parentOp ? (msg) => parentOp.update(msg) : undefined }),
			intake: {
				fireOnFile: (file) => this.synapseRunner.fireOnFile(file),
				transcribeUrlToNote: (url, _mediaType, file) => appendUrlTranscript(
					{ app: this.app, getSettings, notifications: this.notifications, router: this.urlTranscription },
					url,
					file
				),
			},
		});
		this.modules = modules;
		const { elaboration, audio, video, image, enrichment, summarize, tidy, organize, deepDive, title, rem } = modules;

		this.urlTranscription = createUrlTranscriptionRouter({
			getSettings,
			processTranscriptText: (raw, opts) => audio.processTranscriptText(raw, opts),
			extract: video
				? (url, opts) => video.processUrl(url, { insertMode: false, timeRange: opts.timeRange }, opts.update ? { update: opts.update } : undefined)
				: undefined,
			store: this.transcriptCache,
		});
		const moduleMap: PipelineModuleMap = {
			elaboration: (fp, sc, of) => elaboration.scanVault(fp, sc, of),
			summarize: (fp, sc, of) => summarize.scanVault(fp, sc, of),
			enrichment: (fp, sc, of) => enrichment.scanVault(fp, sc, of),
			rem: (fp, sc, of) => rem.remScanDirectory(fp, sc, of),
			tidy: (fp, sc, of) => tidy.scanVault(fp, sc, of),
			organize: (fp, sc, of) => organize.scanDirectory(fp, sc, of),
		};
		this.synapseRunner = new SynapseRunner(moduleMap, getSettings, this.notifications);
		this.updateChecker = new UpdateChecker({
			currentVersion: this.manifest.version,
			app: this.app,
			notifications: this.notifications,
			getSettings,
			saveSettings: () => this.saveSettings(),
		});

		const viewSources: UnifiedViewSources = {
			elaboration: () => elaboration.getPendingProposals(),
			enrichment: () => enrichment.getPendingProposals(),
			organize: () => organize.getPendingProposals(),
			'deep-dive': () => deepDive.getPendingProposals(),
			title: () => title.getPendingProposals(),
			rem: () => rem.getPendingProposals(),
			checkpoints: () => this.checkpointManager.listIncomplete(),
		};
		const refreshView = () => refreshUnifiedView(this.app.workspace, viewSources);
		const openProposalView = () =>
			fireAndForget(activateUnifiedView(this.app.workspace, viewSources), 'Open proposal review', { notifications: this.notifications });

		const resumeHandlers: CheckpointResumeHandlers = {
			elaboration: (cp) => elaboration.resumeFromCheckpoint(cp),
			enrichment: (cp) => enrichment.resumeFromCheckpoint(cp),
			audio: (cp) => audio.resumeFromCheckpoint(cp),
			video: video
				? (cp) => video.resumeFromCheckpoint(cp)
				: async () => this.notifications.info('Video transcription is not available on mobile'),
			image: (cp) => image.resumeFromCheckpoint(cp),
			summarize: (cp) => summarize.resumeFromCheckpoint(cp),
			organize: (cp) => organize.resumeFromCheckpoint(cp),
			'deep-dive': (cp) => deepDive.resumeFromCheckpoint(cp),
			rem: (cp) => rem.resumeFromCheckpoint(cp),
		};
		this.checkpoints = new CheckpointRecoveryModule({
			checkpointManager: this.checkpointManager,
			notifications: this.notifications,
			registrar,
			resumeHandlers,
			refreshView,
		});

		this.registerView(UNIFIED_VIEW_TYPE, (leaf) => new UnifiedProposalView(leaf, {
			onElaborationAccept: (id, content) => elaboration.acceptProposal(id, content),
			onElaborationReject: (id) => elaboration.rejectProposal(id),
			onEnrichmentAcceptSelected: (id, accepted) => enrichment.acceptSelectedFromView(id, accepted),
			onEnrichmentReject: (id) => enrichment.rejectFromView(id),
			onOrganizeAccept: (id) => organize.acceptProposal(id),
			onOrganizeReject: (id) => organize.rejectProposal(id),
			onDeepDiveAccept: (id) => deepDive.acceptProposal(id),
			onDeepDiveReject: (id) => deepDive.rejectProposal(id),
			onTitleAccept: (id, resolution) =>
				title.acceptProposal(id, resolution ? { resolution } : undefined).then(() => {}),
			onTitleReject: (id) => title.rejectProposal(id),
			onRemAcceptSelected: (id, texts) => rem.acceptProposal(id, texts),
			onRemReject: (id) => rem.rejectProposal(id),
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

		for (const module of listFeatureModules(modules)) {
			if (module.onViewRefreshNeeded !== undefined) module.onViewRefreshNeeded = refreshView;
			if (module.onOpenProposalView !== undefined) module.onOpenProposalView = openProposalView;
		}
		await loadFeatureModules(modules, this.settings);

		// Post-op chaining (enrich -> title check, auto-organize); each hook is gated at wire time by settings.
		const postOpDeps: PostOpHookDeps = {
			getSettings,
			notifications: this.notifications,
			enrich: (filePath, trigger) => enrichment.enrich(filePath, trigger, { postOp: true }),
			checkTitle: (filePath) => title.checkTitle(filePath, { postOp: true }),
			organizeNote: (file) => organize.organizeNote(file),
		};
		elaboration.onProposalAccepted = buildPostOpHook(postOpDeps, 'elaboration');
		audio.onTranscriptionComplete = buildPostOpHook(postOpDeps, 'audio');
		if (video) video.onTranscriptionComplete = buildPostOpHook(postOpDeps, 'video');
		image.onExtractionComplete = buildPostOpHook(postOpDeps, 'image');
		summarize.onSummaryComplete = buildPostOpHook(postOpDeps, 'summarize');
		deepDive.onNoteAccepted = buildPostOpHook(postOpDeps, 'deep-dive');
		deepDive.onOrganizeRequested = buildAutoOrganizeHook(postOpDeps, 'deep-dive');
		summarize.onOrganizeRequested = buildAutoOrganizeHook(postOpDeps, 'summarize');

		const openUnifiedModal = () => openUnifiedTranscriptionModal({
			app: this.app,
			getSettings,
			notifications: this.notifications,
			router: this.urlTranscription,
			noteQueue: this.noteQueue,
			onTranscribeFile: (file, timeRange) => audio.transcribeFileToActiveNote(file, timeRange),
			onComplete: (filePath) => audio.onTranscriptionComplete?.(filePath),
		});
		const isFfmpegAvailable = createFfmpegAvailability(audio.extractor);

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
						? audio.transcribeAndInsertCombined(file, embeds)
						: audio.transcribeAndInsert(file, embeds),
					onTranscribeVideo: video ? (file, embeds) => video.transcribeAndInsert(file, embeds) : undefined,
					onExtractImages: (file, embeds) => image.extractAndInsert(file, embeds),
				}, ctx.file);
			},
		});

		registrar.register('fire', true, {
			callback: () => {
				openScanFolderPicker(this.app, (path) => {
					fireAndForget(this.synapseRunner.fire(path), 'Run all features on a folder', { notifications: this.notifications });
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
		this.checkpoints?.onunload();
		if (this.modules) unloadFeatureModules(this.modules);
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
