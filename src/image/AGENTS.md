---
last-updated: 2026-06-25
---

# Image Module

OCR text extraction from vault images via multi-modal AI vision models: single-file extraction to the active note, checkpoint-based batch extraction from note scans, and note scanning for image embeds.

## Public API (barrel exports from index.ts)

```ts
// index.ts:15
class ImageModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager
  )
  onExtractionComplete: ((filePath: string) => void) | null  // wired by main.ts
  onload(): Promise<void>            // no-op (no commands/views registered)
  onunload(): void                   // no-op
  extractFromFile(file: TFile): Promise<void>                 // OCR one image into active note
  extractAndInsert(noteFile: TFile, embeds: ImageEmbed[]): Promise<void>  // batch OCR
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void> // notify + discard (no mid-batch resume)
}

// re-exported from ./note-scanner (index.ts:11)
function findImageEmbeds(content: string, sourcePath: string, metadataCache: MetadataCache): ImageEmbed[]
const IMAGE_EXTENSIONS: RegExp   // /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i
const IMAGE_EMBED_REGEX: RegExp  // /!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff))\]\]/gi

// re-exported from ./preprocess (index.ts:12)
function arrayBufferToBase64(buffer: ArrayBuffer): string   // canonical home: shared/encoding.ts
function preprocessImage(data: ArrayBuffer, mediaType: string, maxBytes: number): Promise<PreprocessResult>

// re-exported from ./settings-section (index.ts:205)
function renderImageSettings(ctx: SettingsSectionContext): void

// re-exported types from ./types (index.ts:13)
interface ImageEmbed { fileName: string; file: TFile; line: number }
interface OCRResult  { text: string; sourceName?: string }
```

## File-level exports (NOT in the index.ts barrel)

```ts
// extractor.ts:8 — internal class, constructed by ImageModule
class ImageExtractor {
  constructor(getSettings: () => SynapseSettings)
  extract(imageData: ArrayBuffer, fileName: string): Promise<OCRResult>
}

// preprocess.ts:25 / :17 — exported from preprocess.ts only
interface PreprocessResult { data: ArrayBuffer; mediaType: string; downscaled: boolean }
function base64EncodedLength(byteLength: number): number   // re-exported from shared for back-compat

// note-scanner.ts:38 — exported from note-scanner.ts only
function hasExtractionBelow(lines: string[], embedLine: number, fileName: string): boolean
```

## File Inventory

| File | Export | Purpose |
|------|--------|---------|
| `types.ts` | `ImageEmbed`, `OCRResult` | Type definitions |
| `extractor.ts` | `ImageExtractor` | Multi-modal OCR via `AIClient.chat()` with `ContentBlock[]`; applies vision-model override |
| `preprocess.ts` | `preprocessImage`, `PreprocessResult`; re-exports `arrayBufferToBase64`, `base64EncodedLength` | Auto-downscale/re-encode oversized payloads; base64 helpers re-exported from `shared/encoding.ts` |
| `note-scanner.ts` | `findImageEmbeds`, `hasExtractionBelow`, `IMAGE_EXTENSIONS`, `IMAGE_EMBED_REGEX` | Scan note text for image embeds; skip embeds already OCR'd |
| `settings-section.ts` | `renderImageSettings` | Settings accordion renderer (registered in `settings-tab.ts:105`) |
| `index.ts` | `ImageModule` + barrel re-exports | Orchestrator, public extraction methods, checkpoint management |
| `extractor.test.ts`, `note-scanner.test.ts`, `preprocess.test.ts`, `index.test.ts`, `settings-section.test.ts` | Tests | Co-located unit tests |

## Data Flow

```
1. extractFromFile(file)  -- index.ts:33  (single image -> active note)
   findMatchingRule(activeFile.path, 'image', settings) -> excluded: info Notice, return
   vault.readBinary(file) -> ImageExtractor.extract(data, file.name)
   sanitizeAIResponse(result.text)
   buildCallout(CALLOUT_TYPES.ocr, `OCR of ${file.name}`, text, collapsed=true)
   vault.process(activeFile, append) -> onExtractionComplete?.(activeFile.path)

2. extractAndInsert(noteFile, embeds)  -- index.ts:86  (batch from note scan)
   isPathExcluded(noteFile.path, 'image', settings) -> excluded: silent return
   checkpointManager.create({ module: 'image', items }) + addDeferredTask('refresh-sidebar-view')
   sort embeds by descending line; for each: 2000ms delay (i>0), extract, sanitize, buildCallout
   completeItem per embed; if op.cancelled -> break
   vault.process(noteFile, splice all inserts at line+1) -> onExtractionComplete
   cancelled -> checkpointManager.discard ; else complete + dispatchDeferredTasks + op.finish

3. ImageExtractor.extract(imageData, fileName)  -- extractor.ts:15
   getMediaType(fileName) -> MIME from extension (default image/png)
   maxBytes = (image.maxImageSizeMb || 5) * 1024 * 1024
   preprocessImage(data, mediaType, maxBytes); downscaled -> Notice (auto-downscaled)
   arrayBufferToBase64(processed.data)
   ContentBlock[] = [ { type:'image', data, mediaType }, { type:'text', text: OCR prompt } ]
   visionModel = image.visionModel || ai.model; override ai.model if differs; restore in finally
   AIClient.chat([{role:'system', content:'You are an OCR assistant...'}, {role:'user', content: blocks}])
   -> OCRResult { text, sourceName: fileName }

Output callout (collapsed):
   > [!synapse-ocr]- OCR of filename.png
   > ...extracted text...
```

