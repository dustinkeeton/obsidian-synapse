import { MarkdownView, Notice, Platform, Plugin, TFile, addIcon } from 'obsidian';
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
import { FolderPickerModal, NotificationManager, CheckpointManager, fireAndForget, buildMigratedExclusions } from './shared';
import type { DeferredTask, LegacyModuleExclusions } from './shared';
import { UnifiedTranscriptionModal, NoteMediaModal } from './transcription';
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

/**
 * Monochrome `currentColor` silhouette of the S-Signal mark, registered as the
 * `synapse` icon for ribbon/UI surfaces (which strip color to a single
 * currentColor fill). This is the inner body of `assets/brand/icon-mono.svg`,
 * authored on the 0 0 100 100 viewBox Obsidian's `addIcon` expects. In
 * monochrome the spark bead bridges the synaptic cleft and completes the S
 * spine, so the silhouette stays whole down to 16px. Keep this in sync with the
 * canonical asset; do not recolor (the brand mark only ever uses palette colors
 * in its full-color variants — this variant is intentionally color-agnostic).
 */
const SYNAPSE_ICON_SVG =
	'<path d="M70 25.2 A16.4 16.4 0 1 0 42.3 42.3" fill="none" stroke="currentColor" stroke-width="10.5" stroke-linecap="round"/>' +
	'<circle cx="70" cy="25.2" r="7.8" fill="currentColor"/>' +
	'<path d="M69.3 55.4 A18 18 0 0 1 41.8 78.5" fill="none" stroke="currentColor" stroke-width="10.5" stroke-linecap="round"/>' +
	'<ellipse cx="55.8" cy="48.9" rx="16.5" ry="7.2" fill="currentColor" transform="rotate(26 55.8 48.9)"/>';

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
	private ffmpegAvailable: boolean | null = null;
	private startupTimeout: number | null = null;
	/**
	 * True when `loadData()` returned no persisted settings — i.e. a genuine
	 * fresh install rather than an existing user upgrading. Drives first-run
	 * onboarding (#89): only fresh installs are greeted with the welcome notice.
	 */
	private isFreshInstall = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the brand mark as a custom icon so ribbon/UI surfaces can use
		// it. Must run before any addRibbonIcon('synapse', …) call below.
		addIcon('synapse', SYNAPSE_ICON_SVG);

		// Migrate legacy .auto-notes folder to .synapse (one-time, backward compat)
		await this.migrateDataFolder();

		this.addSettingTab(new SynapseSettingTab(this.app, this));

		// Centralized notification manager
		this.notifications = new NotificationManager();
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
		this.summarize = new SummarizeModule(
			this, getSettings, this.notifications, this.checkpointManager, registrar,
			this.video
				? (url, parentOp) => this.video!.transcribeUrl(url, parentOp)
				: async () => { throw new Error('Video transcription is not available on mobile'); },
			async (audioFile) => {
				const data = await this.app.vault.readBinary(audioFile);
				const result = await this.audio.transcribe(data, audioFile.name);
				return result.processed || result.raw;
			},
			(files) => this.audio.transcribeAudioCombined(files)
		);
		this.tidy = new TidyModule(this, getSettings, this.notifications, registrar);
		this.organize = new OrganizeModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.organize);
		this.deepDive = new DeepDiveModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept['deep-dive']);
		this.title = new TitleModule(this, getSettings, this.notifications, () => this.settings.autoAccept.title);
		this.rem = new RemModule(this, getSettings, this.notifications, this.checkpointManager, registrar, () => this.settings.autoAccept.rem);

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
				onTitleAccept: (id) => this.title.acceptProposal(id),
				onTitleReject: (id) => this.title.rejectProposal(id),
				onRemAcceptSelected: (id, texts) => this.rem.acceptProposal(id, texts),
				onRemReject: (id) => this.rem.rejectProposal(id),
				onCheckpointDiscard: (id) => this.discardCheckpoint(id),
				onCheckpointResume: (id) => this.resumeCheckpoint(id),
			});
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
				fireAndForget(this.enrichment.enrich(filePath, 'elaboration'), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
				}
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'transcription'), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
				}
			};
			if (this.video) {
				this.video.onTranscriptionComplete = (filePath: string) => {
					fireAndForget(this.enrichment.enrich(filePath, 'transcription'), 'Enrich note', { notifications: this.notifications });
					if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
						fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
					}
				};
			}
			this.image.onExtractionComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'transcription'), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
				}
			};
			this.summarize.onSummaryComplete = (filePath: string) => {
				fireAndForget(this.enrichment.enrich(filePath, 'summarization'), 'Enrich note', { notifications: this.notifications });
				if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
					fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
				}
			};
			if (this.settings.deepDive.autoEnrichOnAccept) {
				this.deepDive.onNoteAccepted = (filePath: string) => {
					fireAndForget(this.enrichment.enrich(filePath, 'deep-dive'), 'Enrich note', { notifications: this.notifications });
					if (this.settings.title.enabled && this.settings.title.checkAfterOperations) {
						fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
					}
				};
			}
		}

		// Wire title check when enrichment is disabled but title is enabled
		if (this.settings.title.enabled && this.settings.title.checkAfterOperations &&
			!(this.settings.enrichment.enabled && this.settings.enrichment.autoEnrich)) {
			this.elaboration.onProposalAccepted = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
			};
			this.audio.onTranscriptionComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
			};
			if (this.video) {
				this.video.onTranscriptionComplete = (filePath: string) => {
					fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
				};
			}
			this.image.onExtractionComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
			};
			this.summarize.onSummaryComplete = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
			};
			this.deepDive.onNoteAccepted = (filePath: string) => {
				fireAndForget(this.title.checkTitle(filePath), 'Check note title', { notifications: this.notifications });
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

		// Single ribbon icon + command for the unified view. Uses the brand
		// S-Signal mark (registered above) rather than a stock Lucide glyph —
		// the previous 'sparkles' icon is on the brand's banned inventory.
		this.addRibbonIcon('synapse', 'Review proposals', () => {
			fireAndForget(this.activateUnifiedView(), 'Open proposal review', { notifications: this.notifications });
		});

		// Unified transcription ribbon icon (desktop only — mic icon implies video
		// support). 'mic' stays a functional Lucide glyph: it communicates the
		// transcribe action better than the brand mark, and only sparkle glyphs
		// are banned, not all Lucide icons.
		if (Platform.isDesktop) {
			this.addRibbonIcon('mic', 'Transcribe media', () => {
				this.openUnifiedModal();
			});
		}

		// Opener for the Synapse actions sidebar (#289). Unconditional so it appears
		// on mobile, where the command palette is hardest to reach. 'layout-grid' is
		// a functional Lucide glyph (only the sparkle family is on the banned list).
		this.addRibbonIcon('layout-grid', 'Synapse actions', () => {
			fireAndForget(this.activateSynapseActionsView(), 'Open Synapse actions', { notifications: this.notifications });
		});

		registrar.register('review-proposals', true, {
			name: 'Open proposal review sidebar',
			callback: () => this.activateUnifiedView(),
		});

		registrar.register('manage-checkpoints', true, {
			name: 'Manage interrupted operations',
			callback: () => this.manageCheckpoints(),
		});

		// Startup check for incomplete checkpoints (delayed to avoid blocking load)
		this.startupTimeout = window.setTimeout(() => { void this.checkForIncompleteCheckpoints(); }, 3000);

		// Unified transcription commands (audio on any platform, video on desktop only, image OCR).
		// Always attempted so the registry audit sees them; userEnabled gates actual registration.
		const hasTranscription = this.settings.audio.enabled || (this.settings.video.enabled && this.video) || this.settings.image.enabled;
		registrar.register('transcribe-media', !!hasTranscription, {
			name: 'Transcribe media',
			callback: () => this.openUnifiedModal(),
		});

		registrar.register('transcribe-note-media', !!hasTranscription, {
			name: 'Transcribe media from current note',
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
		//   - media URLs      -> #112 transcription STUB (notice only)
		// fireOnFile runs elaboration as its first phase, so no separate
		// elaborate-only callback is needed anymore (#223).
		this.intake = new IntakeModule(this, getSettings, this.notifications, {
			fireOnFile: (file) => synapseRunner.fireOnFile(file),
			transcribeUrlToNote: async (_url, _mediaType, _file) => {
				new Notice('Synapse: URL transcription from intake is coming soon (#112)');
			},
		});
		if (this.settings.intake.enabled) {
			await this.intake.onload();
		}

		registrar.register('fire', true, {
			name: 'Run all features on a directory',
			callback: () => {
				const defaultPath = this.app.workspace.getActiveFile()?.parent?.path || '';
				new FolderPickerModal(
					this.app,
					(folder) => {
						fireAndForget(
							synapseRunner.fire(folder.isRoot() ? undefined : folder.path),
							'Run all features on folder',
							{ notifications: this.notifications },
						);
					},
					defaultPath,
				).open();
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
		// `loadData()` returns `any`; narrow it to the persisted-settings shape so
		// the fresh-install check and merge are type-safe. Persisted data is a
		// (possibly partial / older-schema) settings object, or null on first run.
		const data = (await this.loadData()) as Partial<SynapseSettings> | null;
		// No persisted data (null) or an empty object means this is the plugin's
		// first run in this vault — used to gate the first-run welcome (#89).
		this.isFreshInstall = !data || Object.keys(data).length === 0;
		// A partial settings object satisfies deepMerge's `Record<string, unknown>`
		// source param directly — no boundary cast needed. deepMerge itself is
		// left untouched (its prototype-pollution-safe recursion is out of scope).
		this.settings = this.deepMerge(DEFAULT_SETTINGS, data ?? {});

		// One-time migration of the legacy per-module `excludeFolders` lists into
		// the centralized `exclusions` list (#307). Gated on the RAW persisted
		// data lacking an `exclusions` key (no settings-version system exists —
		// that's #93), so it runs exactly once and never re-runs even if the user
		// later empties the list. Fresh installs already get the default
		// exclusions from DEFAULT_SETTINGS, so they skip migration entirely.
		if (!this.isFreshInstall && data && data.exclusions === undefined) {
			try {
				// Read legacy folders off the raw object via a narrow read type
				// (the fields no longer exist on SynapseSettings).
				const migrated = buildMigratedExclusions(data as LegacyModuleExclusions);
				// Atomic assign of the fully-built list, then persist so the
				// `exclusions` key is present on the next load.
				this.settings.exclusions = migrated;
				await this.saveData(this.settings);
			} catch (error) {
				// Swallow-and-warn (mirrors migrateDataFolder): on failure keep the
				// merged default exclusions rather than breaking load.
				console.warn('[Synapse] Failed to migrate excludeFolders to exclusions:', error);
			}
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
			console.warn('[Synapse] First-run onboarding failed:', error);
		}
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
				onTranscribeFile: (file, timeRange) => this.audio.transcribeFileToActiveNote(file, timeRange),
				onTranscribeUrl: this.video
					? (url, timeRange) => this.video!.transcribeUrlToActiveNote(url, timeRange)
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
				new Notice('Synapse: open a note first to use this action.');
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
			console.warn('[Synapse] Failed to check for incomplete checkpoints:', error);
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
			new Notice(
				`Synapse: migrated data folder from ${OLD_FOLDER}/ to ${NEW_FOLDER}/`
			);
		} catch (error) {
			console.error('[Synapse] Failed to migrate data folder:', error);
			new Notice(
				`Synapse: failed to migrate ${OLD_FOLDER}/ to ${NEW_FOLDER}/ -- ` +
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
