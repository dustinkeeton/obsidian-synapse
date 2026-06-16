---
last-updated: 2026-06-11
---

# Synapse — Agent Reference

AI-powered Obsidian plugin: stub note elaboration, audio/video transcription, image OCR, note enrichment (tags, links, references), summarization, note tidying, semantic organization, recursive deep dive note generation, REM wikilink discovery, intake-folder auto-processing, Fire Synapse multi-phase pipeline, and checkpoint-based operation resumability.

## Build and Test

```sh
npm run build          # tsc -noEmit -skipLibCheck && node esbuild.config.mjs production
npm run dev            # esbuild watch
npm test               # vitest run
npm run test:watch     # vitest watch
npm run test:coverage  # vitest run --coverage
npx tsc --noEmit --skipLibCheck  # type-check only
```

Output: `main.js` (single bundle, Obsidian loads this)

## Module Registry

| Module | Path | Purpose | Public API |
|--------|------|---------|------------|
| main | `src/main.ts` | Plugin entry, module orchestration, command/view registration, checkpoint dispatch | `SynapsePlugin` (default) |
| settings | `src/settings.ts` | Settings interfaces, defaults, model options | `SynapseSettings`, `DEFAULT_SETTINGS`, `AIProvider`, `MODEL_OPTIONS` |
| settings-tab | `src/settings-tab.ts` | Obsidian settings UI | `SynapseSettingTab` |
| commands | `src/commands/` | Command registry: developer source of truth + master control (status/flow gating), central registrar, drift audit | `CommandRegistrar`, `COMMAND_REGISTRY`, `isInFlow`, `isPipelineKeyInFlow`, `auditCommands` |
| pipeline | `src/pipeline/` | Fire Synapse orchestration: ordered multi-phase run over a folder or single note | `SynapseRunner`, `SYNAPSE_PIPELINE`, `PipelineModuleKey`, `PipelineModuleMap`, `PipelineScanFn` |
| intake | `src/intake/` | Watches intake folder, auto-routes + pipeline-processes new notes (#111) | `IntakeModule`, `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute` |
| rem | `src/rem/` | REM: discover linkable references, propose in-place `[[wikilink]]` insertions | `RemModule`, types |
| elaboration | `src/elaboration/` | Stub note detection, AI proposal generation, image analysis for proposals | `ElaborationModule`, `ImageAnalyzer`, types |
| audio | `src/audio/` | Audio transcription (Whisper, Deepgram, local), post-processing | `AudioModule`, `findAudioEmbeds`, types |
| video | `src/video/` | Video download (YouTube/TikTok), audio extraction, transcription | `VideoModule`, `findVideoUrls`, `detectPlatform`, `isSupportedUrl`, types |
| image | `src/image/` | Image OCR via multi-modal AI (vision models), batch extraction with checkpoints | `ImageModule`, `findImageEmbeds`, `ImageExtractor`, types |
| transcription | `src/transcription/` | Unified transcription/OCR UI modals, duration detection, time-range clipping UI | `UnifiedTranscriptionModal`, `NoteMediaModal`, `TimeRangeSlider`, `showTimeRangeToast`, `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp` |
| enrichment | `src/enrichment/` | Metadata classification, topic extraction, link resolution, external refs, frontmatter | `EnrichmentModule`, types |
| summarize | `src/summarize/` | URL and transcription summarization, standalone summary notes, audio-embed summarization | `SummarizeModule`, types |
| tidy | `src/tidy/` | Spelling correction and markdown formatting via AI | `TidyModule`, `TidySnapshot` |
| organize | `src/organize/` | AI-powered semantic directory structuring for notes | `OrganizeModule`, types |
| deep-dive | `src/deep-dive/` | Recursive topic extraction and child note generation | `DeepDiveModule`, types |
| title | `src/title/` | AI title suggestions for untitled/mismatched notes | `TitleModule`, types |
| shared | `src/shared/` | AI client (multi-modal), file utils, validation, notifications, callouts, frontmatter, checkpoints, credential metadata + validation | `AIClient`, `NotificationManager`, `CheckpointManager`, `validateCredentials`, `PROVIDER_METADATA`, `decorateCredentialField`, file/validation utils, callout registry, id-utils |
| views | `src/views/` | Unified sidebar for all proposal types and checkpoint management | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE`, `UnifiedItem` |

## Dependency Graph

```
main.ts
  |-- settings.ts  (type-only import of views/types for ProposalKind; no runtime cycle)
  |-- settings-tab.ts
  |-- commands/   (depends on NOTHING in src/ — never in a cycle)
  |-- shared/     (base layer: depends on NO feature module; owns url-detector)
  |-- pipeline/ --> commands/ (isPipelineKeyInFlow); modules injected via PipelineModuleMap
  |-- views/unified-proposal-view.ts --> elaboration/types, enrichment/types, organize/types, deep-dive/types, title/types, rem/types, shared/checkpoint-types
  |-- elaboration/ --> shared/, commands/, image/ (ImageAnalyzer uses shared AIClient + image/preprocessImage)
  |-- audio/ --> shared/, commands/
  |-- video/ --> shared/ (CheckpointManager, url-detector), commands/, audio/ (reuses transcription pipeline)
  |-- image/ --> shared/ (CheckpointManager, AIClient, callouts, validation), commands/
  |-- transcription/ --> audio/ (types), video/ (types), image/ (types), shared/ (detectPlatform, TimeRange, validation)
  |-- enrichment/ --> shared/, commands/
  |-- summarize/ --> shared/ (incl. isSupportedUrl/detectPlatform), commands/, audio/ (findAudioEmbeds); video.transcribeUrl injected at runtime (NO static video import edge)
  |-- tidy/ --> shared/, commands/
  |-- organize/ --> shared/, commands/
  |-- deep-dive/ --> shared/, commands/, organize/ (ContentAnalyzer, DirectoryMatcher)
  |-- title/ --> shared/
  |-- rem/ --> shared/, commands/
  +-- intake/ --> shared/ ONLY (cross-module work via injected IntakeDeps.fireOnFile)
```

Key constraints:
- ACYCLIC. `shared` and `commands` are base layers depending on no feature module. The former
  `shared ⇄ video` cycle was eliminated by moving `url-detector.ts` into `shared`; the edge is now
  one-directional `video → shared` (correct layering).
- `commands` imports nothing in `src/`; `pipeline` imports `commands` but never the feature modules
  (they are injected via `PipelineModuleMap` in main.ts).
- `intake` imports only `obsidian` + `src/shared/*`; all cross-module work goes through `IntakeDeps`.
- `video` depends on `audio` (reuses transcription pipeline)
- `transcription` is UI-only; delegates work to `audio`, `video`, and `image` modules
- `summarize` has NO static import of `video`; URL-platform helpers (`isSupportedUrl`/`detectPlatform`) resolve from `shared/url-detector`. It receives `video.transcribeUrl` and an audio transcribe callback via constructor injection
- `deep-dive` reuses `organize` for auto-organize nesting mode
- `image` module uses multi-modal `AIClient.chat()` with `ContentBlock[]` for vision
- `elaboration` module includes `ImageAnalyzer` for analyzing images in notes during proposal generation
- All feature modules depend on `shared`; no circular dependencies
- Modules with resumable scans (elaboration, enrichment, audio, video, image, summarize, organize, deep-dive, rem) receive `CheckpointManager`; `tidy`, `title`, `transcription`, `intake` do not
- `views` imports types only from feature modules (incl. `rem`) and `Checkpoint` from shared

## Command Registry

Source of truth: `src/commands/registry.ts` (mirrored here). 23 registry entries + 1 synthetic pipeline-only entry. Only `status: active` entries register/run; 6 ship `disabled` as a developer master switch (gated out of registration). Flows: `p`=palette, `f`=fire-synapse, `s`=startup. `pipelineKey` links an entry to a Fire Synapse phase.

| ID | Name | Type | Module | Flows | Status | pipelineKey |
|----|------|------|--------|-------|--------|-------------|
| `synapse:review-proposals` | Open proposal review sidebar | callback | main | p | active | |
| `synapse:manage-checkpoints` | Manage interrupted operations | callback | main | p | active | |
| `synapse:transcribe-media` | Transcribe media | callback | main | p | disabled | |
| `synapse:transcribe-note-media` | Transcribe media from current note | editorCallback | main | p | active | |
| `synapse:fire` | Fire Synapse: run all features on a directory | callback | main | p | active | |
| `synapse:scan-vault` | Scan vault for stub notes | callback | elaboration | p, f, s | active | elaboration |
| `synapse:scan-current-note` | Scan current note for elaboration | editorCallback | elaboration | p | active | |
| `synapse:clear-proposals` | Clear all pending proposals | callback | elaboration | p | disabled | |
| `synapse:enrich-current-note` | Enrich current note | editorCallback | enrichment | p | active | |
| `synapse:scan-vault-enrichment` | Scan vault for enrichment | callback | enrichment | p, f | active | enrichment |
| `synapse:undo-enrichment` | Undo last enrichment on current note | editorCallback | enrichment | p | disabled | |
| `synapse:organize-current-note` | Organize current note | editorCallback | organize | p | active | |
| `synapse:scan-directory-organize` | Scan directory for organization | callback | organize | p, f | active | organize |
| `synapse:undo-organize` | Undo last organize on current note | editorCallback | organize | p | disabled | |
| `synapse:deep-dive` | Deep dive into current note | editorCallback | deep-dive | p | active | |
| `synapse:clear-deep-dive` | Clear deep dive proposals | callback | deep-dive | p | disabled | |
| `synapse:summarize-current-note` | Summarize current note | editorCallback | summarize | p | active | |
| `synapse:scan-vault-summarize` | Scan vault for notes to summarize | callback | summarize | p, f | active | summarize |
| `synapse:tidy-current-note` | Tidy current note | editorCallback | tidy | p | active | |
| `synapse:undo-tidy` | Undo last tidy on current note | editorCallback | tidy | p | disabled | |
| `synapse:rem-current-note` | REM: Discover links in current note | editorCallback | rem | p | active | |
| `synapse:rem-directory` | REM: Discover links in directory | callback | rem | p, f | active | rem |
| `synapse:check-dependencies` | Check external tool availability | callback | video | p | active | |
| `synapse:tidy-vault` | Tidy vault (Fire Synapse) | (synthetic) | tidy | f | active | tidy |

`synapse:tidy-vault` is synthetic and pipeline-only: it gates the tidy Fire Synapse phase independently of any palette command and is never passed to `registrar.register()`. Fire Synapse phase order: elaboration → summarize → enrichment → rem → tidy → organize.

## Ribbon Icons

| Icon | Label | Action |
|------|-------|--------|
| `sparkles` | Review proposals | Opens unified proposal sidebar |
| `mic` | Transcribe media | Opens unified transcription modal (desktop only) |

## View Types

| View Type ID | Class | Location |
|--------------|-------|----------|
| `synapse-proposals` | `UnifiedProposalView` | `src/views/unified-proposal-view.ts` |

Legacy views (`ProposalReviewView`, `EnrichmentReviewView`) exist in source but are not registered.

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
  ai: AISettings {
    provider: 'openai' | 'anthropic' | 'gemini' | 'ollama'   // AIProvider, default: 'openai'
    apiKey: string                                  // default: ''
    ollamaEndpoint: string                          // default: 'http://localhost:11434'
    model: string                                   // default: 'gpt-4o' (dropdown values per provider in MODEL_OPTIONS)
    maxTokens: number                               // default: 2048
    temperature: number                             // default: 0.7
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
      excludeFolders: string[]                      // default: ['templates', '.synapse']
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
    postProcessing: PostProcessingSettings {
      enabled: boolean                              // default: true
      removeFiller: boolean                         // default: true
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
    excludeFolders: string[]                        // default: ['templates', '.synapse']
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
    excludeFolders: string[]                        // default: ['templates', '.synapse']
    excludeTags: string[]                           // default: ['no-summarize']
    autoOrganizeOnSummarize: boolean                // default: false
  }
  tidy: TidySettings {
    enabled: boolean                                // default: true
    snapshotFolderPath: string                      // default: '.synapse/tidy-snapshots'
  }
  organize: OrganizeSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/organize/proposals'
    snapshotFolderPath: string                      // default: '.synapse/organize/snapshots'
    excludeFolders: string[]                        // default: ['templates', '.synapse']
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
    nestingMode: 'nested' | 'flat' | 'auto-organize'  // default: 'nested'
    excludeFolders: string[]                        // default: ['templates', '.synapse']
    excludeTags: string[]                           // default: ['no-deep-dive']
    autoEnrichOnAccept: boolean                     // default: true
    autoOrganizeOnAccept: boolean                   // default: false
  }
  title: TitleSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.synapse/title-proposals'
    checkAfterOperations: boolean                   // default: true
  }
  rem: RemSettings {
    enabled: boolean                                // default: true
    semanticMatching: boolean                       // default: false (AI conceptual matches)
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
  }
  ui: UISettings {
    collapsedSections: Record<string, boolean>      // default: {} (settings accordion state)
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
}
```

Provider model dropdowns: `MODEL_OPTIONS: Record<AIProvider, Record<id, label>>` in `src/settings.ts`.
openai: gpt-4o, gpt-4o-mini, o3, o3-mini, o4-mini. anthropic: opus, sonnet, haiku (resolved to full
IDs in `ai-client.ts`). gemini: gemini-3.5-flash, gemini-3.1-flash-lite, gemini-2.5-pro, gemini-2.5-flash.
ollama: llama3, mistral, codellama, gemma.

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
| Temp video/audio | `.synapse/temp/` | Binary (auto-cleaned) |
| Downloaded videos | `Media/` (configurable) | Video files |

## Cross-Module Callbacks (wired in main.ts)

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

elaboration.onViewRefreshNeeded()        --> main.refreshUnifiedView()
enrichment.onViewRefreshNeeded()         --> main.refreshUnifiedView()
organize.onViewRefreshNeeded()           --> main.refreshUnifiedView()
deepDive.onViewRefreshNeeded()           --> main.refreshUnifiedView()
title.onViewRefreshNeeded()              --> main.refreshUnifiedView()
rem.onViewRefreshNeeded()                --> main.refreshUnifiedView()

// Intake (IntakeDeps injected into IntakeModule)
intake.deps.fireOnFile(file)             --> SynapseRunner.fireOnFile(file)   // whole pipeline on one note
intake.deps.transcribeUrlToNote(...)     --> STUB (#112), no-op notice

// Per-proposal-type auto-accept (#228): each module gets a live getter
<module>.shouldAutoAccept()              --> () => settings.autoAccept[kind]
```

Enrichment callbacks wired when `enrichment.enabled && enrichment.autoEnrich`.
Deep-dive enrichment wired when `deepDive.autoEnrichOnAccept`.
Deep-dive organize wired when `deepDive.autoOrganizeOnAccept && organize.enabled`.
Summarize organize wired when `summarize.autoOrganizeOnSummarize && organize.enabled`.
Title checks wired when `title.enabled && title.checkAfterOperations`.
Auto-accept getters wired for elaboration, enrichment, organize, deep-dive, title, rem (default `false`).

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
  |-- On startup (3s delay): main.checkForIncompleteCheckpoints()
  |     Lists active checkpoints, offers Resume/Review/Dismiss
  |
  |-- synapse:manage-checkpoints command: iterates incomplete checkpoints
  |     Per checkpoint: Resume / Discard / Keep
  |
  |-- UnifiedProposalView: shows checkpoint banner with Resume/Discard buttons
  |-- main.resumeCheckpoint(id): dispatches to module.resumeFromCheckpoint()
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

Framework: Vitest, globals enabled, node environment.

## Security Notes

- URLs validated via `sanitizeUrl()` before external tool invocation
- Paths validated via `sanitizePath()` (rejects `..`, null bytes, shell metacharacters)
- AI output sanitized via `sanitizeAIResponse()` before vault writes
- Secret redaction centralized in `shared/redact.ts` (`redactSecrets`); both `ai-client.ts` (upstream error bodies) and `api-utils.ts:notifyError` (user/console errors) route through it — single source of truth, re-exported from `ai-client` and the `shared` barrel. Covers `sk-`/`sk-ant-`, `key-`, Deepgram `dg-`, `Bearer `/`Token ` headers, `anthropic-`, and Google `AIza` keys
- Credential validation (`shared/credential-validator.ts`, `validateCredentials`) probes each provider with a single minimal GET (probe specs in `shared/provider-metadata.ts`); every result message routes through `redactSecrets`, so a key echoed in a 401/400 body cannot reach the status chip. One-shot (no retry), 10s timeout, `throw:false`. Validation state is ephemeral (never persisted to settings)
- Multipart transcription bodies (`audio/transcriber.ts:buildMultipartBody`) sanitize vault-/settings-derived field names and file names via `sanitizeMultipartHeaderValue` (strips CR/LF, replaces `"`/`\` with `_`) to block `Content-Disposition` header / multipart injection
- Gemini audio transcription places its instruction in `system_instruction` (not the user turn beside the audio) so speech inside untrusted audio cannot override the prompt (prompt-injection hardening)
- Ollama endpoint: HTTPS required (HTTP for localhost only)
- External commands use `execFile` with argument arrays (no shell interpolation)
- Frontmatter keys validated against allowlist pattern + forbidden keys blocklist
- Enrichment sections use `%% synapse-enrichment-start/end %%` markers for idempotent updates
- Checkpoint IDs validated against `/^[a-z0-9]+$/` to prevent path traversal
- Deep merge in settings rejects `__proto__`, `constructor`, `prototype` keys
