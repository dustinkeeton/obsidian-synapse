---
last-updated: 2026-06-25
---

# Summarize Module

Summarizes a note's own prose plus the URLs, transcription blocks, and audio embeds it references, emitting either per-item summary callouts or one combined summary, and creating standalone notes for enrichment-section links. Video URLs and audio embeds are transcribed via injected callbacks (no static `video/` import).

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
    transcribeAudio?: TranscribeAudioFn
  )
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<void>
}

// Injected callback: transcribes a video URL (from VideoModule).
type TranscribeUrlFn = (
  url: string,
  parentOp?: { update: (msg: string) => void }
) => Promise<string>

// Injected callback: transcribes a single audio TFile (from AudioModule).
type TranscribeAudioFn = (file: TFile) => Promise<string>
```

Exported types: `SummarizeTarget` (re-export of `./types`), `TranscribeUrlFn`, `TranscribeAudioFn`.
Exported functions: `renderSummarizeSettings(ctx: SettingsSectionContext): void` (re-export of `./settings-section`).

## Internal File Map

| File | Class/Export | Role |
|------|-------------|------|
| `index.ts` | `SummarizeModule`, type + fn re-exports | Orchestrator, commands, scan + summarize flows |
| `types.ts` | `SummarizeTarget` | Target type model |
| `summarizer.ts` | `Summarizer` | AI summarization with style (bullets/paragraph/key-points) |
| `note-scanner.ts` | `findSummarizeTargets`, `hasSummaryBelow`, `extractNoteProse`, `extractTranscriptionContent` | Pure-string scan for URLs / transcription blocks; note-prose extraction |
| `summarize-modal.ts` | `SummarizeSelectionModal`, `SummarizeModalDefaults` | Selection modal for 2+ targets; include-note + combine toggles (#367) |
| `settings-section.ts` | `renderSummarizeSettings` | Summarize settings UI section (#243) |
| `summarizer.test.ts` | Tests | Summarizer style/prompt tests |
| `note-scanner.test.ts` | Tests | Scanner + prose-extraction tests |
| `summarize-module.test.ts` | Tests | SummarizeModule integration tests |
| `audio-summarize.test.ts` | Tests | Audio-embed summarization tests |
| `combine-summarize.test.ts` | Tests | Combined-summary tests (#367) |
| `summarize-modal.test.ts` | Tests | Selection-modal tests |
| `settings-section.test.ts` | Tests | Settings-section render tests |
| `video-dependency-notice.test.ts` | Tests | yt-dlp/ffmpeg onboarding-notice tests (#382) |

## Target Types (`types.ts`)

```ts
interface SummarizeTarget {
  type: 'url' | 'transcription' | 'audio' | 'note-content'
  source: string          // URL / transcription source label, or note basename for note-content
  line: number            // line in note (last line for note-content, so its callout appends)
  endLine: number         // end of target block (transcriptions / note-content)
  content?: string        // pre-extracted content (transcriptions and note-content prose)
  inEnrichmentSection?: boolean  // found inside enrichment markers
  linkTitle?: string      // display text from markdown link (enrichment refs)
}
```

## Data Flow

```
summarizeNote(file)                                   index.ts:L230
  --> collectTargets(content, sourcePath)             index.ts:L453
        findSummarizeTargets(content)    [URLs, transcription blocks]
        findAudioEmbeds(...)             [audio embeds w/o summary below]
        extractNoteProse(content)        [appends 'note-content' if includeNoteContent]
  --> 1 target:  processTargets(file, targets, content)            [per-item, no modal]
  --> 2+ targets: SummarizeSelectionModal(defaults={includeNoteContent, combineSummaries})
        callback(selected, combine):
          combine  -> processTargetsCombined(file, selected, content)   index.ts:L270
          !combine -> processTargets(file, selected, content)           index.ts:L502

processTargetsForFile(file, targets, op, content, combine)            index.ts:L301
  combine == false:
    --> processFileTargets(file, targets, op, content)
  combine == true:
    --> enrichment refs first (per-item):  processFileTargets(enrichmentTargets)
    --> everything else folded into ONE summary: combineSelectedTargets(summarizable)

