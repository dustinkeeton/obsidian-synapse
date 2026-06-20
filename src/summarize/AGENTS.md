---
last-updated: 2026-06-19
---

# Summarize Module

Summarizes URLs, transcription blocks, and audio embeds found in notes. Creates inline summary callouts or standalone summary notes for enrichment-section links. Auto-transcribes video URLs and audio embeds via injected callbacks.

## Public API (`index.ts`)

```ts
class SummarizeModule {
  onSummaryComplete: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null

  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar,
    transcribeUrl?: TranscribeUrlFn,
    transcribeAudio?: TranscribeAudioFn,
    transcribeAudioCombined?: TranscribeAudioCombinedFn
  )
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<void>
}

// Injected callback: transcribes a video URL (from VideoModule)
type TranscribeUrlFn = (
  url: string,
  parentOp?: { update: (msg: string) => void }
) => Promise<string>

// Injected callback: transcribes a single audio TFile (from AudioModule)
type TranscribeAudioFn = (file: TFile) => Promise<string>

// Injected callback: transcribes multiple audio TFiles as one combined recording (#214)
type TranscribeAudioCombinedFn = (files: TFile[]) => Promise<string>
```

Exported types: `SummarizeTarget`, `TranscribeUrlFn`, `TranscribeAudioFn`, `TranscribeAudioCombinedFn`

Exported functions: `renderSummarizeSettings(ctx: SettingsSectionContext): void`

## Internal File Map

