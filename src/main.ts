import { MarkdownView, Platform, Plugin, TFile } from 'obsidian';
import { SynapseSettings, DEFAULT_SETTINGS } from './settings';
import { SynapseSettingTab } from './settings-tab';
import { ElaborationModule } from './elaboration';
import { AudioModule } from './audio';
import { VideoModule, AudioExtractor } from './video';
import { ImageModule } from './image';
import { EnrichmentModule } from './enrichment';
import { SummarizeModule } from './summarize';
import { TidyModule } from './tidy';
import { OrganizeModule } from './organize';
import { DeepDiveModule } from './deep-dive';
import { TitleModule } from './title';
import { RemModule } from './rem';
import { IntakeModule } from './intake';
import { CommandRegistrar, auditCommands, listPaletteActions, REGISTRY_BY_ID } from './commands';
import { planFirstRun, WELCOME_MESSAGE, WELCOME_NOTICE_DURATION_MS } from './onboarding';
import { SynapseRunner } from './pipeline';
import type { PipelineModuleMap } from './pipeline';
import { openScanFolderPicker, NotificationManager, CheckpointManager, UpdateChecker, fireAndForget, migrateSettings, readSettingsVersion, CURRENT_SETTINGS_VERSION, redactError } from './shared';
import type { DeferredTask } from './shared';
import {
	UnifiedTranscriptionModal,
	NoteMediaModal,
	UrlTranscriptionRouter,
	CaptionStrategy,
	LocalExtractionStrategy,
	buildUrlTranscriptBlock,
	insertUrlTranscript,
} from './transcription';
import type { UrlTranscriptionStrategy } from './transcription';
import { findAudioEmbeds } from './audio';
import { findVideoUrls } from './video';
import { findImageEmbeds } from './image';
import {
	UNIFIED_VIEW_TYPE,
	UnifiedProposalView,
	SYNAPSE_ACTIONS_VIEW_TYPE,
	SynapseActionsView,
} from './views';
import type { UnifiedItem } from './views';
import { registerSynapseIcons } from './brand-icons';
import { registerPropertiesAutoFold } from './properties-fold';