## Note Scanning

`findImageEmbeds(content, sourcePath, metadataCache)` (note-scanner.ts:8):
- Matches `IMAGE_EMBED_REGEX` per line; resolves files via `metadataCache.getFirstLinkpathDest()`.
- Includes only `TFile` results whose name passes `IMAGE_EXTENSIONS`.
- Skips embeds with an existing OCR marker in the 3 lines below (`hasExtractionBelow`), matching both the legacy `**OCR of <name>**` and the `[!synapse-ocr]` callout forms.
- Returns `ImageEmbed[]` with `fileName`, `file`, and zero-based `line`.

## Vision Model Override

`ImageExtractor.extract()` (extractor.ts:41) computes `visionModel = image.visionModel || ai.model`. It mutates `settings.ai.model` only when `visionModel !== ai.model`, and restores the original in a `finally` block. Empty `visionModel` means no override (uses `ai.model`).

## Exclusion Behavior

Path exclusions use the centralized `settings.exclusions: ExclusionRule[]`:
- `extractFromFile`: `findMatchingRule(activeFile.path, 'image', settings)` — emits an info Notice naming the matched rule pattern (OCR lands in the active note).
- `extractAndInsert`: `isPathExcluded(noteFile.path, 'image', settings)` — silent skip, checked once per note (not per embed).
- No per-module `excludeFolders` or `excludeTags` field exists.

## Checkpoint Behavior

- `extractAndInsert()` creates a checkpoint with `module: 'image'`, one item per embed (`id: image-{index}-{fileName}`), plus a `refresh-sidebar-view` deferred task.
- Items are marked complete as each embed finishes; cancellation discards the checkpoint.
- `resumeFromCheckpoint()` cannot resume mid-batch: it notifies the user (completed items already saved) and discards the checkpoint.

## Settings

`ImageSettings` (settings.ts:110); defaults at settings.ts:399. All under `settings.image`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | true | Module activation; also gates image analysis in the elaboration proposer |
| `visionModel` | string | `''` | Override AI model for vision calls (empty = use `ai.model`) |
| `language` | string | `''` | Language hint; reserved, not consumed anywhere |
| `maxImageSizeMb` | number | 5 | Max base64 payload (MB) before `preprocessImage` auto-downscales |

Settings UI (`renderImageSettings`, settings-section.ts:7) surfaces only the `enabled` toggle (via `featureSection`) and a `Max image size (MB)` text field. `visionModel` and `language` are not exposed in the accordion.

## Commands Registered

`ImageModule.onload()` registers no commands. OCR is reached via:
- `synapse:transcribe-note-media` (registered by the transcription module) -> `extractAndInsert(file, embeds)`.
- Direct API: `extractFromFile(file)`.

## Dependencies

All cross-module imports resolve through the `../shared` barrel, never an internal `shared/*` file.

| Import | From |
|--------|------|
| `AIClient`, `ContentBlock` | `shared` (extractor.ts) |
| `NotificationManager`, `buildCallout`, `CALLOUT_TYPES`, `sanitizeAIResponse`, `generateId` | `shared` (index.ts) |
| `CheckpointManager`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask` | `shared` (index.ts) |
| `isPathExcluded`, `findMatchingRule` | `shared` (index.ts) |
| `arrayBufferToBase64`, `base64EncodedLength` | `shared` (preprocess.ts) |
| `SettingsSectionContext` | `shared` (settings-section.ts) |

Consumed by:
- `elaboration/image-analyzer.ts` imports `preprocessImage` from `../image` (barrel) and `arrayBufferToBase64` from `../shared`.
- transcription module invokes `ImageModule.extractAndInsert()`.

## Supported Image Formats

`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `tiff`.

Downscale path re-encodes to JPEG. Lossless sources (`image/png`, `image/bmp`, `image/tiff`) benefit most. Animated GIF (`image/gif`) is non-rasterizable and passed through untouched even when oversized.

## Error States

| Site | Condition | Behavior |
|------|-----------|----------|
| `extractFromFile` | no active file | info Notice "Open a note first to insert the OCR result"; return |
| `extractFromFile` | path excluded | info Notice naming the rule; return |
| `extractFromFile` | extract throws | `op.error("OCR extraction failed -- <msg>")` |
| `extractAndInsert` | per-embed extract throws | `notifications.notifyError(...)`; continue to next embed |
| `extractAndInsert` | user cancels | write partial inserts, discard checkpoint |
| `extract` | payload downscaled | Notice "Synapse: large image auto-downscaled to fit the API limit" |
| `preprocessImage` | canvas/DOM unavailable or downscale throws | console.warn; return original bytes, `downscaled: false` |

## Invariants / Gotchas

- `extractAndInsert` sorts embeds by descending line and applies all inserts atomically in one `vault.process()` so earlier splices never shift later lines.
- A 2000ms `window.setTimeout` delay separates successive API calls to respect rate limits.
- `preprocessImage` needs Obsidian's Electron renderer (`createEl` + `createImageBitmap`/`Image`); in non-DOM test envs it passes original bytes through (`downscaled: false`).
- `arrayBufferToBase64`/`base64EncodedLength` canonical home is `shared/encoding.ts`; `preprocess.ts` re-exports them for back-compat (only `arrayBufferToBase64` is also forwarded through the `index.ts` barrel).
