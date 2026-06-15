---
last-updated: 2026-06-11
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
    transcribeUrl?: TranscribeUrlFn,
    transcribeAudio?: TranscribeAudioFn
  )
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
}

type TranscribeUrlFn = (
  url: string,
  parentOp?: { update: (msg: string) => void }
) => Promise<string>

type TranscribeAudioFn = (file: TFile) => Promise<string>
```

Exported types: `SummarizeTarget`, `SummarizeSettings`, `TranscribeUrlFn`, `TranscribeAudioFn`

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `summarizer.ts` | `Summarizer` | AI summarization with style (bullets/paragraph/key-points) |
| `summarizer.test.ts` | Tests | Summarizer tests |
| `settings-section.ts` | `renderSummarizeSettings` | Summarize settings UI section |
| `note-scanner.ts` | `findSummarizeTargets`, `hasSummaryBelow` | Finds URLs, transcription blocks, and audio embed summary gaps in note content |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `summarize-modal.ts` | `SummarizeSelectionModal` | Selection modal when multiple targets found |
| `summarize-module.test.ts` | Tests | SummarizeModule integration tests |
| `audio-summarize.test.ts` | Tests | Audio-embed summarization tests |
| `types.ts` | -- | `SummarizeTarget` |

> Content-aware formatting schemas (recipe/receipt detection + prompts) live in the shared `content-schemas.ts` registry (`shared/content-schemas.ts`), consumed here via `detectSchemaFor('summary', content)`. See [Content-Aware Schemas](#content-aware-schemas).

## Data Flow

```
summarizeNote(file)
  --> collectTargets(content, sourcePath)
        findSummarizeTargets(content)  [regex: URLs, transcription blocks]
        findAudioEmbeds(content)  [audio embeds without existing summary]
  --> if multiple: SummarizeSelectionModal
  --> processTargets(file, targets, content)

processFileTargets(file, targets, op, content)
  For each target (reverse line order):
    if inEnrichmentSection:
      --> fetchContentForUrl(url)  [HTTP or video transcription]
      --> Summarizer.summarize(content, url, style, comprehensive prompt)
      --> create standalone note (deferred until after source modify)
      --> replace external link with [[internal link]]
    elif target.type === 'audio':
      --> fetchContentForAudio(fileName, sourceFile)  [transcribeAudio callback]
      --> Summarizer.summarize(transcript, source, style)
      --> insert callout after target line
    else (inline target):
      --> fetchContentForUrl(url) or use transcription content
      --> determine effectivePrompt:
            customPrompt > detectSchemaFor('summary', content) > style default
      --> Summarizer.summarize(content, url, style, effectivePrompt)
      --> insert callout after target line
  --> vault.modify(sourceFile)
  --> vault.create() for pending notes
  --> onSummaryComplete?.(filePath)
  --> onOrganizeRequested?.(file) [if autoOrganizeOnSummarize]
```

## Vault Scan (checkpointed)

```
scanVault(folderPath?)
  Phase 1: Collect files with targets (cancellable scan)
  Phase 2: User confirmation
  Phase 3: Checkpointed processing
    --> checkpointManager.create(module: 'summarize', items)
    --> addDeferredTask('refresh-sidebar-view')
    --> for each file: processFileTargets(), completeItem()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks

resumeFromCheckpoint(checkpoint)
  --> re-processes remaining items from saved checkpoint
  --> completeItem() after each file
  --> on cancel: discard()
  --> on success: complete(), dispatch deferred tasks
```

## Target Types

```ts
interface SummarizeTarget {
  type: 'url' | 'transcription' | 'audio'
  source: string
  line: number
  endLine: number
  content?: string
  inEnrichmentSection?: boolean
  linkTitle?: string
}
```

## Video URL Auto-Transcription

When `transcribeUrl` is injected (from `VideoModule.transcribeUrl`):
- `fetchContentForUrl()` checks `isSupportedUrl(url)` first (`isSupportedUrl` from `shared/url-detector`)
- If video URL detected, transcribes via the injected `transcribeUrl` callback instead of HTTP fetch
- Falls back to `fetchPageContent()` (from `shared/content-fetcher`) for non-video URLs

## Audio Embed Summarization

When `transcribeAudio` is injected (from main.ts closure over `AudioModule.transcribe`):
- `collectTargets()` scans for `![[*.mp3|wav|...]]` embeds via `findAudioEmbeds()`
- Skips embeds with existing summary below (checked via `hasSummaryBelow()`)
- `fetchContentForAudio()` resolves file via MetadataCache, calls `transcribeAudio(file)`
- Resulting transcript is summarized and inserted as callout

Injected in `main.ts`:
```ts
this.summarize = new SummarizeModule(
  this, getSettings, this.notifications, this.checkpointManager,
  (url, parentOp) => this.video.transcribeUrl(url, parentOp),
  async (audioFile) => {
    const data = await this.app.vault.readBinary(audioFile);
    const result = await this.audio.transcribe(data, audioFile.name);
    return result.processed || result.raw;
  }
);
```

## Dependencies

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, OperationHandle, buildCallout, CALLOUT_TYPES, CheckpointManager, generateId, Checkpoint, CheckpointWorkItem, DeferredTask, fetchPageContent, fetchTweetContent, isSupportedUrl, detectPlatform, detectSchemaFor)
- `audio/` (findAudioEmbeds -- used in collectTargets)
- `settings.ts` (SynapseSettings, SummarizeSettings)
- NO static `video/` import. URL-platform helpers (`isSupportedUrl`/`detectPlatform`) and content fetchers (`fetchPageContent`/`fetchTweetContent`) resolve from `shared`. Video transcription happens only through the injected `transcribeUrl` callback (`TranscribeUrlFn`).

## Content-Aware Schemas

The content-aware formatting registry lives in the **shared** module (`shared/content-schemas.ts`) so both the summarize and transcription stages can consult it. Each `ContentSchema` declares which `appliesTo` pipeline stage(s) it targets (`'transcription' | 'summary'`) and a `mode` (`'reformat' | 'summarize'`). The summarize module only ever asks for the `'summary'` stage.

When `autoDetectTemplates` is enabled (default: true) and no `customPrompt` is set, the module runs `detectSchemaFor('summary', content)` on inline-target content before summarization. If a schema matches, its specialized prompt replaces the style-based default.

Priority chain: `customPrompt` > schema match > style default.

Enrichment targets (standalone notes) always use `COMPREHENSIVE_SUMMARY_PROMPT` and are not affected by schema detection.

### Summary-stage schemas

| ID | Name | Detection | Prompt Format |
|----|------|-----------|---------------|
| `recipe` | Recipe | Keyword scoring (structural headers, cooking verbs, measurements); threshold >= 5 | Structured recipe: title, times, servings, ingredients with exact amounts, numbered instructions with step images, notes |
| `receipt` | Receipt | Keyword scoring (currency/total headers, line items, payment terms, identifiers, date/time); threshold >= 5 | Structured receipt: store, date, item table, totals, payment method, notes |

### Adding new schemas

Schemas are defined centrally in `shared/content-schemas.ts`:

1. Create a detection function (pure function, no side effects).
2. Define the specialized prompt string.
3. Add a `ContentSchema` entry to the `CONTENT_SCHEMAS` array with `appliesTo` + `mode` set, and export anything needed from `shared/index.ts`.
4. Add tests in `shared/content-schemas.test.ts` for both positive and negative detection (and the stage gate).

## Tests

- `summarizer.test.ts`
- `note-scanner.test.ts`
- `summarize-module.test.ts`
- `audio-summarize.test.ts`

> Content-schema detection tests live in `shared/content-schemas.test.ts`.
