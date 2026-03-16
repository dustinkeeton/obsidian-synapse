---
last-updated: 2026-03-16
---

# summarize module

Summarizes URLs and transcription blocks found in notes. Creates inline summary blockquotes or standalone summary notes for enrichment-section links.

## Public API (`index.ts`)

```ts
class SummarizeModule {
  onSummaryComplete: ((filePath: string) => void) | null

  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
}
```

Exported types: `SummarizeTarget`, `SummarizeSettings`

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `summarizer.ts` | `Summarizer` | AI summarization with style (bullets/paragraph/key-points) |
| `content-fetcher.ts` | `fetchPageContent` | HTTP fetch + HTML-to-text extraction for URLs |
| `note-scanner.ts` | `findSummarizeTargets` | Finds URLs and transcription blocks in note content |
| `summarize-modal.ts` | `SummarizeSelectionModal` | Selection modal when multiple targets found |
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
      --> fetchPageContent(url)  [HTTP]
      --> Summarizer.summarize(content, url, style, comprehensive prompt)
      --> create standalone note (deferred until after source modify)
      --> replace external link with [[internal link]]
    else:
      --> fetchPageContent(url) or use transcription content
      --> Summarizer.summarize(content, url, style)
      --> insert blockquote after target line
  --> vault.modify(sourceFile)
  --> vault.create() for pending notes
  --> onSummaryComplete?.(filePath)
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

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, OperationHandle)
- `settings.ts` (AutoNotesSettings, SummarizeSettings)

## Tests

- `summarizer.test.ts`
- `content-fetcher.test.ts`
- `note-scanner.test.ts`
