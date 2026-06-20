---
last-updated: 2026-06-19
---

# Image Module

OCR text extraction from vault images using multi-modal AI (vision models). Supports single-file extraction, batch extraction with checkpoints, and note scanning for image embeds.

## Public API

Exported from `index.ts`:

```ts
class ImageModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager
  )
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  extractFromFile(file: TFile): Promise<void>
  extractAndInsert(noteFile: TFile, embeds: ImageEmbed[]): Promise<void>
  onExtractionComplete: ((filePath: string) => void) | null
}

// note-scanner.ts (also exported from index.ts)
function findImageEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): ImageEmbed[]
function hasExtractionBelow(lines: string[], embedLine: number, fileName: string): boolean
const IMAGE_EXTENSIONS: RegExp  // /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i
const IMAGE_EMBED_REGEX: RegExp  // /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff))\]\]/gi

// preprocess.ts (also exported from index.ts)
function preprocessImage(data: ArrayBuffer, mediaType: string, maxBytes: number): Promise<PreprocessResult>
// re-exported from shared/encoding.ts for back-compat (canonical home is shared):
function arrayBufferToBase64(buffer: ArrayBuffer): string
function base64EncodedLength(byteLength: number): number

interface PreprocessResult {
  data: ArrayBuffer
  mediaType: string
  downscaled: boolean
}

interface ImageEmbed {
  fileName: string
  file: TFile
  line: number
}

interface OCRResult {
  text: string
  sourceName?: string
}

// settings-section.ts (also exported from index.ts)
function renderImageSettings(ctx: SettingsSectionContext): void
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `ImageEmbed`, `OCRResult` | Type definitions |
| `extractor.ts` | `ImageExtractor` | Multi-modal AI OCR via `AIClient.chat()` with `ContentBlock[]`; applies vision model override |
| `preprocess.ts` | `preprocessImage`, re-exports `arrayBufferToBase64`, `base64EncodedLength` | Auto-downscale/re-encode when payload exceeds `maxImageSizeMb`. Base64 helpers live in `shared/encoding.ts` and are re-exported here for back-compat |
| `note-scanner.ts` | `findImageEmbeds`, `hasExtractionBelow`, `IMAGE_EXTENSIONS`, `IMAGE_EMBED_REGEX` | Scan note content for image embeds; skip embeds with existing OCR callouts |
| `settings-section.ts` | `renderImageSettings` | Settings accordion renderer |
| `index.ts` | `ImageModule`, re-exports | Orchestrator, public extraction methods, checkpoint management |
| `extractor.test.ts` | Tests | `ImageExtractor` tests |
| `note-scanner.test.ts` | Tests | `findImageEmbeds` tests |
| `preprocess.test.ts` | Tests | `preprocessImage` tests |
| `index.test.ts` | Tests | `ImageModule` integration tests |
| `settings-section.test.ts` | Tests | Settings section rendering tests |

## Data Flow

```
1. User triggers via NoteMediaModal (in transcription/) or direct API call
   |
2a. extractFromFile(file) -- single image file to active note
   |  findMatchingRule(activeFile.path, 'image', settings) -- skip if excluded (with Notice)
   |  Reads binary, calls ImageExtractor.extract(), sanitizeAIResponse()
   |  buildCallout(CALLOUT_TYPES.ocr, 'OCR of filename', text, true)
   |  Appends to active note
   |
2b. extractAndInsert(noteFile, embeds) -- batch from note scan
   |  isPathExcluded(noteFile.path, 'image', settings) -- silent skip
   |  Creates checkpoint (module: 'image')
   |  Processes embeds in reverse line order, 2 s delay between API calls
   |  All inserts applied atomically to fresh content
   |  Cancellable via NotificationManager operation handle
   |
3. ImageExtractor.extract(imageData, fileName)
   |  preprocessImage(data, sourceMediaType, maxBytes) -- downscale if needed
   |  arrayBufferToBase64(processed.data)
   |  Builds ContentBlock[]: image block + text prompt
   |  Overrides settings.ai.model with image.visionModel if set (restores in finally)
   |  AIClient.chat() with system prompt "You are an OCR assistant"
   |  Returns: OCRResult { text, sourceName }
   |