combineSelectedTargets(file, targets, op, content)                    index.ts:L356
  per target: reuse note-content/transcript content, else fetch URL / transcribe audio
  --> join sections w/ '## <label>' + '---' separators, slice(maxContentLength)
  --> Summarizer.summarize(combinedText, labels, style, prompt)
        prompt = customPrompt > schema('summary') > COMPREHENSIVE_SUMMARY_PROMPT
  --> vault.process(file): append ONE 'Combined summary (N items)' callout at end

processFileTargets(file, targets, op, content)                        index.ts:L560
  for each target (reverse line order):
    enrichment ref (inEnrichmentSection + linkTitle):
      --> if note exists: rewrite link only (linksUpdated++)
      --> else fetch + summarize(COMPREHENSIVE_SUMMARY_PROMPT) -> pendingNote + link rewrite
    audio:        fetchContentForAudio() -> summarize -> splice inline callout
    transcription: reuse target.content -> summarize -> splice inline callout
    note-content:  reuse target.content -> summarize -> splice inline callout
    inline URL:    fetchUrlContentOrNotify() -> summarize -> splice inline callout
                   prompt = customPrompt > schema('summary') > style default
  --> vault.process(file, finalContent)   [source written FIRST]
  --> vault.create() per pendingNote      [new notes AFTER source]
  returns { inlineCompleted, enrichmentCompleted, linksUpdated, newNotePaths }

fireEnrichmentCallbacks(path, result)                                 index.ts:L543
  --> onSummaryComplete?.(path)  [only if inlineCompleted>0 and enrichmentCompleted==0]
  --> onSummaryComplete?.(newNotePath)  per created note
  caller separately: onOrganizeRequested?.(file) if autoOrganizeOnSummarize
```

## Vault Scan (checkpointed)

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)                  index.ts:L900
  Phase 1: collect files with targets (cancellable scan; onlyFile narrows scope, #111)
  Phase 2: user confirmation (skipped when skipConfirmation=true / Fire Synapse)
  Phase 3: checkpointed processing
    --> checkpointManager.create({ module: 'summarize', items })
    --> addDeferredTask('refresh-sidebar-view')
    --> per file: re-read + collectTargets + processTargetsForFile(..., combineSummaries)
    --> completeItem() after each file
    --> on cancel: discard(); on success: complete() + dispatchDeferredTasks

resumeFromCheckpoint(checkpoint)                                      index.ts:L169
  --> re-process remaining items via processTargetsForFile(..., combineSummaries)
  --> completeItem() per file; on cancel discard(); on success complete()
```

## Commands

Registered in `onload()`, both gated by `settings.summarize.enabled` (`commands/registry.ts:L46`):

| ID | Name | Type |
|----|------|------|
| `synapse:summarize-current-note` | Summarize current note | editorCallback |
| `synapse:scan-vault-summarize` | Scan folder for notes to summarize | callback (FolderPickerModal) |

## URL Fetch / Video Auto-Transcription (`fetchContentForUrl`, index.ts:L738)

Routing order for a target URL:
1. `transcribeUrl` injected AND `isSupportedUrl(url)` -> call `transcribeUrl(url, op)` (video transcript).
2. `detectPlatform(url)?.platform === 'twitter'` -> `fetchTweetContent(url, max)`.
3. `isRedditUrl(url)` -> `fetchRedditContent(url, max)` (Reddit is generic 'article'; routed explicitly to the RSS fetcher).
4. else -> `fetchPageContent(url, max)`.

`transcribeUrl`/`transcribeAudio` are injected by `main.ts:L128`. On mobile (no VideoModule) `transcribeUrl` throws "Video transcription is not available on mobile". `isSupportedUrl`, `detectPlatform`, `isRedditUrl` all resolve from the `shared` barrel; there is NO static import of `video/`.

## Combined Summaries (#367)