| File | Class/Export | Role |
|------|-------------|------|
| `index.ts` | `SummarizeModule`, type + fn re-exports | Orchestrator, commands, scan + summarize flows |
| `types.ts` | `SummarizeTarget` | Target type model |
| `summarizer.ts` | `Summarizer` | AI summarization with style (bullets/paragraph/key-points) |
| `note-scanner.ts` | `findSummarizeTargets`, `hasSummaryBelow` | Finds URLs, transcription blocks in note content |
| `summarize-modal.ts` | `SummarizeSelectionModal` | Selection modal when multiple targets found; offers combine option for 2+ audio targets |
| `settings-section.ts` | `renderSummarizeSettings` | Summarize settings UI section |
| `summarizer.test.ts` | Tests | Summarizer tests |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `summarize-module.test.ts` | Tests | SummarizeModule integration tests |
| `audio-summarize.test.ts` | Tests | Audio-embed summarization tests |
| `combine-summarize.test.ts` | Tests | Combined-audio summarization tests (#214) |

## Target Types (`types.ts`)

```ts
interface SummarizeTarget {
  type: 'url' | 'transcription' | 'audio'
  source: string          // URL or audio filename or transcription source label
  line: number            // zero-based line number in note
  endLine: number         // end of target block (for transcriptions)
  content?: string        // pre-extracted content (for transcription blocks)
  inEnrichmentSection?: boolean  // found inside enrichment markers
  linkTitle?: string      // display text from markdown link (enrichment refs)
}
```

## Data Flow

```
summarizeNote(file)
  --> collectTargets(content, sourcePath)
        findSummarizeTargets(content)    [URLs, transcription blocks]
        findAudioEmbeds(content, ...)    [audio embeds without existing summary below]
  --> if 1 target: processTargets(file, targets, content)
  --> if 2+ targets: SummarizeSelectionModal
        if combine + 2+ audio: processTargetsCombined(file, selected, content)
        else: processTargets(file, selected, content)

processFileTargets(file, targets, op, content)
  For each target (reverse line order):
    if inEnrichmentSection + linkTitle:
      --> fetchContentForUrl(url)  [video transcription or HTTP fetch]
      --> Summarizer.summarize(content, url, style, COMPREHENSIVE_SUMMARY_PROMPT)
      --> pendingNotes.push(path, content)
      --> replace external link with [[internal link]] in lines[]
    elif target.type === 'audio':
      --> fetchContentForAudio(fileName, sourceFile)  [transcribeAudio callback]
      --> Summarizer.summarize(transcript, source, style, effectivePrompt)
      --> lines.splice(endLine+1, callout)
    else (inline URL / transcription):
      --> fetchContentForUrl(url) or use target.content
      --> effectivePrompt: customPrompt > detectSchemaFor('summary', content) > style default
      --> Summarizer.summarize(content, url, style, effectivePrompt)
      --> lines.splice(endLine+1, callout)
  --> vault.process(file, () => lines.join('\n'))   [source written FIRST]
  --> vault.create() for each pendingNote            [new notes AFTER source]
  --> onSummaryComplete?.(filePath)
  --> onOrganizeRequested?.(file)  [if autoOrganizeOnSummarize]

processTargetsCombined(file, targets, content)   [#214]
  --> otherTargets processed via processFileTargets first
  --> transcribeAudioCombined(audioFiles) --> combined transcript
  --> Summarizer.summarize(transcript, ..., COMPREHENSIVE_SUMMARY_PROMPT)
  --> vault.process(file, insert combined callout after last audio embed)
  --> onSummaryComplete?.(file.path)
```

## Vault Scan (checkpointed)

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: collect files with targets (cancellable scan)
  Phase 2: user confirmation (skipped when skipConfirmation=true)
  Phase 3: checkpointed processing
    --> checkpointManager.create(module: 'summarize', items)
    --> addDeferredTask('refresh-sidebar-view')
    --> for each file: re-read + re-scan + processFileTargets(), completeItem()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatchDeferredTasks

resumeFromCheckpoint(checkpoint)
  --> re-processes remaining items from saved checkpoint
  --> completeItem() after each file
  --> on cancel: discard()
  --> on success: complete(), dispatchDeferredTasks
```

## Commands

Registered in `onload()` (both gated by `summarize.enabled`):

| ID | Name | Type |
|----|------|------|
| `synapse:summarize-current-note` | Summarize current note | editorCallback |
| `synapse:scan-vault-summarize` | Scan vault for notes to summarize | callback (FolderPickerModal) |

## Video URL Auto-Transcription

`transcribeUrl` is injected by `main.ts` from `VideoModule.transcribeUrl`. When set:
- `fetchContentForUrl()` calls `isSupportedUrl(url)` (from `shared`) before deciding
- If supported video URL: calls injected `transcribeUrl` callback
- Falls back to `fetchTweetContent()` for Twitter URLs, then `fetchPageContent()` for others

`isSupportedUrl` and `detectPlatform` both resolve from `shared` barrel. There is NO static import of `video/` anywhere in this module.

## Combined Audio (#214)

When `transcribeAudioCombined` is injected and 2+ audio targets are selected via the modal:
- `processTargetsCombined()` resolves all audio `TFile` objects via `MetadataCache`
- Calls `transcribeAudioCombined(files)` for one transcript spanning all files
- Inserts a single `Combined summary (N files)` callout after the last audio embed
- Insert line is re-derived from fresh content inside `vault.process()` callback (safe against phase-1 line shifts)

Injected in `main.ts`:
```ts
this.summarize = new SummarizeModule(
  this, getSettings, this.notifications, this.checkpointManager, this.registrar,
  (url, parentOp) => this.video.transcribeUrl(url, parentOp),
  async (audioFile) => {
    const data = await this.app.vault.readBinary(audioFile);
    const result = await this.audio.transcribe(data, audioFile.name);
    return result.processed || result.raw;
  },
  (files) => this.audio.transcribeCombined(files)
);
```

## Settings Keys

All under `settings.summarize` (`SummarizeSettings`):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module + command activation |
| `maxContentLength` | `number` | — | Truncation limit for fetched content |
| `summaryStyle` | `'bullets' \| 'paragraph' \| 'key-points'` | — | AI output style |
| `customPrompt` | `string` | `''` | Overrides style-based prompt (highest priority) |
| `autoDetectTemplates` | `boolean` | `true` | Enable content-schema detection |
| `excludeTags` | `string[]` | `['no-summarize']` | Skip notes with these tags |
| `autoOrganizeOnSummarize` | `boolean` | — | Trigger organize after single-note summarize |

Path exclusion: centralized `settings.exclusions: ExclusionRule[]` (#307). No per-module `excludeFolders` field. Checked via `isPathExcluded(path, 'summarize', settings)` from `shared`.

## Content-Aware Schemas

Registry: `shared/content-schemas.ts`. Called via `detectSchemaFor('summary', content)`.

Priority chain for inline targets: `customPrompt` > schema match > style default.
Enrichment targets always use `COMPREHENSIVE_SUMMARY_PROMPT` regardless.

| ID | Detection | Stage |
|----|-----------|-------|
| `recipe` | Keyword scoring >= 5 (headers, cooking verbs, measurements) | `'summary'` |
| `receipt` | Keyword scoring >= 5 (currency, totals, payment terms) | `'summary'` |

## Dependencies

| Import | From |
|--------|------|
| `FolderPickerModal`, `getMarkdownFiles`, `NotificationManager`, `OperationHandle`, `buildCallout`, `CALLOUT_TYPES`, `CheckpointManager`, `generateId`, `fireAndForget`, `isPathExcluded`, `matchesExcludeTag`, `detectSchemaFor`, `isSupportedUrl`, `detectPlatform`, `fetchPageContent`, `fetchTweetContent` | `../shared` |
| `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` | `../shared` (type-only) |
| `findAudioEmbeds` | `../audio` |
| `CommandRegistrar` | `../commands` |
| `SynapseSettings`, `SummarizeSettings` | `../settings` |

NO static import of `../video`. Video transcription is callback-only (`TranscribeUrlFn`).