4. sanitizeAIResponse(result.text)
   |
5. Result wrapped in callout block (collapsed):
   > [!synapse-ocr]- OCR of filename.png
   > ...extracted text...
```

## Note Scanning

`findImageEmbeds(content, sourcePath, metadataCache)` in `note-scanner.ts`:
- Regex: `![[*.png|jpg|jpeg|gif|webp|bmp|tiff]]`
- Resolves files via `metadataCache.getFirstLinkpathDest()`
- Skips embeds with an existing OCR callout in the 3 lines below (`hasExtractionBelow`)
- Returns `ImageEmbed[]` with file references and line numbers

## Vision Model Override

`ImageExtractor.extract()` temporarily mutates `settings.ai.model` to `settings.image.visionModel` for the duration of the API call. Restored in a `finally` block. If `visionModel` is empty, falls back to `ai.model`.

## Exclusion Behavior

Path-based exclusions use centralized `settings.exclusions: ExclusionRule[]` (#307):
- `extractFromFile`: uses `findMatchingRule(path, 'image', settings)` — emits a Notice naming the matched rule.
- `extractAndInsert`: uses `isPathExcluded(path, 'image', settings)` — silent skip.
- No per-module `excludeFolders` field exists.

The image module has no `excludeTags` setting.

## Checkpoint Behavior

- `extractAndInsert()` creates a checkpoint with `module: 'image'`
- Items tracked per embed (`id: 'image-{index}-{fileName}'`)
- `resumeFromCheckpoint()` cannot resume mid-batch: discards the checkpoint and notifies the user to re-run

## Settings Keys

All under `settings.image`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | true | Module activation; also gates image analysis in elaboration proposer |
| `visionModel` | string | `''` | Override AI model for vision calls (empty = use `ai.model`) |
| `language` | string | `''` | Language hint (reserved, not yet consumed) |
| `maxImageSizeMb` | number | 5 | Max base64 payload (MB) before `preprocessImage` auto-downscales |

## Commands Registered

No commands registered directly by `ImageModule.onload()`. Image OCR is accessible via:
- Command `synapse:transcribe-note-media` (registered by `transcription` module) calls `ImageModule.extractAndInsert(file, embeds)`
- Direct API: `ImageModule.extractFromFile(file)`

## Dependencies

All imports resolve through the `shared` barrel (`../shared`), never an internal `shared/*` file directly.

| Import | From |
|--------|------|
| `AIClient`, `ContentBlock` | `shared` |
| `NotificationManager` | `shared` |
| `CheckpointManager`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` | `shared` |
| `buildCallout`, `CALLOUT_TYPES` | `shared` |
| `sanitizeAIResponse` | `shared` |
| `generateId` | `shared` |
| `isPathExcluded`, `findMatchingRule` | `shared` |
| `base64EncodedLength` (in `preprocess.ts`) | `shared` (canonical: `shared/encoding`) |

Consumed by:
- `elaboration/image-analyzer.ts` imports `preprocessImage` and `arrayBufferToBase64` from the `image` barrel
- `transcription/` module invokes `ImageModule.extractAndInsert()`

## Supported Image Formats

`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `tiff`

GIF payloads that exceed `maxImageSizeMb` are passed through untouched (non-rasterizable; no downscale attempted).

## Invariants / Gotchas

- `extractAndInsert` processes embeds in **reverse line order** so that inserts at higher line numbers do not shift lower line numbers. All inserts are applied atomically via `vault.process()`.
- A 2 s delay (`window.setTimeout`) is inserted between successive API calls to respect rate limits.
- `preprocessImage` is only available in Obsidian's Electron renderer (needs `createEl` + `createImageBitmap` or `Image`). In unit tests without DOM mocks it degrades gracefully (returns original bytes, `downscaled: false`).
- `arrayBufferToBase64` and `base64EncodedLength` canonical home is `shared/encoding.ts`; `preprocess.ts` re-exports them for back-compat so callers that previously imported from `image` continue to work.