When `combineSummaries` (or the modal's "Combine into one summary" toggle) is set:
- Enrichment refs are processed per-item first (they create notes + rewrite links).
- All remaining summarizable items (note prose, URLs, transcriptions, audio) are concatenated with `## <label>` sections and summarized in ONE `summarize()` call.
- Output is a single `Combined summary (N items)` callout appended at the end of the note via `vault.process()` (re-read after the enrichment pass when links were rewritten).
- A single item falls back to the per-item path for a cleaner callout title.

## Note Content (#367)

`extractNoteProse(content)` (`note-scanner.ts:L226`) strips YAML frontmatter and every Synapse-generated summary / transcription / lyrics block (callout and legacy formats) so the AI never re-summarizes its own output. `collectTargets` appends a `note-content` target (when `includeNoteContent`) at the note's last line so a per-item prose callout lands at the end.

## Settings Keys

All under `settings.summarize` (`SummarizeSettings`, `settings.ts:L150`):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module + command activation |
| `maxContentLength` | `number` | `4000` | Truncation limit for fetched/combined content (UI slider 1000-10000) |
| `summaryStyle` | `'bullets' \| 'paragraph' \| 'key-points'` | `'bullets'` | AI output style |
| `customPrompt` | `string` | `''` | Overrides style/schema prompt (highest priority) |
| `autoDetectTemplates` | `boolean` | `true` | Enable content-schema detection |
| `excludeTags` | `string[]` | `['no-summarize']` | Skip notes with these tags |
| `autoOrganizeOnSummarize` | `boolean` | `false` | Trigger single-note organize after summarize |
| `includeNoteContent` | `boolean` | `true` | Summarize the note's own prose as an additional item (#367) |
| `combineSummaries` | `boolean` | `true` | Emit ONE combined summary instead of a callout per item (#367) |

Path exclusion: centralized `settings.exclusions: ExclusionRule[]`; no per-module `excludeFolders`. Checked via `isPathExcluded(path, 'summarize', settings)`; tag exclusion via `matchesExcludeTag(file, excludeTags, metadataCache)` (both in `isExcluded`, `index.ts:L1031`).

## Content-Aware Schemas

Registry: `shared/content-schemas.ts`. Consulted via `detectSchemaFor('summary', content)`.

Inline / combined prompt priority: `customPrompt` > schema match (when `autoDetectTemplates`) > style default.
Enrichment-ref targets always use `COMPREHENSIVE_SUMMARY_PROMPT`.

| ID | appliesTo | Mode |
|----|-----------|------|
| `recipe` | `'summary'` | summarize |
| `receipt` | `'summary'` | summarize |

(`lyrics` exists but applies to `'transcription'`, not summarize.)

## Error States

| Condition | Handling |
|-----------|----------|
| Missing video dep (yt-dlp/ffmpeg) | `DependencyMissingError` matched by `name` through the `cause` chain (`findDependencyMissingError`, index.ts:L98); shows an actionable "Open settings" notice that reveals the Video section (#382) |
| URL fetch throws | `notifyTargetError` -> `linkLoadError(source, reason)` persistent notice; target skipped |
| Fetch returns empty text | `linkLoadError(source, 'page returned no readable text')`; target skipped |
| Audio file not found in vault | throws `Audio file not found in vault: <name>` |
| No targets in note | info notice "No note content, URLs, transcriptions, or audio to summarize in this note" |
| Scan / resume exception | `op.error(...)`; checkpoint left intact |
| User cancels | checkpoint `discard()`; partial work preserved |

## Dependencies

| Import | From |
|--------|------|
| `FolderPickerModal`, `getMarkdownFiles`, `NotificationManager`, `buildCallout`, `CALLOUT_TYPES`, `CheckpointManager`, `generateId`, `fireAndForget`, `isPathExcluded`, `matchesExcludeTag`, `detectSchemaFor`, `OperationHandle`, `isSupportedUrl`, `detectPlatform`, `fetchPageContent`, `fetchTweetContent`, `isRedditUrl`, `fetchRedditContent`, `linkLoadError` | `../shared` |
| `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` | `../shared` (type-only) |
| `findAudioEmbeds` | `../audio` |
| `CommandRegistrar` | `../commands` |
| `SynapseSettings` | `../settings` |
| `findSummarizeTargets`, `extractNoteProse`, `hasSummaryBelow`, `SummarizeTarget`, `SummarizeSelectionModal`, `Summarizer` | local (`./note-scanner`, `./types`, `./summarize-modal`, `./summarizer`) |

NO static import of `../video`. Video transcription is callback-only (`TranscribeUrlFn`).
