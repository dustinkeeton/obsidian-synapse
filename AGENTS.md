---
last-updated: 2026-03-16
---

# Auto Notes -- Agent Entry Point

AI-powered Obsidian plugin: stub note elaboration, audio/video transcription, note enrichment (tags, links, references), summarization, note tidying, semantic organization, and recursive deep dive note generation.

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
| main | `src/main.ts` | Plugin entry, module orchestration, view registration | `AutoNotesPlugin` (default) |
| settings | `src/settings.ts` | Settings interfaces, defaults, model options | `AutoNotesSettings`, `DEFAULT_SETTINGS`, `AIProvider`, `MODEL_OPTIONS`, `TagVocabularyEntry` |
| settings-tab | `src/settings-tab.ts` | Obsidian settings UI | `AutoNotesSettingTab` |
| elaboration | `src/elaboration/` | Stub note detection, AI proposal generation | `ElaborationModule`, types |
| audio | `src/audio/` | Audio transcription (Whisper, Deepgram, local), post-processing | `AudioModule`, `AudioTranscriptionModal`, types |
| video | `src/video/` | Video download (YouTube/TikTok), audio extraction, transcription | `VideoModule`, `detectPlatform`, `isSupportedUrl`, types |
| enrichment | `src/enrichment/` | Metadata classification, topic extraction, link resolution, external refs, frontmatter | `EnrichmentModule`, types |
| summarize | `src/summarize/` | URL and transcription summarization, standalone summary notes | `SummarizeModule`, types |
| tidy | `src/tidy/` | Spelling correction and markdown formatting via AI | `TidyModule`, `TidySnapshot` |
| organize | `src/organize/` | AI-powered semantic directory structuring for notes | `OrganizeModule`, types |
| deep-dive | `src/deep-dive/` | Recursive topic extraction and child note generation | `DeepDiveModule`, types |
| shared | `src/shared/` | AI client, file utils, validation, notifications, frontmatter | `AIClient`, `NotificationManager`, file/validation utils |
| views | `src/views/` | Unified sidebar for all proposal types | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE`, `UnifiedItem` |

## Dependency Graph

```
main.ts
  |-- settings.ts
  |-- settings-tab.ts
  |-- shared/
  |-- views/unified-proposal-view.ts --> elaboration/types, enrichment/types, organize/types, deep-dive/types
  |-- elaboration/ --> shared/
  |-- audio/ --> shared/
  |-- video/ --> shared/, audio/
  |-- enrichment/ --> shared/
  |-- summarize/ --> shared/
  |-- tidy/ --> shared/
  |-- organize/ --> shared/
  +-- deep-dive/ --> shared/
