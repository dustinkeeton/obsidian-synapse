---
last-updated: 2026-09-14
---

# Synapse — Agent Reference

AI-powered Obsidian plugin: stub note elaboration, audio/video transcription (caption-first URL tier on every platform, #184), image OCR, note enrichment (tags, links, references), summarization, note tidying, semantic organization, recursive deep dive note generation, REM wikilink discovery, intake-folder auto-processing, Fire Synapse multi-phase pipeline, and checkpoint-based operation resumability.

## Build and Test

```sh
npm run build          # tsc -noEmit -skipLibCheck && node esbuild.config.mjs production
npm run dev            # esbuild watch
npm test               # vitest run
npm run test:watch     # vitest watch
npm run test:coverage  # vitest run --coverage
npm run lint           # eslint src (flat config: eslint.config.mjs; includes custom synapse/no-unredacted-console rule)
npx tsc --noEmit --skipLibCheck  # type-check only
```

Output: `main.js` (single bundle, Obsidian loads this)

## Module Registry

| Module | Path | Purpose | Public API |
|--------|------|---------|------------|
| main | `src/main.ts` | Plugin entry (lifecycle glue only, #496/#504): settings load/save, service construction, registry-driven module lifecycle, view/ribbon/command registration, cross-module callback injection | `SynapsePlugin` (default) |
| modules | `src/modules/` | Feature-module registry (#504): ordered factory list; construct / settings-gated load / reverse unload loops; per-entry platform gating | `MODULE_FACTORIES`, `constructFeatureModules`, `listFeatureModules`, `loadFeatureModules`, `unloadFeatureModules`, types (`FeatureModules`, `FeatureModuleKey`, `ModuleEntry`, `ModuleFactoryContext`, `ModuleWiring`) |
| checkpoints | `src/checkpoints/` | Checkpoint recovery UX (#496): startup interrupted-operation prompt, `manage-checkpoints` command, sidebar resume/discard; resume dispatch via injected per-module handlers | `CheckpointRecoveryModule`, `STARTUP_CHECK_DELAY_MS`, `CheckpointRecoveryDeps`, `CheckpointResumeHandler`, `CheckpointResumeHandlers` |
| settings | `src/settings.ts` | Settings interfaces, defaults, model options | `SynapseSettings`, `DEFAULT_SETTINGS`, `AIProvider`, `MODEL_OPTIONS` |
| settings-ui | `src/settings-ui/` | Obsidian settings UI | `SynapseSettingTab` |
| commands | `src/commands/` | Command registry: developer source of truth + master control (status/flow/context gating), central registrar, drift audit, palette-action derivation | `CommandRegistrar`, `COMMAND_REGISTRY`, `REGISTRY_BY_ID`, `REGISTRY_BY_PIPELINE_KEY`, `isInFlow`, `isPipelineKeyInFlow`, `listPaletteActions`, `FEATURE_ICONS`, `resolveActionIcon`, `auditCommands`, types (`CommandDefinition`, `CommandContext`, `CommandFlow`, `CommandStatus`, `FeatureKey`) |
| pipeline | `src/pipeline/` | Fire Synapse orchestration: ordered multi-phase run over a folder or single note; table-driven post-op hook builders (enrich -> title check, auto-organize; #496) | `SynapseRunner`, `SYNAPSE_PIPELINE`, `buildPostOpHook`, `buildAutoOrganizeHook`, `PipelineModuleKey`, `PipelineModuleMap`, `PipelineScanFn`, `PostOpHookDeps`, `PostOpSource`, `PostOpTrigger`, `PostOpHook`, `AutoOrganizeTrigger` |
| intake | `src/intake/` | Watches intake folder, auto-routes + pipeline-processes new notes (#111); opt-in adoption of root-level shared captures (#455) | `IntakeModule`, `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG`, `renderIntakeSettings` |
| rem | `src/rem/` | REM: discover linkable references, propose in-place `[[wikilink]]` insertions | `RemModule`, types |
| elaboration | `src/elaboration/` | Stub note detection, AI proposal generation, image analysis for proposals | `ElaborationModule`, `ImageAnalyzer`, types |
| audio | `src/audio/` | Audio transcription (Whisper, Deepgram, local), post-processing | `AudioModule`, `findAudioEmbeds`, `AUDIO_EXTENSIONS`, `AUDIO_EMBED_REGEX`, `renderAudioSettings`, `renderTranscriptionCredentials`, types |
| video | `src/video/` | Video download (YouTube/TikTok), audio extraction, transcription | `VideoModule`, `AudioExtractor`, `createFfmpegAvailability`, `findVideoUrls`, `detectPlatform`, `isSupportedUrl`, types |
| image | `src/image/` | Image OCR via multi-modal AI (vision models), batch extraction with checkpoints | `ImageModule`, `findImageEmbeds`, `IMAGE_EXTENSIONS`, `IMAGE_EMBED_REGEX`, `arrayBufferToBase64`, `preprocessImage`, `renderImageSettings`, types (`ImageExtractor` is internal, not barrel-exported) |
| transcription | `src/transcription/` | Unified transcription/OCR UI modals, duration detection, time-range modal, tiered URL-transcription router (#184: YouTube captions → desktop yt-dlp/ffmpeg) | `UnifiedTranscriptionModal`, `NoteMediaModal`, `TimeRangeSlider`, `TimeRangeModal`, `UrlTranscriptionRouter`, `createUrlTranscriptionRouter`, `CaptionStrategy`, `LocalExtractionStrategy`, `NoTranscriptionPathError`, `buildUrlTranscriptBlock`, `fetchYouTubeTranscript`, `insertUrlTranscript`, `appendUrlTranscript`, `transcribeNoteMedia`, `openUnifiedTranscriptionModal`, `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp`, `MIN_SLIDER_DURATION`, types (`UrlTranscriptionStrategy`, `UrlTranscript`, `UrlTranscriptOptions`, `TranscriptStore`, `InsertUrlTranscriptDeps`, `UrlTranscriptionRouterDeps`, `NoteMediaTranscriptionDeps`, `UnifiedTranscriptionDeps`, `TimeRangeChoice`, `TimeRangeModalOptions`, `DurationResult`, `YouTubeTranscript`) |
| enrichment | `src/enrichment/` | Metadata classification, topic extraction, link resolution, external refs, frontmatter | `EnrichmentModule`, types |
| summarize | `src/summarize/` | URL and transcription summarization, standalone summary notes, audio-embed summarization | `SummarizeModule`, types |
| tidy | `src/tidy/` | Spelling correction and markdown formatting via AI | `TidyModule`, `TidySnapshot` |
| organize | `src/organize/` | AI-powered semantic directory structuring for notes | `OrganizeModule`, types |
| deep-dive | `src/deep-dive/` | Recursive topic extraction and child note generation | `DeepDiveModule`, types |
| title | `src/title/` | AI title suggestions for untitled/mismatched notes | `TitleModule`, types |
| shared | `src/shared/` | AI client (multi-modal + opt-in response cache), file utils, validation, notifications, callouts, frontmatter, checkpoints, per-note operation queue, credential metadata + validation, secret redaction, settings migrations + defaults merge, data-folder migration, content hashing, untrusted-content wrapping, review-toast gate, update check, title predicates, feature-module lifecycle contract (#504) | `AIClient`, `NotificationManager`, `CheckpointManager`, `NoteOperationQueue`, `validateCredentials`, `PROVIDER_METADATA`, `decorateCredentialField`, `redactSecrets`, `redactError`, `reviewAction`, `migrateSettings`, `deepMergeSettings`, `migrateDataFolder`, `hashString`/`contentKey`, `wrapUntrusted`, `findAvailableVaultPath`, `ModuleDeps`, `FeatureModule`, `FeatureSettingsKey`, `UpdateChecker`, `isNewerVersion`, `isUntitled`, `isGenericTitle`, file/validation utils, callout registry, id-utils |
| views | `src/views/` | Unified proposal/checkpoint sidebar + registry-driven Synapse actions sidebar; sidebar activation/refresh + registry command dispatch helpers (#496) | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE`, `UnifiedItem`, `SynapseActionsView`, `SYNAPSE_ACTIONS_VIEW_TYPE`, `activateUnifiedView`, `activateSynapseActionsView`, `refreshUnifiedView`, `UnifiedViewSources`, `activeMarkdownFile`, `runRegisteredCommand` |
| onboarding | `src/onboarding/` | First-run welcome gate + required-API-key emphasis (#89) | `needsApiKey`, `planFirstRun`, `runFirstRunOnboarding`, `applyApiKeyEmphasis`, `FirstRunPlan`, `FirstRunDeps`, `WELCOME_MESSAGE` |
| brand-icons | `src/brand-icons/` | Registers Synapse SVG icons (S-Signal identity mark + feature glyphs) | `registerSynapseIcons`, `SYNAPSE_ICONS`, `SYNAPSE_ICON_SVG` |
| changelog | `src/changelog/` | In-app "What's new" modal; parses build-inlined `CHANGELOG.md` (#375) | `parseChangelog`, `renderChangelog`, `stripInlineMarkdown`, `ChangelogEntry`, `ChangelogSection`, `ChangelogModal` |
| properties-fold | `src/properties-fold/` | Auto-fold a note's Properties panel on open (#381) | `registerPropertiesAutoFold`, `applyPropertiesFold`, `foldActiveNoteProperties`, `foldPropertiesIn` |

## Dependency Graph

```
main.ts
  |-- settings.ts  (type-only: ProposalKind from views/types, ExclusionRule from shared/exclusions, TitleDuplicateStrategy from title/types — all erased; PLUS runtime value CURRENT_SETTINGS_VERSION from shared/settings-migrations, the sanctioned settings->shared edge — no cycle, settings-migrations only depends on shared/exclusions)
  |-- modules/ --> every feature barrel (runtime; the only file besides settings-ui that imports them all), shared/ (ModuleDeps / FeatureModule / FeatureSettingsKey types), settings.ts (types), obsidian Platform
  |-- settings-ui/ --> settings.ts, shared/, views/, every feature barrel's render<Feature>Settings, onboarding/, properties-fold/, changelog/ (type-only edge to main)
  |-- onboarding/ --> settings.ts (type-only), shared/ (redactError runtime; NotificationManager type)
  |-- checkpoints/ --> shared/ (redactError runtime; CheckpointManager/NotificationManager/Checkpoint types), commands/ (CommandRegistrar type); resume dispatch via injected CheckpointResumeHandlers (never imports a feature module)
  |-- brand-icons/ --> obsidian only
  |-- changelog/ --> CHANGELOG.md (build-inlined text); type-only edge to main
  |-- properties-fold/ --> settings.ts (type-only); type-only edge to main
  |-- commands/   (depends on NOTHING in src/ — never in a cycle)
  |-- shared/     (base layer: depends on NO feature module; owns url-detector; ONE type-only edge to commands/ — CommandRegistrar in feature-module.ts, erased at compile time)
  |-- pipeline/ --> commands/ (isPipelineKeyInFlow), shared/ (fireAndForget); modules injected via PipelineModuleMap / PostOpHookDeps
  |-- views/ --> type-only: elaboration, enrichment, organize, deep-dive, title, rem, shared (Checkpoint, NotificationManager), commands (CommandDefinition, FeatureKey);
  |            runtime: shared (fireAndForget, views/unified-proposal-view.ts:9 + views/view-activation.ts:2), commands (FEATURE_ICONS, views/synapse-actions-view.ts:3; REGISTRY_BY_ID, views/command-runner.ts:3), obsidian MarkdownView (views/command-runner.ts:1)
  |-- elaboration/ --> shared/, commands/, image/ (ImageAnalyzer uses shared AIClient + image/preprocessImage)
  |-- audio/ --> shared/, commands/; type-only edge to video/ (`import type { AudioExtractor }` — erased at compile time, no runtime cycle)
  |-- video/ --> shared/ (CheckpointManager, url-detector), commands/, audio/ (reuses transcription pipeline; runtime value edge)
  |-- image/ --> shared/ (CheckpointManager, AIClient, callouts, validation), commands/
  |-- transcription/ --> audio/ (AUDIO_EXTENSIONS, findAudioEmbeds runtime; AudioEmbed, TranscriptionResult types), video/ (detectPlatform re-export, findVideoUrls runtime; VideoUrlEmbed type), image/ (findImageEmbeds runtime; ImageEmbed type), shared/ (url-detector, validation, callouts, redact, json-utils, node-loader; TimeRange/NotificationManager/NoteOperationQueue types)
  |-- enrichment/ --> shared/, commands/
  |-- summarize/ --> shared/ (incl. isSupportedUrl/detectPlatform), commands/, audio/ (findAudioEmbeds); URL transcription injected at runtime (modules/registry.ts summarize entry -> ModuleWiring.transcribeUrl -> UrlTranscriptionRouter.transcribe; NO static video/transcription import edge)
  |-- tidy/ --> shared/, commands/
  |-- organize/ --> shared/, commands/
  |-- deep-dive/ --> shared/, commands/, organize/ (ContentAnalyzer, DirectoryMatcher)
  |-- title/ --> shared/
  |-- rem/ --> shared/, commands/
  +-- intake/ --> shared/ ONLY (cross-module work via injected IntakeDeps.fireOnFile / transcribeUrlToNote)
```

Key constraints:
- ACYCLIC. `shared` and `commands` are base layers depending on no feature module. The former
  `shared ⇄ video` cycle was eliminated by moving `url-detector.ts` into `shared`; the edge is now
  one-directional `video → shared` (correct layering).
- `commands` imports nothing in `src/`; `pipeline` imports `commands` + `shared` but never the feature modules
  (they are injected via `PipelineModuleMap` / `PostOpHookDeps` in main.ts). `checkpoints` likewise reaches
  feature modules only through the injected `CheckpointResumeHandlers`.
- `intake` imports only `obsidian` + `src/shared/*`; all cross-module work goes through `IntakeDeps`.
- `modules/registry.ts` (#504) is the one place that names every feature module: `MODULE_FACTORIES` order = construction = load order, unload is the reverse. Every module constructor takes `ModuleDeps` (`plugin`, `getSettings`, `notifications`, `checkpointManager`, `registrar`, `noteQueue`) first; module-specific inputs (auto-accept getter, `AudioExtractor`, `AudioModule`, summarize transcribe callbacks, `IntakeDeps`) follow positionally and are supplied by the entry's `create`. Platform gating is the entry's `platform` predicate (video: `Platform.isDesktop`), never a `main.ts` special case. Disabled modules are still constructed (reachable by views/hooks), only their `onload()` is skipped. `registry.test.ts` asserts every `src/<feature>/index.ts` `export class *Module` is constructed by the registry.
- `video` depends on `audio` (reuses transcription pipeline, runtime value import). Type-only back-edges (erased at compile time, no runtime cycle): `audio → video` (`import type { AudioExtractor }`, `audio/index.ts`) and `shared/settings-section.ts:1 → main` (`import type SynapsePlugin`)
- `transcription` owns the URL-transcription tier router (#184: `CaptionStrategy` on every platform, `LocalExtractionStrategy` desktop-only via an injected `VideoModule.processUrl` delegate) plus the modals; media decoding/AI work stays in `audio`, `video`, `image`
- `summarize` has NO static import of `video` or `transcription`; URL-platform helpers (`isSupportedUrl`/`detectPlatform`) resolve from `shared/url-detector`. It receives a URL-transcription callback (delegating to `UrlTranscriptionRouter.transcribe`, on every platform) and an audio transcribe callback via constructor injection. A router-supported media URL is only ever transcribed — never page-fetched — and a failed transcription inserts no summary (#488)
- Every URL-transcription path (unified modal, note-media batch, summarize, intake) shares ONE `UrlTranscriptionRouter` constructed over `SynapsePlugin.transcriptCache` (`shared/transcript-cache.ts`, #488): tier results are written through and later requests for the same canonical URL (+ time range) are served from the store unless `forceRefresh` is set
- `deep-dive` reuses `organize` for auto-organize nesting mode
- `image` module uses multi-modal `AIClient.chat()` with `ContentBlock[]` for vision
- `elaboration` module includes `ImageAnalyzer` for analyzing images in notes during proposal generation
- All feature modules depend on `shared`; no circular dependencies
- Modules with resumable scans (elaboration, enrichment, audio, video, image, summarize, organize, deep-dive, rem) retain `CheckpointManager` from `ModuleDeps`; `tidy`, `title`, `intake` receive the bundle but do not keep it; `transcription` is not a module
- Every feature whose write follows read -> AI -> write receives the single `NoteOperationQueue` (#483): audio, video, image, elaboration, enrichment, title, summarize, tidy, organize, deep-dive — plus `transcription/insert-url-transcript` via `InsertUrlTranscriptDeps.noteQueue`. Public entry points take the note's slot exactly ONCE and delegate to a queue-free private core; acquiring twice (the same key or a second one) would deadlock. Batch scans take one slot per note, never one per batch. Writes to OTHER notes while holding a key stay unqueued by design (title backlink remediation + merge targets, deep-dive syllabus/sibling nav, organize summary notes)
- Unqueued by design, because they re-derive inside the atomic callback instead of writing a pre-computed snapshot: `rem` accept/undo (`rem/index.ts:389,457` — `vault.process` recomputes the link application against fresh content) and `intake` stamp/move/breadcrumb (`intake/index.ts:404,474,495,554` — frontmatter stamps and a separate log note, run after every pipeline phase has finished). `SynapseRunner.fireOnFile` awaits its phases in sequence, so each phase acquires and releases the note's slot in turn
- `views` imports feature modules as types only; its runtime imports are `fireAndForget` (`shared`), `FEATURE_ICONS` + `REGISTRY_BY_ID` (`commands`), and `MarkdownView` (`obsidian`). Sidebar activation/refresh (`view-activation.ts`) reads proposals through the injected `UnifiedViewSources`
- Path exclusion is centralized (#307): the single `settings.exclusions: ExclusionRule[]` (model + matcher in `shared/exclusions.ts`) replaces the former per-module `excludeFolders` fields. Modules gate via `isPathExcluded(path, FeatureId, settings)` / `findMatchingRule`. Tag exclusion (`excludeTags`) stays per-module. `main.loadSettings()` runs a one-time `buildMigratedExclusions()` migration for upgraders whose persisted data has no `exclusions` key

## Plugin Lifecycle (main.ts)

`src/main.ts` (295 lines, #496/#504) owns only: settings load/save, single-instance service construction, the registry-driven module lifecycle, view/ribbon/command registration, and the injection of cross-module callbacks. It names no module in its lifecycle: `modules/registry.ts` constructs, loads and unloads them (see `src/modules/AGENTS.md`); `main.ts` only destructures the typed `FeatureModules` record to wire views, hooks and commands.

```
onload()
  |-- loadSettings()  (main.ts:272; #93 version-stamped migrations: readSettingsVersion(raw) -> migrateSettings(raw, from) replays every migration with to>from [v1 excludeFolders -> exclusions #307, v2 drop inert rem.semanticMatching] -> deepMergeSettings(DEFAULT_SETTINGS, migrated) (shared/settings-merge.ts) -> stamp settingsVersion = CURRENT_SETTINGS_VERSION -> saveData once on upgrade)
  |-- registerSynapseIcons()  (brand-icons/; registers all synapse-* glyphs before any ribbon/setIcon/view use)
  |-- new NotificationManager(); migrateDataFolder(vault.adapter, notifications)  (shared/data-folder-migration.ts; .auto-notes -> .synapse, one-time; main.ts:49-50)
  |-- addSettingTab; status bar attached on desktop only
  |-- new CheckpointManager(app), new NoteOperationQueue(), transcriptCache = new TranscriptCache(app), new CommandRegistrar(this)  (single instances, main.ts:55-59)
  |-- deps: ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue }  (main.ts:60-67)
  |-- modules = modules.constructFeatureModules(deps, wiring)  (main.ts:69-81; #504; MODULE_FACTORIES order, audio before video, video only when Platform.isDesktop; every module constructed, disabled ones included)
  |     wiring.transcribeUrl -> this.urlTranscription.transcribe (set as video.urlTranscriber + summarize transcribeUrl by the registry)
  |     wiring.intake = { fireOnFile -> this.synapseRunner.fireOnFile, transcribeUrlToNote -> transcription.appendUrlTranscript }  (closures resolve the two fields built next; they only run at operation time)
  |-- this.urlTranscription = createUrlTranscriptionRouter({ getSettings, processTranscriptText: audio.processTranscriptText(raw, opts), extract?, store: transcriptCache })  (#184/#488; main.ts:84-91; extraction tier only when video exists)
  |-- build PipelineModuleMap + this.synapseRunner = new SynapseRunner(...)  (main.ts:92-100)
  |-- new UpdateChecker({ currentVersion, app, notifications, getSettings, saveSettings })  (#365; main.ts:101)
  |-- viewSources: UnifiedViewSources (main.ts:109); refreshView = views.refreshUnifiedView(workspace, viewSources); openProposalView = fireAndForget(views.activateUnifiedView(...))
  |-- resumeHandlers: CheckpointResumeHandlers (main.ts:122; video entry notifies "not available on mobile" when VideoModule is null); checkpoints = new CheckpointRecoveryModule({ checkpointManager, notifications, registrar, resumeHandlers, refreshView })  (main.ts:135)
  |-- registerView(UNIFIED_VIEW_TYPE) (main.ts:143), registerView(SYNAPSE_ACTIONS_VIEW_TYPE) (main.ts:162; runAction -> views.runRegisteredCommand, isNoteActive -> views.activeMarkdownFile); active-leaf-change -> SynapseActionsView.refresh()
  |-- registerPropertiesAutoFold(this, getSettings)  (#381)
  |-- for each modules.listFeatureModules(modules): assign onViewRefreshNeeded / onOpenProposalView where the slot exists (main.ts:173-176; the six proposal modules)
  |-- await modules.loadFeatureModules(modules, settings)  (main.ts:177; onload() per settings.<key>.enabled entry, registry order, intake included)
  |-- post-op hooks (main.ts:180-194): pipeline.buildPostOpHook(postOpDeps, source) per source; buildAutoOrganizeHook for deep-dive / summarize
  |-- openUnifiedModal = transcription.openUnifiedTranscriptionModal(deps) (main.ts:196); isFfmpegAvailable = video.createFfmpegAvailability(audio.extractor) (main.ts:205)
  |-- addRibbonIcon x3 (main.ts:207-211); registrar.register('review-proposals')
  |-- checkpoints.onload()  (registers manage-checkpoints; arms the 3s startup interrupted-operation check; main.ts:216)
  |-- updateCheckTimeout = setTimeout(updateChecker.maybeCheck, 5000)  (#365; self-gated, once/day)
  |-- registrar.register('transcribe-media' -> openUnifiedModal, 'transcribe-note-media' -> transcription.transcribeNoteMedia(deps, ctx.file))  (main.ts:221-239)
  |-- registrar.register('fire' -> synapseRunner.fire); auditCommands(registrar.getAttempted())  (logs drift; main.ts:241-249)
  +-- runFirstRunOnboarding({ getSettings, isFreshInstall, markSeen, notifications })  (#89; onboarding/; main.ts:250)

onunload()  (main.ts:261)
  |-- clearTimeout(updateCheckTimeout)
  |-- checkpoints?.onunload()
  |-- modules.unloadFeatureModules(modules)  (reverse registry order; skipped when construction never ran)
  +-- notifications.dispose()  (tears down in-flight operation ellipsis intervals + hides notices so a
                                disable mid-operation never leaks an orphaned 400ms setInterval on a detached toast)
```

Cluster -> destination map (#496):

| Former `main.ts` cluster | Now |
|--------------------------|-----|
| Post-op hook table (enrich / title check / auto-organize) | `pipeline/post-op-hooks.ts` — `buildPostOpHook`, `buildAutoOrganizeHook` |
| Checkpoint UX (discard / resume / startup check / manage) | `checkpoints/checkpoint-recovery.ts` — `CheckpointRecoveryModule` |
| View activation + refresh; actions-sidebar command dispatch | `views/view-activation.ts`, `views/command-runner.ts` |
| `openUnifiedModal`, `transcribeMediaFromNote`, intake URL append, router assembly | `transcription/open-unified-modal.ts`, `note-media-transcription.ts`, `insert-url-transcript.ts` (`appendUrlTranscript`), `create-url-router.ts` |
| `isFfmpegAvailable` | `video/ffmpeg-availability.ts` — `createFfmpegAvailability` |
| `migrateDataFolder`, `deepMerge` | `shared/data-folder-migration.ts`, `shared/settings-merge.ts` |
| `runFirstRunOnboarding` | `onboarding/onboarding.ts` — `runFirstRunOnboarding` |
| `dispatchDeferredTasks` (no callers) | removed |
| Per-module fields, construction block, enabled-gated `onload()` list, `onunload()` list (#504) | `modules/registry.ts` — `MODULE_FACTORIES`, `constructFeatureModules`, `loadFeatureModules`, `unloadFeatureModules` |

## Command Registry

Source of truth: `src/commands/registry.ts` (mirrored here). 23 registry entries + 1 synthetic pipeline-only entry. Only `status: active` entries register/run; 6 ship `disabled` as a developer master switch (gated out of registration). Flows: `p`=palette, `f`=fire-synapse, `s`=startup. `pipelineKey` links an entry to a Fire Synapse phase. Each entry also carries a `context` (`note` | `vault` | `global`); the Synapse actions sidebar (`listPaletteActions`) uses it to disable per-note (`note`) buttons when no note is active.

| ID | Name | Type | Module | Flows | Status | pipelineKey |
|----|------|------|--------|-------|--------|-------------|
| `synapse:review-proposals` | Open proposal review sidebar | callback | main | p | active | |
| `synapse:manage-checkpoints` | Manage interrupted operations | callback | main (registered by `checkpoints/`) | p | active | |
| `synapse:transcribe-media` | Transcribe media | callback | main | p | disabled | |
| `synapse:transcribe-note-media` | Transcribe current note | editorCallback | main | p | active | |
| `synapse:fire` | Run all features on a folder | callback | main | p | active | |
| `synapse:scan-vault` | Scan folder for stub notes | callback | elaboration | p, f, s | active | elaboration |
| `synapse:scan-current-note` | Elaborate current note | editorCallback | elaboration | p | active | |
| `synapse:clear-proposals` | Clear all pending proposals | callback | elaboration | p | disabled | |
| `synapse:enrich-current-note` | Enrich current note | editorCallback | enrichment | p | active | |
| `synapse:scan-vault-enrichment` | Scan folder for enrichment | callback | enrichment | p, f | active | enrichment |
| `synapse:undo-enrichment` | Undo last enrichment on current note | editorCallback | enrichment | p | disabled | |
| `synapse:organize-current-note` | Organize current note | editorCallback | organize | p | active | |
| `synapse:scan-directory-organize` | Scan folder for organization | callback | organize | p, f | active | organize |
| `synapse:undo-organize` | Undo last organize on current note | editorCallback | organize | p | disabled | |
| `synapse:deep-dive` | Deep dive current note | editorCallback | deep-dive | p | active | |
| `synapse:clear-deep-dive` | Clear deep dive proposals | callback | deep-dive | p | disabled | |
| `synapse:summarize-current-note` | Summarize current note | editorCallback | summarize | p | active | |
| `synapse:scan-vault-summarize` | Scan folder for notes to summarize | callback | summarize | p, f | active | summarize |
| `synapse:tidy-current-note` | Tidy current note | editorCallback | tidy | p | active | |
| `synapse:undo-tidy` | Undo last tidy on current note | editorCallback | tidy | p | disabled | |
| `synapse:rem-current-note` | REM: discover links in current note | editorCallback | rem | p | active | |
| `synapse:rem-directory` | Scan folder for links | callback | rem | p, f | active | rem |
| `synapse:check-dependencies` | Check external tool availability | callback | video | p | active | |
| `synapse:tidy-vault` | Scan folder for notes to tidy | (synthetic) | tidy | f | active | tidy |

`synapse:tidy-vault` is synthetic and pipeline-only: it gates the tidy Fire Synapse phase independently of any palette command and is never passed to `registrar.register()`. Fire Synapse phase order: elaboration → summarize → enrichment → rem → tidy → organize.

## Ribbon Icons

All ribbon glyphs are custom Synapse brand icons registered by `registerSynapseIcons()` (`src/brand-icons/`).

| Icon | Label | Action |
|------|-------|--------|
| `synapse` | Review proposals | Opens unified proposal sidebar |
| `synapse-transcribe` | Transcribe media | Opens unified transcription modal (every platform since #184; `main.ts:208` -> `transcription.openUnifiedTranscriptionModal`) |
| `synapse-actions` | Synapse actions | Opens registry-driven actions sidebar |

## View Types

| View Type ID | Class | Location |
|--------------|-------|----------|
| `synapse-proposals` | `UnifiedProposalView` | `src/views/unified-proposal-view.ts` |
| `synapse-actions` | `SynapseActionsView` | `src/views/synapse-actions-view.ts` |

Legacy view `ProposalReviewView` (`src/elaboration/proposal-view.ts:7`) exists in source but is not registered.

## Callout Types

All AI-generated content uses Obsidian callouts. Registry in `src/shared/callouts.ts`:

| Key | Type string | Usage |
|-----|-------------|-------|
| summary | `synapse-summary` | Inline URL/transcription summaries |
| transcription | `synapse-transcription` | Audio/video transcriptions |
| enrichment | `synapse-enrichment` | Enrichment sections |
| elaboration | `synapse-elaboration` | Elaboration proposals |
| deepDive | `synapse-deep-dive` | Deep dive content |
| nav | `synapse-nav` | Deep dive navigation blocks |
| ocr | `synapse-ocr` | Image OCR extraction results |

## Settings Schema

```ts
SynapseSettings {
  settingsVersion: number                           // #93; persisted schema version, stamped to CURRENT_SETTINGS_VERSION (2) on save; drives the migration runner
  ai: AISettings {
    provider: 'openai' | 'anthropic' | 'gemini' | 'ollama'   // AIProvider, default: 'openai'
    apiKey: string                                  // default: ''
    ollamaEndpoint: string                          // default: 'http://localhost:11434'
    model: string                                   // default: 'gpt-4o' (dropdown values per provider in MODEL_OPTIONS)
    maxTokens: number                               // default: 2048
    temperature: number                             // default: 0.7
    cacheResponses: boolean                         // default: false (#397; opt-in AI response cache; caching is automatic at temperature 0)
  }
  elaboration: ElaborationSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/proposals'
    scanOnStartup: boolean                          // default: false
    autoScanInterval: number                        // default: 0 (disabled, minutes)
    detection: DetectionSettings {
      minWordThreshold: number                      // default: 50
      detectTodoMarkers: boolean                    // default: true
      detectEmptySections: boolean                  // default: true
      detectSparseLinks: boolean                    // default: true
      excludeTags: string[]                         // default: ['no-elaborate']
    }
    proposal: ProposalSettings {
      maxProposalsPerNote: number                   // default: 3
      preserveFrontmatter: boolean                  // default: true
      includeSourceContext: boolean                  // default: true
    }
  }
  audio: AudioSettings {
    enabled: boolean                                // default: true
    transcriptionProvider: 'whisper-api' | 'deepgram' | 'gemini' | 'local-whisper'  // default: 'whisper-api'
    whisperApiKey: string                           // default: '' (fallback: ai.apiKey)
    deepgramApiKey: string                          // default: ''
    geminiApiKey: string                            // default: '' (fallback: ai.apiKey)
    whisperModel: string                            // default: 'whisper-1'
    localWhisperPath: string                        // default: ''
    language: string                                // default: ''
    autoFormatLyrics: boolean                       // default: true (auto-detect song transcripts, format as lyrics, #234)
    postProcessing: PostProcessingSettings {
      enabled: boolean                              // default: true
      removeFiller: boolean                         // default: false (#465; opt-in per vault)
      addStructure: boolean                         // default: true
      extractKeyPoints: boolean                     // default: false
      customPrompt: string                          // default: ''
    }
  }
  video: VideoSettings {
    enabled: boolean                                // default: true
    ytDlpPath: string                               // default: 'yt-dlp'
    ffmpegPath: string                              // default: 'ffmpeg'
    tempFolder: string                              // default: '.synapse/temp'
    downloadFolder: string                          // default: 'Media'
    embedInNote: boolean                            // default: true
    captionsFirst: boolean                          // default: true (#184; prefer the YouTube caption tier; off = always download+transcribe on desktop)
    frameExtraction: FrameExtractionSettings {
      enabled: boolean                              // default: false
      intervalSeconds: number                       // default: 30
      visionModel: string                           // default: 'gpt-4o'
      maxFrames: number                             // default: 20
    }
  }
  image: ImageSettings {
    enabled: boolean                                // default: true
    visionModel: string                             // default: '' (falls back to ai.model)
    language: string                                // default: ''
    maxImageSizeMb: number                          // default: 5 (auto-downscale threshold)
  }
  enrichment: EnrichmentSettings {
    enabled: boolean                                // default: true
    autoEnrich: boolean                             // default: true
    maxTags: number                                 // default: 5
    maxInternalLinks: number                        // default: 15
    maxExternalLinks: number                        // default: 3
    maxTopicLinks: number                           // default: 10
    suggestNewNotes: boolean                        // default: true
    tagVocabulary: TagVocabularyEntry[]              // default: 3 entries (Status, Type, Source)
    internalLinkThreshold: number                   // default: 0.3
    weights: EnrichmentWeightSettings               // sameFolder, siblingFolder, cousinFolder, distantFolder, decayPerLevel, minWeight
    enrichmentFolderPath: string                    // default: '.synapse/enrichments'
    excludeTags: string[]                           // default: ['no-enrich']
    relatedNotesHeading: string                     // default: 'Related Notes'
    referencesHeading: string                       // default: 'References'
  }
  summarize: SummarizeSettings {
    enabled: boolean                                // default: true
    maxContentLength: number                        // default: 4000
    summaryStyle: 'bullets' | 'paragraph' | 'key-points'  // default: 'bullets'
    customPrompt: string                            // default: ''
    autoDetectTemplates: boolean                    // default: true
    excludeTags: string[]                           // default: ['no-summarize']
    autoOrganizeOnSummarize: boolean                // default: false
    includeNoteContent: boolean                     // default: true (summarize the note's own prose as an extra item, #367)
    combineSummaries: boolean                       // default: true (emit one combined summary instead of a callout per item, #367)
  }
  tidy: TidySettings {
    enabled: boolean                                // default: true
    snapshotFolderPath: string                      // default: '.synapse/tidy-snapshots'
  }
  organize: OrganizeSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/organize/proposals'
    snapshotFolderPath: string                      // default: '.synapse/organize/snapshots'
    excludeTags: string[]                           // default: ['no-organize']
    organizeConfidenceThreshold: number             // default: 0.9
  }
  deepDive: DeepDiveSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/deep-dive'
    maxDepth: number                                // default: 3
    qualityThreshold: number                        // default: 0.4
    maxNotesPerRun: number                          // default: 50
    noteOutputFolder: string                        // default: 'Deep Dives'
    nestingMode: 'nested' | 'flat' | 'auto-organize'  // DeepDiveNestingMode, default: 'nested'
    excludeTags: string[]                           // default: ['no-deep-dive']
    autoEnrichOnAccept: boolean                     // default: true
    autoOrganizeOnAccept: boolean                   // default: false
  }
  title: TitleSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/title-proposals'
    checkAfterOperations: boolean                   // default: true
    duplicateHandling: 'iterate' | 'merge'          // TitleDuplicateStrategy, default: 'iterate' (#408; resolve a proposed title colliding with an existing file)
  }
  rem: RemSettings {
    enabled: boolean                                // default: true
    titleMatchWeight: number                        // default: 0.6 (weight for literal title/alias matches)
    confidenceThreshold: number                     // default: 0.5 (semantic matches only)
    maxLinksPerNote: number                         // default: 20
    remFolderPath: string                           // default: '.synapse/rem'
  }
  intake: IntakeSettings {
    enabled: boolean                                // default: true
    intakeFolder: string                            // default: 'Inbox'
    markProcessed: boolean                          // default: true
    moveWhenDone?: string                           // default: '' (fallback mover)
    settleSeconds: number                           // default: 5 (debounce settle window)
    captureLog: boolean                             // default: true
    captureLogFolder: string                        // default: '_captured'
    adoptSharedCaptures: boolean                    // default: false (#455; also watch newly created root-level bare-URL notes and move them into intakeFolder)
  }
  ui: UISettings {
    collapsedSections: Record<string, boolean>      // default: {} (settings accordion state, #235)
    autoFoldProperties: boolean                     // default: false (fold note Properties panel on open, #381)
  }
  autoAccept: AutoAcceptSettings {                  // Record<ProposalKind, boolean>, all default false
    elaboration: boolean                            // default: false
    enrichment: boolean                             // default: false
    organize: boolean                               // default: false
    'deep-dive': boolean                            // default: false
    title: boolean                                  // default: false
    rem: boolean                                    // default: false (NOTE: rewrites note body)
  }
  onboarding: OnboardingSettings {
    hasSeenWelcome: boolean                         // default: false (first-run welcome gate, #89)
  }
  updates: UpdateSettings {                          // in-app "newer release available" check (#365)
    enableUpdateNotifications: boolean              // default: true (master toggle)
    lastUpdateCheck?: number                        // epoch ms of last GitHub check (success or failure); absent until first check
    dismissedUpdateVersion?: string                 // newest version already notified; absent until first notice
  }
  exclusions: ExclusionRule[]                        // centralized per-path exclusion (#307); default 2 rules (see below)
}
```

Centralized path exclusion (#307). `ExclusionRule` and the glob matcher live in
`src/shared/exclusions.ts`; type-only-imported into `settings.ts`:

```ts
type FeatureId = 'elaboration' | 'enrichment' | 'summarize' | 'tidy' | 'organize'
               | 'deep-dive' | 'audio' | 'video' | 'title' | 'image' | 'rem' | 'intake'
interface ExclusionRule { pattern: string; features: 'all' | FeatureId[] }
// ALL_FEATURE_IDS (exclusions.ts) is a compile-time exhaustiveness guard over this union.
```

Default `exclusions`: `[{ pattern: '.synapse/**', features: 'all' }, { pattern: 'templates/**', features: 'all' }]`.
Modules gate paths via `isPathExcluded(path, featureId, settings)` / `findMatchingRule`. The legacy
per-module `excludeFolders` fields were removed; `main.loadSettings()` runs a one-time
`buildMigratedExclusions()` migration for upgraders whose persisted data lacks an `exclusions` key.

Provider model dropdowns: `MODEL_OPTIONS: Record<AIProvider, Record<id, label>>` in `src/settings.ts`.
openai: gpt-4o, gpt-4o-mini, o3, o3-mini, o4-mini. anthropic: fable, opus, sonnet, haiku (resolved to
full IDs in `ai-client.ts`). gemini: gemini-3.8-flash, gemini-3.5-flash, gemini-3.1-flash-lite,
gemini-2.5-pro, gemini-2.5-flash. ollama: llama3.2, llama3, gemma4, gemma3, gemma, qwen3, deepseek-r1,
mistral, codellama.

`ProposalKind` (`src/views/types.ts`) is the single source of truth for `PROPOSAL_KINDS` and keys of `autoAccept`:
`'elaboration' | 'enrichment' | 'organize' | 'deep-dive' | 'title' | 'rem'`. A compile-time guard asserts it
matches the `UnifiedItem` union exactly.

## Data Storage

| Purpose | Path | Format |
|---------|------|--------|
| Elaboration proposals | `.synapse/proposals/*.json` | `Proposal` JSON |
| Enrichment proposals | `.synapse/enrichments/*.json` | `EnrichmentProposal` JSON |
| Tidy snapshots | `.synapse/tidy-snapshots/*.json` | `TidySnapshot` JSON |
| Organize proposals | `.synapse/organize/proposals/*.json` | `OrganizeProposal` JSON |
| Organize snapshots | `.synapse/organize/snapshots/*.json` | `OrganizeSnapshot` JSON |
| Organize summaries | `.synapse/organize/summaries/*.md` | Mermaid move diagrams |
| Deep dive proposals | `.synapse/deep-dive/*.json` | `DeepDiveProposal` JSON |
| Deep dive runs | `.synapse/deep-dive/runs/*.json` | `DeepDiveRun` JSON |
| Title proposals | `.synapse/title-proposals/*.json` | `TitleProposal` JSON |
| REM proposals | `.synapse/rem/*.json` | `RemProposal` JSON |
| Intake breadcrumbs | `‹intakeFolder›/_captured/*.md` (configurable) | Dated wiki-link breadcrumb notes |
| Checkpoints | `.synapse/checkpoints/*.json` | `Checkpoint` JSON |
| Transcript cache | `.synapse/transcript-cache.json` | `{ version: 1, entries: Record<key, TranscriptCacheEntry> }` (#488); key = canonical media URL (+ `#t=start-end`); LRU-capped at 200 entries / 4M chars; cleared from Video settings |
| Temp video/audio | `.synapse/temp/` | Binary (auto-cleaned) |
| Downloaded videos | `Media/` (configurable) | Video files |

## Cross-Module Callbacks (wired in main.ts)

Post-op hooks are built by `pipeline/post-op-hooks.ts` (`buildPostOpHook(postOpDeps, source)` / `buildAutoOrganizeHook(postOpDeps, trigger)`, `main.ts:180-194`); `PostOpHookDeps` injects `enrichment.enrich`, `title.checkTitle`, `organize.organizeNote`.

```
elaboration.onProposalAccepted(filePath) --> enrichment.enrich(filePath, 'elaboration')
audio.onTranscriptionComplete(filePath)  --> enrichment.enrich(filePath, 'transcription')
video.onTranscriptionComplete(filePath)  --> enrichment.enrich(filePath, 'transcription')
image.onExtractionComplete(filePath)     --> enrichment.enrich(filePath, 'transcription')
summarize.onSummaryComplete(filePath)    --> enrichment.enrich(filePath, 'summarization')
deepDive.onNoteAccepted(filePath)        --> enrichment.enrich(filePath, 'deep-dive')
deepDive.onOrganizeRequested(file)       --> organize.organizeNote(file)
summarize.onOrganizeRequested(file)      --> organize.organizeNote(file)

// Title checks (after enrichment or standalone when enrichment disabled)
elaboration.onProposalAccepted(filePath) --> title.checkTitle(filePath)
audio.onTranscriptionComplete(filePath)  --> title.checkTitle(filePath)
video.onTranscriptionComplete(filePath)  --> title.checkTitle(filePath)
image.onExtractionComplete(filePath)     --> title.checkTitle(filePath)
summarize.onSummaryComplete(filePath)    --> title.checkTitle(filePath)
deepDive.onNoteAccepted(filePath)        --> title.checkTitle(filePath)

elaboration.onViewRefreshNeeded()        --> views.refreshUnifiedView(workspace, viewSources)
enrichment.onViewRefreshNeeded()         --> views.refreshUnifiedView(workspace, viewSources)
organize.onViewRefreshNeeded()           --> views.refreshUnifiedView(workspace, viewSources)
deepDive.onViewRefreshNeeded()           --> views.refreshUnifiedView(workspace, viewSources)
title.onViewRefreshNeeded()              --> views.refreshUnifiedView(workspace, viewSources)
rem.onViewRefreshNeeded()                --> views.refreshUnifiedView(workspace, viewSources)
<module>.onOpenProposalView()            --> views.activateUnifiedView(workspace, viewSources)   // "Review" toast action (#340)

// Intake (IntakeDeps = ModuleWiring.intake, main.ts:72-79, handed to IntakeModule by the registry)
intake.deps.fireOnFile(file)             --> SynapseRunner.fireOnFile(file)   // whole pipeline on one note
intake.deps.transcribeUrlToNote(url, _, file) --> transcription.appendUrlTranscript(deps, url, file) (main.ts:74-78): urlTranscription.transcribe(url) + buildUrlTranscriptBlock -> vault.process append; rethrows so the note stays un-stamped/retriable

// Per-proposal-type auto-accept (#228): each module gets a live getter, built by modules/registry.ts (autoAccept(deps, kind))
<module>.shouldAutoAccept()              --> () => settings.autoAccept[kind]

// Set by modules/registry.ts at construction (ModuleWiring.transcribeUrl = main.ts:70-71 -> urlTranscription.transcribe)
video.urlTranscriber(url, parentOp)      --> wiring.transcribeUrl(url, parentOp)
summarize.transcribeUrl(url, parentOp)   --> (await wiring.transcribeUrl(url, parentOp)).text
summarize.transcribeAudio(file)          --> vault.readBinary(file) -> audio.transcribe(data, file.name) -> processed || raw
```

Enrichment callbacks wired when `enrichment.enabled && enrichment.autoEnrich` (evaluated once at wire time).
Deep-dive enrichment wired when `deepDive.autoEnrichOnAccept`.
Deep-dive organize wired when `deepDive.autoOrganizeOnAccept && organize.enabled`.
Summarize organize wired when `summarize.autoOrganizeOnSummarize && organize.enabled`.
Title checks wired when `title.enabled && title.checkAfterOperations` — read LIVE per call under auto-enrich, once at wire time for the standalone (enrichment-off) hook. A source whose gates all fail keeps a `null` hook.
Auto-accept getters wired for elaboration, enrichment, organize, deep-dive, title, rem (default `false`).

All callbacks are dispatched through `fireAndForget` (never awaited, `pipeline/post-op-hooks.ts`). For the queued modules (elaboration, audio, video, image) the callback fires from INSIDE the primary operation's `NoteOperationQueue` slot, so the chained `enrichment.enrich` / `title.checkTitle` enqueue BEHIND the primary write and run against the content it produced — nothing awaits them, so there is no cycle and no deadlock (#483). `title.acceptProposal` holds the PRE-rename key; work already queued under the old path runs afterwards, finds no file and exits early.

Automatic post-op chained calls pass `{ postOp: true }` (`enrichment.enrich(path, trigger, { postOp: true })`, `title.checkTitle(path, { postOp: true })`) so the secondary auto-run never surfaces an extra "Review" toast — the centralized `reviewAction` gate (#366) suppresses the affordance on post-op runs. `onTitleAccept(id, resolution?)` forwards the user's duplicate-resolution choice (`'iterate'` | `'merge'`, #408) into `title.acceptProposal`.

## Checkpoint System

All vault-scan operations (elaboration, enrichment, audio, video, image, summarize, organize, deep-dive, rem) use `CheckpointManager` for resumable operations:

```
main.ts creates single CheckpointManager, injected into all modules
  |
  |-- On vault scan: module creates checkpoint with work items
  |-- After each file: module calls completeItem()
  |-- On completion: module calls complete(), dispatches deferred tasks
  |-- On cancel/error: module calls discard()
  |
  |-- On startup (STARTUP_CHECK_DELAY_MS = 3s): CheckpointRecoveryModule.checkForIncomplete()  (checkpoints/)
  |     Lists active checkpoints, offers Review/Dismiss; Review opens manage()
  |
  |-- synapse:manage-checkpoints command (registered by CheckpointRecoveryModule.onload): manage()
  |     Per checkpoint: Resume / More options -> Discard / Keep
  |
  |-- UnifiedProposalView: shows checkpoint banner with Resume/Discard buttons
  |     -> CheckpointRecoveryModule.resume(id) / discard(id)
  |-- resume(id): checkpointManager.resume -> resumeHandlers[checkpoint.module](checkpoint)  (map built in main.ts:122; each entry is <module>.resumeFromCheckpoint) -> refreshView()
```

Checkpoint cleanup: completed/discarded checkpoints older than 7 days are auto-removed on startup.

## Multi-Modal AI Support

`AIClient.chat()` accepts `ChatMessage[]` where `content` can be `string | ContentBlock[]`:

```ts
type ContentBlock = TextContentBlock | ImageContentBlock
interface TextContentBlock { type: 'text'; text: string }
interface ImageContentBlock { type: 'image'; data: string; mediaType: string }
```

Provider-specific format conversion:
- OpenAI: `image_url` with `data:` URI
- Anthropic: `image` source with `base64` type
- Gemini: `inline_data` with `mime_type` + base64 `data` (REST snake_case); system role routed to `system_instruction`
- Ollama: separate `images` array on the message

Used by: `image/extractor.ts` (OCR), `elaboration/image-analyzer.ts` (image analysis for proposals)

Gemini responses are parsed via `extractGeminiResponseText()` (exported from `shared/ai-client.ts`),
which throws descriptive errors for blocked/empty HTTP-200 shapes (`promptFeedback.blockReason`,
`finishReason: MAX_TOKENS`) instead of crashing. Shared by `AIClient.callGemini()` and
`audio/transcriber.ts` (Gemini transcription provider).

## External Dependencies (Runtime)

| Tool | Required By | Detection |
|------|-------------|-----------|
| yt-dlp | video module | `synapse:check-dependencies` command |
| ffmpeg | video module | `synapse:check-dependencies` command |

No npm runtime dependencies. Uses Obsidian `requestUrl`, `execFile` (argument arrays, no shell), and browser `fetch`.

## Test Infrastructure

| Component | Path |
|-----------|------|
| Config | `vitest.config.ts` |
| Setup | `src/__test-utils__/setup.ts` |
| Obsidian mock | `src/__mocks__/obsidian.ts` |
| Mock factories | `src/__test-utils__/mock-factories.ts` |
| Test files | `src/**/*.test.ts` |
| Lint config | `eslint.config.mjs` (flat, type-aware) |
| Custom lint rules | `scripts/eslint-rules/no-unredacted-console.mjs` (redactError contract gate, #418) |

Framework: Vitest, globals enabled, node environment.

## Security Notes

- URLs validated via `sanitizeUrl()` before external tool invocation
- Paths validated via `sanitizePath()` (rejects `..`, null bytes, shell metacharacters)
- AI output sanitized via `sanitizeAIResponse()` before vault writes
- Secret redaction centralized in `shared/redact.ts` (`redactSecrets`); the AI client (`ai-client.ts`, upstream error bodies), the notification manager (`notifications.ts` — every error sink: the operation-error `console.error`, `showErrorNotice`, and the `NotificationManager.notifyError` method), credential validation (`credential-validator.ts`, probe error bodies), the credential Test-button chip (`credential-field.ts`, validation-catch message), and the update checker's fetch-failure log (`update-checker.ts`) all route through it — single source of truth, re-exported from `ai-client` and the `shared` barrel. Covers `sk-`/`sk-ant-`, `key-`, Deepgram `dg-`, `Bearer `/`Token ` headers, `anthropic-`, and Google `AIza` keys. `redactError(value)` (also `shared/redact.ts`) extends this to raw caught errors: every direct error console sink (`main.ts` settings-migration path, `onboarding/onboarding.ts` first-run catch, `checkpoints/checkpoint-recovery.ts` incomplete-checkpoint catch, `shared/data-folder-migration.ts`, `update-checker.ts` unexpected-error catch, audio, rem/semantic-matcher, elaboration/image-analyzer + proposer, image/preprocess downscale fallback, the clipboard-copy catches in notifications + video/settings-section, shared/fire-and-forget) renders the error through it so a secret echoed into an error message/stack never reaches the console verbatim. The contract is lint-enforced (#418): custom type-aware rule `synapse/no-unredacted-console` (`scripts/eslint-rules/no-unredacted-console.mjs`, registered in `eslint.config.mjs`) errors on any `console.*` argument that is not statically string-like or routed through `redactError`/`redactSecrets`; scoped to shipped code (`src/**/*.ts`, excluding `*.test.ts`, `src/__mocks__/`, `src/__test-utils__/`)
- Credential validation (`shared/credential-validator.ts`, `validateCredentials`) probes each provider with a single minimal GET (probe specs in `shared/provider-metadata.ts`); every result message routes through `redactSecrets`, so a key echoed in a 401/400 body cannot reach the status chip. One-shot (no retry), 10s timeout, `throw:false`. Validation state is ephemeral (never persisted to settings)
- Multipart transcription bodies (`audio/transcriber.ts:buildMultipartBody`) sanitize vault-/settings-derived field names and file names via `sanitizeMultipartHeaderValue` (strips CR/LF, replaces `"`/`\` with `_`) to block `Content-Disposition` header / multipart injection
- Gemini audio transcription places its instruction in `system_instruction` (not the user turn beside the audio) so speech inside untrusted audio cannot override the prompt (prompt-injection hardening)
- Untrusted external content (article/tweet/Reddit bodies, image analysis) is fenced via `shared/untrusted-content.ts` `wrapUntrusted(content, source)` before splicing into a prompt — labeled delimiters + a data-not-instructions frame + anti-breakout sentinel scrubbing; a structural (not lexical) prompt-injection defense. Used by elaboration/proposer
- Ollama endpoint: HTTPS required (HTTP for localhost only)
- External commands use `execFile` with argument arrays (no shell interpolation)
- Frontmatter keys validated against allowlist pattern + forbidden keys blocklist
- Enrichment sections use `%% synapse-enrichment-start/end %%` markers for idempotent updates
- Checkpoint IDs validated against `/^[a-z0-9]+$/` to prevent path traversal
- Deep merge in settings rejects `__proto__`, `constructor`, `prototype` keys
