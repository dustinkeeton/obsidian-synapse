---
last-updated: 2026-03-19
---

# Image Module

OCR text extraction from vault images using multi-modal AI (vision models). Supports single-file extraction, batch extraction with checkpoints, and note scanning for image embeds.

## Public API

Exported from `index.ts`:

```ts
class ImageModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  extractFromFile(file: TFile): Promise<void>
  extractAndInsert(noteFile: TFile, embeds: ImageEmbed[]): Promise<void>
  onExtractionComplete: ((filePath: string) => void) | null
}

function findImageEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): ImageEmbed[]

const IMAGE_EXTENSIONS: RegExp   // /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i
const IMAGE_EMBED_REGEX: RegExp  // /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff))\]\]/gi

interface ImageEmbed {
  fileName: string
  file: TFile
  line: number
}

interface OCRResult {
  text: string
  sourceName?: string
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `ImageEmbed`, `OCRResult` | Type definitions |
| `extractor.ts` | `ImageExtractor` | Multi-modal AI OCR via `AIClient.chat()` with `ContentBlock[]` |
| `note-scanner.ts` | `findImageEmbeds`, `hasExtractionBelow`, `IMAGE_EXTENSIONS`, `IMAGE_EMBED_REGEX` | Scan note content for image embeds |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `extractor.test.ts` | Tests | ImageExtractor tests |
| `index.ts` | `ImageModule` | Orchestrator, public extraction methods, checkpoint management |

## Data Flow

```
1. User triggers via NoteMediaModal (in transcription/) or direct API call
   |
2a. extractFromFile(file) -- single file to active note
   |  Reads binary, calls ImageExtractor.extract(), builds callout, appends to active note
   |
2b. extractAndInsert(noteFile, embeds) -- batch from note scan
   |  Creates checkpoint, processes embeds in reverse line order, 2s delay between API calls
   |  Cancellable via NotificationManager operation handle
   |
3. ImageExtractor.extract(imageData, fileName)
   |  Converts ArrayBuffer to base64
   |  Determines MIME type from extension
   |  Builds ContentBlock[] with image + text prompt
   |  Overrides ai.model with image.visionModel if set (restores in finally block)
   |  AIClient.chat() with system prompt "You are an OCR assistant"
   |
4. sanitizeAIResponse() on output
   |
5. Result wrapped in callout block:
   > [!synapse-ocr]- OCR of filename.png
   > ...extracted text...
```

## Note Scanning

`findImageEmbeds(content, sourcePath, metadataCache)` in `note-scanner.ts`:
- Regex: `![[*.png|jpg|jpeg|gif|webp|bmp|tiff]]`
- Resolves files via `metadataCache.getFirstLinkpathDest()`
- Skips embeds with existing OCR callout below (checks 3 lines)
- Returns `ImageEmbed[]` with file references and line numbers

## Vision Model Override

The `ImageExtractor` temporarily swaps `settings.ai.model` with `settings.image.visionModel` for the duration of the API call. If `visionModel` is empty, falls back to `ai.model`.

## Checkpoint Behavior

- `extractAndInsert()` creates a checkpoint with module `'image'`
- Items tracked per embed (id: `image-{index}-{fileName}`)
- `resumeFromCheckpoint()` cannot directly resume (similar to deep-dive) -- discards checkpoint and notifies user to re-run

## Settings Keys

All under `settings.image`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | true | Module activation |
| `visionModel` | string | '' | Override AI model for vision (empty = use `ai.model`) |
| `language` | string | '' | Language hint (reserved for future use) |

## Commands

No commands registered directly. Image OCR is accessible via:
- `synapse:transcribe-note-media` -> `ImageModule.extractAndInsert(file, embeds)`
- Direct API: `ImageModule.extractFromFile(file)`

## Dependencies

| Import | From |
|--------|------|
| `AIClient`, `ContentBlock` | `shared/` |
| `NotificationManager` | `shared/notifications` |
| `CheckpointManager`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` | `shared/checkpoint-*` |
| `buildCallout`, `CALLOUT_TYPES` | `shared/callouts` |
| `sanitizeAIResponse` | `shared/validation` |
| `generateId` | `shared/id-utils` |

## Supported Image Formats

png, jpg, jpeg, gif, webp, bmp, tiff
