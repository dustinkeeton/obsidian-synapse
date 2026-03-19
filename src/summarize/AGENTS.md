---
last-updated: 2026-03-18
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
| `content-fetcher.ts` | `fetchPageContent` | HTTP fetch + HTML-to-text extraction for URLs |
| `content-fetcher.test.ts` | Tests | Content fetcher tests |
| `note-scanner.ts` | `findSummarizeTargets`, `hasSummaryBelow` | Finds URLs, transcription blocks, and audio embed summary gaps in note content |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `summarize-modal.ts` | `SummarizeSelectionModal` | Selection modal when multiple targets found |
| `summarize-module.test.ts` | Tests | SummarizeModule integration tests |
| `audio-summarize.test.ts` | Tests | Audio-embed summarization tests |
| `templates.ts` | `detectContentTemplate`, `isRecipeContent`, `scoreRecipeContent`, `CONTENT_TEMPLATES` | Content-aware template detection (recipe format, extensible) |
| `templates.test.ts` | Tests | Template detection unit tests |
| `types.ts` | -- | `SummarizeTarget` |

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
            customPrompt > detectContentTemplate(content) > style default
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
- `fetchContentForUrl()` checks `isSupportedUrl(url)` first
- If video URL detected, transcribes via video pipeline instead of HTTP fetch
- Falls back to `fetchPageContent()` for non-video URLs

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

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, OperationHandle, buildCallout, CALLOUT_TYPES, CheckpointManager, generateId, Checkpoint, CheckpointWorkItem, DeferredTask)
- `video/` (isSupportedUrl -- used in fetchContentForUrl)
- `audio/` (findAudioEmbeds -- used in collectTargets)
- `settings.ts` (SynapseSettings, SummarizeSettings)

## Content-Aware Templates

When `autoDetectTemplates` is enabled (default: true) and no `customPrompt` is set, the module runs `detectContentTemplate(content)` on inline-target content before summarization. If a template matches, its specialized prompt replaces the style-based default.

Priority chain: `customPrompt` > template match > style default.

Enrichment targets (standalone notes) always use `COMPREHENSIVE_SUMMARY_PROMPT` and are not affected by template detection.

### Templates

| ID | Name | Detection | Prompt Format |
|----|------|-----------|---------------|
| `recipe` | Recipe | Keyword scoring (structural headers, cooking verbs, measurements); threshold >= 5 | Structured recipe: title, times, servings, ingredients with exact amounts, numbered instructions with step images, notes |

### Adding New Templates

1. Create a detection function in `templates.ts` (pure function, no side effects).
2. Define the specialized prompt string.
3. Add a `ContentTemplate` entry to the `CONTENT_TEMPLATES` array.
4. Add tests in `templates.test.ts` for both positive and negative detection.

## Tests

- `summarizer.test.ts`
- `content-fetcher.test.ts`
- `note-scanner.test.ts`
- `summarize-module.test.ts`
- `templates.test.ts`
- `audio-summarize.test.ts`