/**
 * Narrows a value to a plain object record (a non-null, non-array object) so
 * `deepMerge` can recurse into nested settings groups without falling back to
 * `any` casts. Arrays and primitives are treated as leaf values to overwrite.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default class SynapsePlugin extends Plugin {
	settings!: SynapseSettings;
	notifications!: NotificationManager;
	private checkpointManager!: CheckpointManager;
	private updateChecker!: UpdateChecker;

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
	private audioExtractor: AudioExtractor | undefined;
	/** Tiered URL transcription router (#184) — built in onload, used by the unified modal. */
	private urlTranscription!: UrlTranscriptionRouter;
	private ffmpegAvailable: boolean | null = null;
	private startupTimeout: number | null = null;
	/**
	 * Separate startup timer for the once-per-day update check (#365). Kept
	 * distinct from {@link startupTimeout} so neither clobbers the other's
	 * handle; cleared in {@link onunload}.
	 */
	private updateCheckTimeout: number | null = null;
	/**
	 * True when `loadData()` returned no persisted settings — i.e. a genuine
	 * fresh install rather than an existing user upgrading. Drives first-run
	 * onboarding (#89): only fresh installs are greeted with the welcome notice.
	 */
	private isFreshInstall = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the bespoke Synapse glyphs (S-Signal mark, ribbon/launcher
		// marks, and per-feature/per-action icons; #349) as custom icons so
		// ribbon/UI surfaces can use them. Must run before any
		// addRibbonIcon(...)/setIcon/view getIcon that references these names.
		registerSynapseIcons();

		// Centralized notification manager. Constructed before migrateDataFolder()
		// so that path can surface a persistent, copyable error toast through it.
		this.notifications = new NotificationManager();

		// Migrate legacy .auto-notes folder to .synapse (one-time, backward compat)
		await this.migrateDataFolder();

		this.addSettingTab(new SynapseSettingTab(this.app, this));

		if (Platform.isDesktop) {
			this.notifications.setStatusBarEl(this.addStatusBarItem());
		}

		// Single shared checkpoint manager for all modules (I5)
		this.checkpointManager = new CheckpointManager(this.app);

		const getSettings = () => this.settings;

		// Central command registrar — the single wiring point to addCommand, gated
		// by the command registry (developer source of truth / master control).
		const registrar = new CommandRegistrar(this);

		// Per-proposal-type auto-accept accessors (#228). Each module receives a
		// live `() => this.settings.autoAccept[kind]` getter — consistent with the
		// getSettings accessor pattern — so toggling the setting takes effect
		// immediately without a reload, and modules never import global settings.
		// Read through `this.settings` (not a captured reference) so it stays live.

		// Initialize modules (Audio before Video since Video depends on Audio)
		// Pass checkpointManager to each module instead of letting them create their own
		this.elaboration = new ElaborationModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.elaboration);
		// Create a shared AudioExtractor on desktop for clipping support
		const audioExtractor = Platform.isDesktop ? new AudioExtractor(getSettings) : undefined;
		this.audioExtractor = audioExtractor;
		this.audio = new AudioModule(this, getSettings, this.notifications, this.checkpointManager, audioExtractor);
		if (Platform.isDesktop) {
			this.video = new VideoModule(this, getSettings, this.audio, this.notifications, this.checkpointManager, registrar);
		}
		this.image = new ImageModule(this, getSettings, this.notifications, this.checkpointManager);
		this.enrichment = new EnrichmentModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.enrichment);

		// URL transcription router (#184): ordered tiers behind one seam.
		// Captions work on every platform; the yt-dlp/ffmpeg extraction tier
		// joins only where VideoModule exists (desktop). Both tiers reach their
		// feature modules through injected callbacks, mirroring the other
		// cross-module callback bundles.
		const urlStrategies: UrlTranscriptionStrategy[] = [
			new CaptionStrategy(getSettings, (raw) => this.audio.processTranscriptText(raw)),
		];
		const video = this.video;
		if (video) {
			urlStrategies.push(new LocalExtractionStrategy((url, opts) =>
				video.processUrl(
					url,
					{ insertMode: false, timeRange: opts.timeRange },
					opts.update ? { update: opts.update } : undefined
				)
			));
		}
		const urlTranscription = new UrlTranscriptionRouter(urlStrategies);
		this.urlTranscription = urlTranscription;
		if (video) {
			// Batch note-media transcription routes through the same tiers, so
			// captioned YouTube videos never hit the download/size limits (#184).
			video.urlTranscriber = (url, parentOp) =>
				urlTranscription.transcribe(url, {
					update: parentOp ? (msg) => parentOp.update(msg) : undefined,
				});
		}

		this.summarize = new SummarizeModule(
			this, getSettings, this.notifications, this.checkpointManager, registrar,
			async (url, parentOp) => {
				const result = await urlTranscription.transcribe(url, {
					update: parentOp ? (msg) => parentOp.update(msg) : undefined,
				});
				return result.text;
			},
			async (audioFile) => {
				const data = await this.app.vault.readBinary(audioFile);
				const result = await this.audio.transcribe(data, audioFile.name);
				return result.processed || result.raw;
			}
		);
		this.tidy = new TidyModule(this, getSettings, this.notifications, registrar);
		this.organize = new OrganizeModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.organize);
		this.deepDive = new DeepDiveModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept['deep-dive']);
		this.title = new TitleModule(this, getSettings, this.notifications, () => this.settings.autoAccept.title);
		this.rem = new RemModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.rem);

		// In-app "newer Synapse available" check (#365). Self-gated on the settings
		// toggle and rate-limited to once/day inside maybeCheck(); fired from a
		// delayed startup timer below so it never blocks load.
		this.updateChecker = new UpdateChecker({
			currentVersion: this.manifest.version,
			app: this.app,
			notifications: this.notifications,
			getSettings,
			saveSettings: () => this.saveSettings(),
		});

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
				onTitleAccept: (id, resolution) =>
					this.title.acceptProposal(id, resolution ? { resolution } : undefined).then(() => {}),
				onTitleReject: (id) => this.title.rejectProposal(id),
				onRemAcceptSelected: (id, texts) => this.rem.acceptProposal(id, texts),
				onRemReject: (id) => this.rem.rejectProposal(id),
				onCheckpointDiscard: (id) => this.discardCheckpoint(id),
				onCheckpointResume: (id) => this.resumeCheckpoint(id),
			}, this.notifications);
		});

		// Registry-driven "Synapse actions" sidebar (#289): touch-friendly buttons
		// for every enabled palette command, so mobile users reach key functions in
		// <=2 taps without the command palette. Buttons run the already-registered
		// command via executeCommandById (see runCommand) — no behavior re-declared.
		// The factory closes over the local `registrar`; it runs at view-open time
		// (post-onload), so getRegistered() is fully populated.
		this.registerView(SYNAPSE_ACTIONS_VIEW_TYPE, (leaf) => new SynapseActionsView(leaf, {
			getActions: () => listPaletteActions(registrar.getRegistered()),
			runAction: (id) => this.runCommand(id),
			isNoteActive: () => this.activeMarkdownFile() !== null,
		}));

		// Keep per-note buttons in sync with the active note (enable/disable live).
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const view = this.app.workspace.getLeavesOfType(SYNAPSE_ACTIONS_VIEW_TYPE)[0]?.view;
			if (view instanceof SynapseActionsView) view.refresh();
		}));

		// Auto-fold note Properties on open when enabled (#381). All workspace-event
		// wiring + teardown lives in properties-fold.ts; this is the single hook.
		registerPropertiesAutoFold(this, () => this.settings);

		// Wire refresh callback -- both modules call this to update the shared view
		const refreshView = () => this.refreshUnifiedView();
		this.elaboration.onViewRefreshNeeded = refreshView;
		this.enrichment.onViewRefreshNeeded = refreshView;
		this.organize.onViewRefreshNeeded = refreshView;
		this.deepDive.onViewRefreshNeeded = refreshView;
		this.title.onViewRefreshNeeded = refreshView;
		this.rem.onViewRefreshNeeded = refreshView;

		// Wire the "Review" toast action (#340): proposal-generation toasts carry a
		// Review button that opens the unified proposal view. Shared opener across
		// all six proposal-producing modules.
		const openProposalView = () =>
			fireAndForget(this.activateUnifiedView(), 'Open proposal review', { notifications: this.notifications });
		this.elaboration.onOpenProposalView = openProposalView;
		this.enrichment.onOpenProposalView = openProposalView;
		this.organize.onOpenProposalView = openProposalView;
		this.deepDive.onOpenProposalView = openProposalView;
		this.title.onOpenProposalView = openProposalView;
		this.rem.onOpenProposalView = openProposalView;

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
		if (this.settings.image.enabled) {
			await this.image.onload();
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
		if (this.settings.title.enabled) {
			await this.title.onload();
		}
		if (this.settings.rem.enabled) {
			await this.rem.onload();
		}

		// Wire enrichment callbacks -- triggers after other processes complete
		if (this.settings.enrichment.enabled && this.settings.enrichment.autoEnrich) {
			this.elaboration.onProposalAccepted = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'elaboration', { postOp: true }), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
				}
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'transcription', { postOp: true }), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
				}
			};
			if (this.video) {
				this.video.onTranscriptionComplete = (filePath: string) => {
					fireAndForget(this.enrichment.enrich(filePath, 'transcription', { postOp: true }), 'Enrich note', { notifications: this.notifications });
					if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
						fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
					}
				};
			}
			this.image.onExtractionComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'transcription', { postOp: true }), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
				}
			};
			this.summarize.onSummaryComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'summarization', { postOp: true }), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
				}
			};
			if (this.settings.deepDive.autoEnrichOnAccept) {
				this.deepDive.onNoteAccepted = (filePath: string) => {
					fireAndForget(this.enrichment.enrich(filePath, 'deep-dive', { postOp: true }), 'Enrich note', { notifications: this.notifications });
					if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
						fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
					}
				};
			}
		}

		// Wire title check when enrichment is disabled but title is enabled
		if (this.settings.title.enabled && this.settings.title.checkAfterOperations &&
			!(this.settings.enrichment.enabled && this.settings.enrichment.autoEnrich)) {
			this.elaboration.onProposalAccepted = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
			};
			if (this.video) {
				this.video.onTranscriptionComplete = (filePath: string) => {
					fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
				};
			}
			this.image.onExtractionComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
			};
			this.summarize.onSummaryComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
			};
			this.deepDive.onNoteAccepted = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath, { postOp: true }), 'Check note title', { notifications: this.notifications });
			};
		}

		// Wire deep-dive auto-organize callback
		if (this.settings.deepDive.autoOrganizeOnAccept && this.settings.organize.enabled) {
			this.deepDive.onOrganizeRequested = (file) => {
				fireAndForget(this.organize.organizeNote(file), 'Organize note', { notifications: this.notifications });
			};
		}

		// Wire summarize auto-organize callback (single-note only, never vault-wide)
		if (this.settings.summarize.autoOrganizeOnSummarize && this.settings.organize.enabled) {
			this.summarize.onOrganizeRequested = (file) => {
				fireAndForget(this.organize.organizeNote(file), 'Organize note', { notifications: this.notifications });
			};
		}

		// Single ribbon icon + command for the unified view. Uses the bespoke
		// S-Signal mark (registered above) — the only glyph that carries the
		// brand spark, reserved for Synapse identity (#349).
		this.addRibbonIcon('synapse', 'Review proposals', () => {
			fireAndForget(this.activateUnifiedView(), 'Open proposal review', { notifications: this.notifications });
		});

		// Unified transcription ribbon. Available on every platform since #184:
		// mobile transcribes audio files and YouTube URLs (captions). Uses the
		// bespoke 'synapse-transcribe' mark (#349), the same glyph the
		// transcribe action carries, so the set stays coherent.
		this.addRibbonIcon('synapse-transcribe', 'Transcribe media', () => {
			this.openUnifiedModal();
		});

		// Opener for the Synapse actions sidebar (#289). Unconditional so it
		// appears on mobile, where the command palette is hardest to reach. Uses
		// the bespoke 'synapse-actions' launcher mark (#349).
		this.addRibbonIcon('synapse-actions', 'Synapse actions', () => {
			fireAndForget(this.activateSynapseActionsView(), 'Open Synapse actions', { notifications: this.notifications });
		});

		registrar.register('review-proposals', true, {
			callback: () => this.activateUnifiedView(),
		});

		registrar.register('manage-checkpoints', true, {
			callback: () => this.manageCheckpoints(),
		});

		// Startup check for incomplete checkpoints (delayed to avoid blocking load)
		this.startupTimeout = window.setTimeout(() => { void this.checkForIncompleteCheckpoints(); }, 3000);

		// Startup check for a newer Synapse release (#365). Delayed (and staggered
		// after the checkpoint check) so it never blocks load; maybeCheck() self-gates
		// on the toggle and the once/day rate limit.
		this.updateCheckTimeout = window.setTimeout(() => { void this.updateChecker.maybeCheck(); }, 5000);

		// Unified transcription commands (audio + URL transcription on any
		// platform since #184, image OCR). Always attempted so the registry
		// audit sees them; userEnabled gates actual registration.
		const hasTranscription = this.settings.audio.enabled || this.settings.video.enabled || this.settings.image.enabled;
		registrar.register('transcribe-media', !!hasTranscription, {
			callback: () => this.openUnifiedModal(),
		});

		registrar.register('transcribe-note-media', !!hasTranscription, {
			editorCallback: async (_editor, ctx) => {
				if (ctx.file) {
					await this.transcribeMediaFromNote(ctx.file);
				}
			},
		});

		// Fire Synapse: run all enabled features on a directory.
		// The third arg (onlyFile) is forwarded so SynapseRunner.fireOnFile
		// can scope each phase to a single note (intake monitor, #111).
		const moduleMap: PipelineModuleMap = {
			elaboration: (fp, sc, of) => this.elaboration.scanVault(fp, sc, of),
			summarize: (fp, sc, of) => this.summarize.scanVault(fp, sc, of),
			enrichment: (fp, sc, of) => this.enrichment.scanVault(fp, sc, of),
			rem: (fp, sc, of) => this.rem.remScanDirectory(fp, sc, of),
			tidy: (fp, sc, of) => this.tidy.scanVault(fp, sc, of),
			organize: (fp, sc, of) => this.organize.scanDirectory(fp, sc, of),
		};
		const synapseRunner = new SynapseRunner(moduleMap, getSettings, this.notifications);

		// Intake monitor (#111): watches the configured intake folder and
		// auto-processes new notes. Cross-module work is injected as callbacks
		// (the intake module never imports other feature modules):
		//   - general notes  -> run the whole pipeline on the one note
		//   - article URLs    -> fetch+append, then the whole pipeline (#223);
		//                        the pipeline's organize phase relocates the note
		//   - media URLs      -> tiered URL transcription (#112/#184), then the
		//                        whole pipeline like the article branch
		// fireOnFile runs elaboration as its first phase, so no separate
		// elaborate-only callback is needed anymore (#223).
		this.intake = new IntakeModule(this, getSettings, this.notifications, {
			fireOnFile: (file) => synapseRunner.fireOnFile(file),
			transcribeUrlToNote: async (url, _mediaType, file) => {
				const op = this.notifications.startOperation(
					'Transcribing shared URL...',
					`intake-url-${file.path}`
				);
				try {
					const result = await urlTranscription.transcribe(url, {
						update: (msg) => op.update(msg),
					});
					const block = buildUrlTranscriptBlock(
						result, url, this.settings.video.embedInNote
					);
					await this.app.vault.process(file, (data) => data + block);
					op.finish('Transcript added');
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					op.error(`URL transcription failed -- ${msg}`);
					// Rethrow so intake leaves the note un-stamped/retriable — in a
					// synced vault a mobile failure is finished by the desktop watcher.
					throw error;
				}
			},
		});
		if (this.settings.intake.enabled) {
			await this.intake.onload();
		}

		registrar.register('fire', true, {
			callback: () => {
				openScanFolderPicker(this.app, (path) => {
					fireAndForget(synapseRunner.fire(path), 'Run all features on a folder', { notifications: this.notifications });
				});
			},
		});

		// Surface command-registry drift: active entries with no handler, or
		// registered handlers missing from the registry. Asserted by a Vitest test too.
		auditCommands(registrar.getAttempted()).forEach(w => console.warn('[Synapse] ' + w));

		// First-run onboarding (#89): a one-time welcome notice for fresh installs.
		// Runs last so it never delays core setup, and after the notification
		// manager is ready. Non-blocking — failure here must not break load.
		await this.runFirstRunOnboarding();
	}

	onunload(): void {
		if (this.startupTimeout !== null) {
			window.clearTimeout(this.startupTimeout);
			this.startupTimeout = null;
		}
		if (this.updateCheckTimeout !== null) {
			window.clearTimeout(this.updateCheckTimeout);
			this.updateCheckTimeout = null;
		}
		this.elaboration?.onunload();
		this.audio?.onunload();
		this.video?.onunload();
		this.image?.onunload();
		this.enrichment?.onunload();
		this.summarize?.onunload();
		this.tidy?.onunload();
		this.organize?.onunload();
		this.deepDive?.onunload();
		this.title?.onunload();
		this.rem?.onunload();
		this.intake?.onunload();
		// Stop any animated-ellipsis intervals left running by in-flight
		// operations so a disable mid-operation leaves no orphaned timer.
		this.notifications?.dispose();
	}

	async loadSettings(): Promise<void> {
		// `loadData()` returns `any`; narrow it to a raw record so the migration
		// runner and merge stay type-safe. Persisted data is a (possibly partial /
		// older-schema) settings object, or null on first run.
		const raw = (await this.loadData()) as Record<string, unknown> | null;
		// No persisted data (null) or an empty object means this is the plugin's
		// first run in this vault — used to gate the first-run welcome (#89).
		this.isFreshInstall = !raw || Object.keys(raw).length === 0;
		// Version-stamped migration framework (#93): replay every migration newer
		// than the persisted `settingsVersion` over the RAW object BEFORE merging
		// defaults. Version 0 is the pre-versioning baseline (absent/invalid
		// `settingsVersion`); fresh installs already carry CURRENT_SETTINGS_VERSION
		// from DEFAULT_SETTINGS and skip migration entirely.
		const fromVersion = readSettingsVersion(raw);
		let migrated: Record<string, unknown> = raw ?? {};
		if (!this.isFreshInstall && raw) {
			try {
				migrated = migrateSettings(raw, fromVersion);
			} catch (error) {
				// Resilient fallback — load must never break. migrateSettings clones
				// before mutating, so `raw` is still the untouched original here.
				console.warn('[Synapse] settings migration failed:', redactError(error));
				migrated = raw;
			}
		}
		// deepMerge treats arrays as leaf values, so a migrated `exclusions` array
		// cleanly overrides DEFAULT_SETTINGS.exclusions — same end state as the old
		// post-merge assignment. deepMerge itself is left untouched (its
		// prototype-pollution-safe recursion is out of scope).
		this.settings = this.deepMerge(DEFAULT_SETTINGS, migrated);
		this.settings.settingsVersion = CURRENT_SETTINGS_VERSION;
		// One-time stamp/persist on upgrade so the new schema version (and any
		// migrated data) lands in data.json and migrations don't re-run next load.
		if (!this.isFreshInstall && fromVersion < CURRENT_SETTINGS_VERSION) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * First-run onboarding (#89). Greets a genuine fresh install once with a
	 * welcome notice pointing at the settings tab to configure an API key, then
	 * persists `onboarding.hasSeenWelcome` so it never fires again. An existing
	 * user upgrading into this version is marked seen silently (no notice). Any
	 * failure is swallowed — onboarding must never break plugin load.
	 */
	private async runFirstRunOnboarding(): Promise<void> {
		try {
			const plan = planFirstRun(this.settings, this.isFreshInstall);
			if (!plan.markSeen) return;

			this.settings.onboarding.hasSeenWelcome = true;
			await this.saveSettings();

			if (plan.showWelcome) {
				this.notifications.info(WELCOME_MESSAGE, WELCOME_NOTICE_DURATION_MS);
			}
		} catch (error) {
			console.warn('[Synapse] First-run onboarding failed:', redactError(error));
		}
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
				onTranscribeFile: (file, timeRange) => this.audio.transcribeFileToActiveNote(file, timeRange),
				// Tier-routed on every platform (#184). A time range forces the
				// extraction tier, so desktop clipping behaves exactly as before.
				// Completion reuses the audio module's post-transcription hook
				// (enrichment + title check) — same kind, same wiring blocks.
				onTranscribeUrl: (url, timeRange) => insertUrlTranscript(
					{
						app: this.app,
						getSettings: () => this.settings,
						notifications: this.notifications,
						router: this.urlTranscription,
						onComplete: (filePath) => this.audio.onTranscriptionComplete?.(filePath),
					},
					url,
					timeRange
				),
			},
			this.notifications
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
		const imageEmbeds = this.settings.image.enabled
			? findImageEmbeds(content, file.path, this.app.metadataCache)
			: [];

		if (audioEmbeds.length === 0 && videoEmbeds.length === 0 && imageEmbeds.length === 0) {
			this.notifications.info('No media found in this note');
			return;
		}

		const ffmpegAvailable = await this.isFfmpegAvailable();

		new NoteMediaModal(
			this.app,
			audioEmbeds,
			videoEmbeds,
			imageEmbeds,
			{
				onTranscribeAudio: (selected, combine) => combine
					? this.audio.transcribeAndInsertCombined(file, selected)
					: this.audio.transcribeAndInsert(file, selected),
				onTranscribeVideo: this.video
					? (selected) => this.video!.transcribeAndInsert(file, selected)
					: async () => { /* unreachable: video hidden on mobile */ },
				onExtractImages: (selected) => this.image.extractAndInsert(file, selected),
			},
			this.notifications,
			ffmpegAvailable
		).open();
	}

	/**
	 * Lazily detect (and cache) whether ffmpeg is available for audio
	 * combining (#214). Mobile has no AudioExtractor, so this is always false.
	 */
	private async isFfmpegAvailable(): Promise<boolean> {
		if (!this.audioExtractor) return false;
		if (this.ffmpegAvailable === null) {
			try {
				this.ffmpegAvailable = (await this.audioExtractor.checkDependencies()).ffmpeg;
			} catch {
				this.ffmpegAvailable = false;
			}
		}
		return this.ffmpegAvailable;
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
		// Deliberate background work: reveal is best-effort UI and must not block
		// the refresh below; surface failures to the console only (no toast).
		fireAndForget(workspace.revealLeaf(leaf), 'Reveal proposal view', { background: true });
		await this.refreshUnifiedView();
	}

	private async activateSynapseActionsView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(SYNAPSE_ACTIONS_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: SYNAPSE_ACTIONS_VIEW_TYPE, active: true });
		}
		fireAndForget(workspace.revealLeaf(leaf), 'Reveal Synapse actions', { background: true });
	}

	/**
	 * The active markdown note, or null. Uses `getActiveFile()` (which returns the
	 * most recently active file) rather than `getActiveViewOfType(MarkdownView)`,
	 * so it survives the actions sidebar — especially the mobile drawer — stealing
	 * focus from the editor. That focus theft is exactly why the per-note buttons
	 * used to grey out once the panel was open (#289 follow-up).
	 */
	private activeMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file && file.extension === 'md' ? file : null;
	}

	/**
	 * Run a registered command by its registry id (without the `synapse:` prefix),
	 * via Obsidian's own command dispatch — the same gated path the palette uses,
	 * so editor/check gating is honored. `app.commands` isn't in the public typings,
	 * hence the localized cast (the repo has no global App augmentation).
	 *
	 * For `context: 'note'` commands (registered as `editorCallback`s) the active
	 * editor is required, but opening the actions sidebar makes the note's editor
	 * inactive (`workspace.activeEditor` goes null) — so the command would silently
	 * no-op. We re-activate the note's markdown leaf first, restoring the editor
	 * context so the command runs against the note the user was viewing.
	 */
	private runCommand(id: string): void {
		const commands = (this.app as unknown as {
			commands: { executeCommandById(id: string): boolean };
		}).commands;

		if (REGISTRY_BY_ID.get(id)?.context === 'note') {
			const file = this.activeMarkdownFile();
			if (!file) {
				this.notifications.info('Open a note first to use this action.');
				return;
			}
			const mdLeaf = this.app.workspace
				.getLeavesOfType('markdown')
				.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file === file);
			if (mdLeaf) this.app.workspace.setActiveLeaf(mdLeaf, { focus: true });
		}

		commands.executeCommandById(`${this.manifest.id}:${id}`);
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
			case 'image':
				await this.image.resumeFromCheckpoint(checkpoint);
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
			case 'rem':
				await this.rem.resumeFromCheckpoint(checkpoint);
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

		const titleProposals = await this.title.getPendingProposals();
		for (const p of titleProposals) {
			items.push({ kind: 'title', data: p });
		}

		const remProposals = await this.rem.getPendingProposals();
		for (const p of remProposals) {
			items.push({ kind: 'rem', data: p });
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
			console.warn('[Synapse] Failed to check for incomplete checkpoints:', redactError(error));
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
					// Deliberate background work: refresh the sidebar without
					// blocking the caller; log failures to the console only.
					fireAndForget(this.refreshUnifiedView(), 'Refresh proposal view', { background: true });
					break;
				default:
					console.warn(`[Synapse] Unknown deferred task type: ${task.type}`);
			}
		}
	}

	/**
	 * Migrate the legacy `.auto-notes/` data folder to `.synapse/`.
	 * Runs once on load; skips silently if the old folder does not exist
	 * or the new folder already exists.
	 */
	private async migrateDataFolder(): Promise<void> {
		const OLD_FOLDER = '.auto-notes';
		const NEW_FOLDER = '.synapse';
		const adapter = this.app.vault.adapter;

		try {
			const oldExists = await adapter.exists(OLD_FOLDER);
			if (!oldExists) return;

			const newExists = await adapter.exists(NEW_FOLDER);
			if (newExists) {
				// Both folders exist -- do not overwrite, warn the user
				console.warn(
					`[Synapse] Both ${OLD_FOLDER}/ and ${NEW_FOLDER}/ exist. ` +
					`Skipping automatic migration. Please merge manually.`
				);
				return;
			}

			await adapter.rename(OLD_FOLDER, NEW_FOLDER);
			this.notifications.success(
				`migrated data folder from ${OLD_FOLDER}/ to ${NEW_FOLDER}/`
			);
		} catch (error) {
			console.error('[Synapse] Failed to migrate data folder:', redactError(error));
			// Persistent, copyable error toast (NotificationManager exists by now —
			// it is constructed before migrateDataFolder() in onload).
			this.notifications.error(
				`failed to migrate ${OLD_FOLDER}/ to ${NEW_FOLDER}/ -- ` +
				`please rename it manually.`
			);
		}
	}

	private deepMerge<T extends object>(target: T, source: Record<string, unknown>): T {
		const output: Record<string, unknown> = { ...(target as Record<string, unknown>) };
		for (const key of Object.keys(source)) {
			// Guard against prototype pollution
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
				continue;
			}
			const sourceValue = source[key];
			const targetValue = output[key];
			if (isPlainRecord(sourceValue) && isPlainRecord(targetValue)) {
				output[key] = this.deepMerge(targetValue, sourceValue);
			} else {
				output[key] = sourceValue;
			}
		}
		return output as T;
	}
}
