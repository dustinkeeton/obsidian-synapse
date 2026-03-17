---
last-updated: 2026-03-17
---

# Summarize Module

Summarizes URLs and transcription blocks found in notes. Creates inline summary callouts or standalone summary notes for enrichment-section links. Auto-transcribes video URLs via injected VideoModule callback.

## Public API (`index.ts`)

```ts
class SummarizeModule {
  onSummaryComplete: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null

  constructor(
    plugin: Plugin,
    getSettings: () => AutoNotesSettings,
    notifications: NotificationManager,
    transcribeUrl?: TranscribeUrlFn
  )
  onload(): Promise<void>
  onunload(): void
}

type TranscribeUrlFn = (
  url: string,
  parentOp?: { update: (msg: string) => void }
) => Promise<string>
```

Exported types: `SummarizeTarget`, `SummarizeSettings`

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `summarizer.ts` | `Summarizer` | AI summarization with style (bullets/paragraph/key-points) |
| `summarizer.test.ts` | Tests | Summarizer tests |
| `content-fetcher.ts` | `fetchPageContent` | HTTP fetch + HTML-to-text extraction for URLs |
| `content-fetcher.test.ts` | Tests | Content fetcher tests |
| `note-scanner.ts` | `findSummarizeTargets` | Finds URLs and transcription blocks in note content |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `summarize-modal.ts` | `SummarizeSelectionModal` | Selection modal when multiple targets found |
| `summarize-module.test.ts` | Tests | SummarizeModule integration tests |
| `types.ts` | -- | `SummarizeTarget` |

## Data Flow

```
summarizeNote(file)
  --> findSummarizeTargets(content)  [regex: URLs, transcription blocks]
  --> if multiple: SummarizeSelectionModal
  --> processTargets(file, targets, content)

processFileTargets(file, targets, op, content)
  For each target (reverse line order):
    if inEnrichmentSection:
      --> fetchContentForUrl(url)  [HTTP or video transcription]
      --> Summarizer.summarize(content, url, style, comprehensive prompt)
      --> create standalone note (deferred until after source modify)
      --> replace external link with [[internal link]]
    else:
      --> fetchContentForUrl(url) or use transcription content
      --> Summarizer.summarize(content, url, style)
      --> insert callout after target line
  --> vault.modify(sourceFile)
  --> vault.create() for pending notes
  --> onSummaryComplete?.(filePath)
  --> onOrganizeRequested?.(file) [if autoOrganizeOnSummarize]
```

## Video URL Auto-Transcription

When `transcribeUrl` is injected (from `VideoModule.transcribeUrl`):
- `fetchContentForUrl()` checks `isSupportedUrl(url)` first
- If video URL detected, transcribes via video pipeline instead of HTTP fetch
- Falls back to `fetchPageContent()` for non-video URLs

Injected in `main.ts`:
```ts
this.summarize = new SummarizeModule(
  this, getSettings, this.notifications,
  (url, parentOp) => this.video.transcribeUrl(url, parentOp)
);
```

## Key Types

```ts
interface SummarizeTarget {
  type: 'url' | 'transcription'
  source: string
  line: number
  endLine: number
  content?: string
  inEnrichmentSection?: boolean
  linkTitle?: string
}
```

## Dependencies

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, OperationHandle, buildCallout, CALLOUT_TYPES)
- `video/` (isSupportedUrl -- used in fetchContentForUrl)
- `settings.ts` (AutoNotesSettings, SummarizeSettings)

## Tests

- `summarizer.test.ts`
- `content-fetcher.test.ts`
- `note-scanner.test.ts`
- `summarize-module.test.ts`