```

Key constraints:
- `video` depends on `audio` (reuses transcription pipeline)
- All feature modules depend on `shared`
- No circular dependencies
- `views` imports types only from feature modules

## Command Registry

| ID | Name | Type | Module |
|----|------|------|--------|
| `auto-notes:review-proposals` | Open proposal review sidebar | callback | main |
| `auto-notes:scan-vault` | Scan vault for stub notes | callback | elaboration |
| `auto-notes:scan-current-note` | Scan current note for elaboration | editorCallback | elaboration |
| `auto-notes:clear-proposals` | Clear all pending proposals | callback | elaboration |
| `auto-notes:transcribe-audio` | Transcribe audio file | callback | audio |
| `auto-notes:transcribe-note-audio` | Transcribe audio from current note | editorCallback | audio |
| `auto-notes:transcribe-video-url` | Transcribe video from URL | callback | video |
| `auto-notes:transcribe-note-video` | Transcribe video URLs from current note | editorCallback | video |
| `auto-notes:transcribe-video-file` | Transcribe local video file | callback (stub) | video |
| `auto-notes:check-dependencies` | Check external tool availability | callback | video |
| `auto-notes:enrich-current-note` | Enrich current note | editorCallback | enrichment |
| `auto-notes:scan-vault-enrichment` | Scan vault for enrichment | callback | enrichment |
| `auto-notes:undo-enrichment` | Undo last enrichment on current note | editorCallback | enrichment |
| `auto-notes:summarize-current-note` | Summarize current note | editorCallback | summarize |
| `auto-notes:scan-vault-summarize` | Scan vault for notes to summarize | callback | summarize |
| `auto-notes:tidy-current-note` | Tidy current note | editorCallback | tidy |
| `auto-notes:undo-tidy` | Undo last tidy on current note | editorCallback | tidy |
| `auto-notes:organize-current-note` | Organize current note | editorCallback | organize |
| `auto-notes:scan-directory-organize` | Scan directory for organization | callback | organize |
| `auto-notes:undo-organize` | Undo last organize on current note | editorCallback | organize |
| `auto-notes:deep-dive` | Deep dive into current note | editorCallback | deep-dive |
| `auto-notes:clear-deep-dive` | Clear deep dive proposals | callback | deep-dive |

## Ribbon Icons

| Icon | Label | Action |
|------|-------|--------|
| `sparkles` | Review proposals | Opens unified proposal sidebar |
| `mic` | Transcribe audio | Opens audio transcription modal |

## View Types

| View Type ID | Class | Location | Status |
|--------------|-------|----------|--------|
| `auto-notes-proposals` | `UnifiedProposalView` | `src/views/unified-proposal-view.ts` | Active (registered by main.ts) |
| `auto-notes-proposal-review` | `ProposalReviewView` | `src/elaboration/proposal-view.ts` | Legacy (not registered) |
| `auto-notes-enrichment-review` | `EnrichmentReviewView` | `src/enrichment/enrichment-view.ts` | Legacy (not registered) |

## Settings Schema

```ts
AutoNotesSettings {
  ai: AISettings {
    provider: 'openai' | 'anthropic' | 'ollama'   // default: 'openai'
    apiKey: string                                  // default: ''
    ollamaEndpoint: string                          // default: 'http://localhost:11434'
    model: string                                   // default: 'gpt-4o'
    maxTokens: number                               // default: 2048
    temperature: number                             // default: 0.7
  }
  elaboration: ElaborationSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.auto-notes/proposals'
    scanOnStartup: boolean                          // default: false
    autoScanInterval: number                        // default: 0 (disabled, minutes)
    detection: DetectionSettings {
      minWordThreshold: number                      // default: 50
      detectTodoMarkers: boolean                    // default: true
      detectEmptySections: boolean                  // default: true
      detectSparseLinks: boolean                    // default: true
      excludeFolders: string[]                      // default: ['templates', '.auto-notes']
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
    transcriptionProvider: 'whisper-api' | 'deepgram' | 'local-whisper'
    whisperApiKey: string                           // default: '' (fallback: ai.apiKey)
    deepgramApiKey: string                          // default: ''
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
    tempFolder: string                              // default: '.auto-notes/temp'
    downloadFolder: string                          // default: 'Media'
    embedInNote: boolean                            // default: true
    supportedPlatforms: { youtube: boolean, tiktok: boolean }
    frameExtraction: FrameExtractionSettings {
      enabled: boolean                              // default: false
      intervalSeconds: number                       // default: 30
      visionModel: string                           // default: 'gpt-4o'
      maxFrames: number                             // default: 20
    }
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
    weights: EnrichmentWeightSettings {
      sameFolder: number                            // default: 1.0
      siblingFolder: number                         // default: 0.8
      cousinFolder: number                          // default: 0.5
      distantFolder: number                         // default: 0.2
      decayPerLevel: number                         // default: 0.15
      minWeight: number                             // default: 0.1
    }
    enrichmentFolderPath: string                    // default: '.auto-notes/enrichments'
    excludeFolders: string[]                        // default: ['templates', '.auto-notes']
    excludeTags: string[]                           // default: ['no-enrich']
    relatedNotesHeading: string                     // default: 'Related Notes'
    referencesHeading: string                       // default: 'References'
  }
  summarize: SummarizeSettings {
    enabled: boolean                                // default: true
    maxContentLength: number                        // default: 4000
    summaryStyle: 'bullets' | 'paragraph' | 'key-points'  // default: 'bullets'
    customPrompt: string                            // default: ''
    excludeFolders: string[]                        // default: ['templates', '.auto-notes']
    excludeTags: string[]                           // default: ['no-summarize']
  }
  tidy: TidySettings {
    enabled: boolean                                // default: true
    snapshotFolderPath: string                      // default: '.auto-notes/tidy-snapshots'
  }
  organize: OrganizeSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.auto-notes/organize/proposals'
    snapshotFolderPath: string                      // default: '.auto-notes/organize/snapshots'
    excludeFolders: string[]                        // default: ['templates', '.auto-notes']
    excludeTags: string[]                           // default: ['no-organize']
  }
  deepDive: DeepDiveSettings {
    enabled: boolean                                // default: true
    proposalFolderPath: string                      // default: '.auto-notes/deep-dive'
    maxDepth: number                                // default: 3
    qualityThreshold: number                        // default: 0.4
    maxNotesPerRun: number                          // default: 50
    noteOutputFolder: string                        // default: '' (same as source)
    excludeFolders: string[]                        // default: ['templates', '.auto-notes']
    excludeTags: string[]                           // default: ['no-deep-dive']
    autoEnrichOnAccept: boolean                     // default: true
    autoOrganizeOnAccept: boolean                   // default: false
  }
}
```

## Data Storage

| Purpose | Path | Format |
|---------|------|--------|
| Elaboration proposals | `.auto-notes/proposals/*.json` | `Proposal` JSON |
| Enrichment proposals | `.auto-notes/enrichments/*.json` | `EnrichmentProposal` JSON |
| Tidy snapshots | `.auto-notes/tidy-snapshots/*.json` | `TidySnapshot` JSON |
| Organize proposals | `.auto-notes/organize/proposals/*.json` | `OrganizeProposal` JSON |
| Organize snapshots | `.auto-notes/organize/snapshots/*.json` | `OrganizeSnapshot` JSON |
| Deep dive proposals | `.auto-notes/deep-dive/*.json` | `DeepDiveProposal` JSON |
| Deep dive runs | `.auto-notes/deep-dive/runs/*.json` | `DeepDiveRun` JSON |
| Temp video/audio | `.auto-notes/temp/` | Binary (auto-cleaned) |
| Downloaded videos | `Media/` (configurable) | Video files |

## Cross-Module Callbacks (wired in main.ts)

```
elaboration.onProposalAccepted(filePath) --> enrichment.enrich(filePath, 'elaboration')
audio.onTranscriptionComplete(filePath)  --> enrichment.enrich(filePath, 'transcription')
video.onTranscriptionComplete(filePath)  --> enrichment.enrich(filePath, 'transcription')
summarize.onSummaryComplete(filePath)    --> enrichment.enrich(filePath, 'summarization')
deepDive.onNoteAccepted(filePath)        --> enrichment.enrich(filePath, 'deep-dive')
deepDive.onOrganizeRequested(file)       --> organize.organizeNote(file)

elaboration.onViewRefreshNeeded()        --> main.refreshUnifiedView()
enrichment.onViewRefreshNeeded()         --> main.refreshUnifiedView()
organize.onViewRefreshNeeded()           --> main.refreshUnifiedView()
deepDive.onViewRefreshNeeded()           --> main.refreshUnifiedView()
```

Enrichment callbacks wired when `enrichment.enabled && enrichment.autoEnrich`.
Deep-dive enrichment callback wired when `deepDive.autoEnrichOnAccept`.
Deep-dive organize callback wired when `deepDive.autoOrganizeOnAccept && organize.enabled`.

## External Dependencies (Runtime)

| Tool | Required By | Detection |
|------|-------------|-----------|
| yt-dlp | video module | `auto-notes:check-dependencies` command |
| ffmpeg | video module | `auto-notes:check-dependencies` command |

No npm runtime dependencies. Uses Obsidian `requestUrl`, `execFile` (argument arrays, no shell), and browser `fetch`.

## Test Infrastructure

| Component | Path |
|-----------|------|
| Config | `vitest.config.ts` |
| Setup | `src/__test-utils__/setup.ts` |
| Obsidian mock | `src/__mocks__/obsidian.ts` |
| Mock factories | `src/__test-utils__/mock-factories.ts` |
| Test files | `src/**/*.test.ts` |

Framework: Vitest 4.x, globals enabled, node environment.

## Security Notes

- URLs validated via `sanitizeUrl()` before external tool invocation
- Paths validated via `sanitizePath()` (rejects `..`, null bytes, shell metacharacters)
- AI output sanitized via `sanitizeAIResponse()` before vault writes
- API keys redacted from all error messages
- Ollama endpoint: HTTPS required (HTTP for localhost only)
- External commands use `execFile` with argument arrays (no shell interpolation)
- Frontmatter keys validated against allowlist pattern + forbidden keys blocklist
- Enrichment sections use `%% auto-notes-enrichment-start/end %%` markers for idempotent updates
