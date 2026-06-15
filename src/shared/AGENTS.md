---
last-updated: 2026-06-11
---

# Shared Module

Cross-cutting base layer used by all feature modules: AI client, secret redaction, file operations, base64 encoding, notifications, validation, frontmatter parsing, checkpoint management, ID generation, URL platform detection / classification, and web content fetching. Depends on NO feature module — this is the bottom of the dependency graph.

Canonical homes (re-exported elsewhere for back-compat — import from the `shared` barrel, never an internal file):
- `url-detector.ts` (`detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult`) — moved here from `src/video/` to break the former shared⇄video import cycle; `video` re-exports for back-compat.
- `redact.ts` (`redactSecrets`) — single source of truth for API-key/token redaction; `ai-client.ts` re-exports it. Previously `ai-client` and `notifyError` each kept inline copies that drifted (the `notifyError` copy lacked the Google `AIza` pattern).
- `encoding.ts` (`arrayBufferToBase64`, `base64EncodedLength`) — base64 helpers; `image/preprocess.ts` re-exports them so audio + image + elaboration share one implementation.

## Public API

Exported from `index.ts`:

```ts
// ai-client.ts
class AIClient {
  constructor(getSettings: () => SynapseSettings)
  complete(prompt: string, systemPrompt?: string): Promise<string>
  chat(messages: ChatMessage[]): Promise<string>   // providers: openai | anthropic | gemini | ollama
}
function extractGeminiResponseText(json: GeminiResponseJson): string  // throws on blocked/empty 200 shapes
export { redactSecrets }                              // re-export of redact.ts (back-compat)

// redact.ts (single source of truth for secret redaction)
function redactSecrets(text: string): string         // replaces sk-/key-/dg-/Bearer/Token/anthropic-/AIza secrets with [REDACTED]

// encoding.ts
function arrayBufferToBase64(buffer: ArrayBuffer): string
function base64EncodedLength(byteLength: number): number   // exact base64 char count for a byte length

// types.ts
interface TextContentBlock { type: 'text'; text: string }
interface ImageContentBlock { type: 'image'; data: string; mediaType: string }
type ContentBlock = TextContentBlock | ImageContentBlock
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentBlock[] }

// notifications.ts
class NotificationManager {
  setStatusBarEl(el: HTMLElement): void
  startOperation(label: string, id?: string): OperationHandle
  confirm(message: string, options?: { proceedLabel?: string; cancelLabel?: string; level?: NoticeLevel }): Promise<boolean>
  cancelOperation(id: string): void
  info(message: string, duration?: number): void
  success(message: string, duration?: number): void
  notifyError(context: string, error: unknown): void
}
interface OperationHandle {
  update(message: string): void
  progress(current: number, total: number, label?: string): void
  finish(message?: string): void
  error(message: string): void
  readonly cancelled: boolean
}

// file-utils.ts
function ensureFolder(app: App, path: string): Promise<void>
function readNote(app: App, path: string): Promise<string | null>
function writeNote(app: App, path: string, content: string): Promise<TFile>
function getMarkdownFiles(app: App, folder?: string): TFile[]
function wordCount(text: string): number

// api-utils.ts
function withRetry<T>(fn: () => Promise<T>, maxRetries?: number, delayMs?: number, shouldRetry?: (error: unknown) => boolean): Promise<T>
function sleep(ms: number): Promise<void>
function notifyError(context: string, error: unknown): void   // redacts secrets via redactSecrets() before Notice/console
function classifyNetworkError(error: unknown): NetworkErrorKind   // 'connection-refused' | 'dns' | 'timeout' | 'offline' | null
function isTransientNetworkError(error: unknown): boolean
function describeNetworkError(error: unknown, resource: string): string | null   // user-facing explanation, null for non-network

// validation.ts
function sanitizeUrl(url: string): string
function sanitizePath(filePath: string): string
function ensureWithinVault(filePath: string, vaultBasePath: string): string  // EXISTS but not yet wired into write paths
function sanitizeAIResponse(text: string): string
function stripCodeFences(text: string): string
function blockquoteOriginal(content: string): string
function parseTimestamp(input: string): number                 // 'mm:ss' / 'hh:mm:ss' / seconds -> seconds
function validateTimeRange(start: string, end: string, duration?: number): TimeRange
function formatTimeRange(range: TimeRange): string
interface TimeRange { startSeconds: number; endSeconds: number }

// url-detector.ts (moved here from video/)
function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean                   // true for all detected platforms except 'twitter'
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }

// url-classifier.ts
function classifyUrl(url: string): UrlClassification
function extractUrls(text: string): string[]
type UrlContentType = string
interface UrlClassification { /* url, contentType, ... */ }

// content-fetcher.ts
function fetchPageContent(url: string): Promise<string>
function fetchArticleContent(url: string): Promise<string>
function extractReadableText(html: string): string
function extractTitle(html: string): string
function extractMetaDescription(html: string): string
function extractJsonLdRecipes(html: string): RecipeJsonLd[]
function formatRecipeStructuredData(recipes: RecipeJsonLd[]): string

// collapsible-section.ts
function addCollapsibleSection(opts: CollapsibleSectionOptions): CollapsibleSection

// frontmatter-utils.ts
interface ParsedNote { frontmatter: Record<string, unknown>; body: string; hasFrontmatter: boolean }
function parseFrontmatter(content: string): ParsedNote
function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string
function mergeTags(frontmatter: Record<string, unknown>, newTags: string[]): void

// tweet-fetcher.ts
function fetchTweetContent(url: string, maxLength: number): Promise<string>
function isTwitterUrl(url: string): boolean
interface TweetContent { author: string; text: string; url: string }

// callouts.ts
const CALLOUT_TYPES: { summary, transcription, enrichment, elaboration, deepDive, nav, ocr }
type CalloutType = 'synapse-summary' | 'synapse-transcription' | 'synapse-enrichment'
                 | 'synapse-elaboration' | 'synapse-deep-dive' | 'synapse-nav' | 'synapse-ocr'
const ENRICHMENT_START: string   // '%% synapse-enrichment-start %%' marker
const ENRICHMENT_END: string     // '%% synapse-enrichment-end %%' marker
function buildCallout(type: CalloutType, title: string, body: string, collapsed?: boolean): string

// diagram-generator.ts
function generateTreeDiagram(root: TreeNode): string
function generateMoveDiagram(moves: MoveRecord[]): string
function generateOrganizeSummary(moves: MoveRecord[], timestamp: string): string

// slider-helper.ts
function addEnhancedSlider(setting: Setting, options: SliderOptions): void

// folder-picker-modal.ts
class FolderPickerModal extends SuggestModal<TFolder> { ... }

// id-utils.ts
function generateId(): string                    // timestamp(base36) + random(base36)
function isValidCheckpointId(id: string): boolean // /^[a-z0-9]+$/

// checkpoint-manager.ts
class CheckpointManager {
  constructor(app: App)
  create(params: { module: CheckpointModule; operationLabel: string; items: CheckpointWorkItem[]; metadata?: Record<string, unknown> }): Promise<Checkpoint>
  resume(checkpointId: string): Promise<Checkpoint | null>
  completeItem(checkpointId: string, itemId: string): Promise<Checkpoint | null>
  addDeferredTask(checkpointId: string, task: DeferredTask): Promise<Checkpoint | null>
  complete(checkpointId: string): Promise<DeferredTask[]>
  discard(checkpointId: string): Promise<void>
  remove(checkpointId: string): Promise<void>
  load(checkpointId: string): Promise<Checkpoint | null>
  listIncomplete(): Promise<Checkpoint[]>
  listByStatus(status: CheckpointStatus): Promise<Checkpoint[]>
  listAll(): Promise<Checkpoint[]>
  cleanup(maxAgeMs?: number): Promise<number>
}

// checkpoint-types.ts
type CheckpointModule = 'deep-dive' | 'elaboration' | 'enrichment' | 'audio' | 'video' | 'image' | 'summarize' | 'organize' | 'rem'
type CheckpointStatus = 'active' | 'completed' | 'discarded'
interface CheckpointWorkItem { id: string; label: string; payload: Record<string, unknown> }
interface DeferredTask { id: string; type: string; data: Record<string, unknown> }
interface Checkpoint {
  id: string
  module: CheckpointModule
  operationLabel: string
  status: CheckpointStatus
  createdAt: string
  updatedAt: string
  completedItems: CheckpointWorkItem[]
  remainingItems: CheckpointWorkItem[]
  deferredTasks: DeferredTask[]
  metadata: Record<string, unknown>
}
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `ai-client.ts` | `AIClient`, `extractGeminiResponseText`, re-export `redactSecrets` | Multi-provider AI completion (openai/anthropic/gemini/ollama) with multi-modal support; `safeRequest`, `resolveModelId`, `toOpenAIContent`, `toAnthropicContent`, `toGeminiContent`, `toOllamaMessage` (internal). Imports `redactSecrets` from `redact.ts` |
| `redact.ts` | `redactSecrets` | Single source of truth for API-key/token redaction (sk-/key-/dg-/Bearer/Token/anthropic-/AIza). Consumed by `ai-client.ts` + `api-utils.ts`; redaction behavior covered by `ai-client.test.ts` + `api-utils.test.ts` |
| `encoding.ts` | `arrayBufferToBase64`, `base64EncodedLength` | Base64 encode + exact encoded-length calc; canonical home reused by audio/image/elaboration |
| `encoding.test.ts` | Tests | Encoding tests |
| `types.ts` | `ChatMessage`, `ContentBlock`, `TextContentBlock`, `ImageContentBlock` | Shared types including multi-modal content blocks |
| `notifications.ts` | `NotificationManager`, `OperationHandle`, `NoticeLevel` | Centralized notifications with cancellation, progress, confirmation snackbars |
| `notifications.test.ts` | Tests | NotificationManager tests |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `wordCount` | Vault file operations |
| `api-utils.ts` | `withRetry`, `sleep`, `notifyError`, `classifyNetworkError`, `isTransientNetworkError`, `describeNetworkError` | Retry with exponential backoff, network-error classification/disclosure, redacted error display (via `redactSecrets`) |
| `validation.ts` | `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse`, `stripCodeFences`, `blockquoteOriginal`, `parseTimestamp`, `validateTimeRange`, `formatTimeRange`, `TimeRange` | Input validation, output sanitization, time-range parsing |
| `validation.test.ts` | Tests | Validation tests |
| `url-detector.ts` | `detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult` | Regex platform detection (moved here from video/) |
| `url-detector.test.ts` | Tests | URL detection tests (moved here from video/) |
| `url-classifier.ts` | `classifyUrl`, `extractUrls`, `UrlContentType`, `UrlClassification` | Classify URL content type, extract URLs from text |
| `url-classifier.test.ts` | Tests | URL classifier tests |
| `content-fetcher.ts` | `fetchPageContent`, `fetchArticleContent`, `extractReadableText`, `extractTitle`, `extractMetaDescription`, `extractJsonLdRecipes`, `formatRecipeStructuredData`, `RecipeJsonLd` | Fetch + extract readable web/article/recipe content |
| `content-fetcher.test.ts` | Tests | Content fetcher tests |
| `collapsible-section.ts` | `addCollapsibleSection`, `CollapsibleSection`, `CollapsibleSectionOptions` | Reusable collapsible UI section (settings accordions) |
| `collapsible-section.test.ts` | Tests | Collapsible section tests |
| `frontmatter-utils.ts` | `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `ParsedNote` | YAML frontmatter parsing and serialization |
| `frontmatter-utils.test.ts` | Tests | Frontmatter tests |
| `callouts.ts` | `CALLOUT_TYPES`, `buildCallout`, `CalloutType` | Unified callout registry and builder for AI content |
| `callouts.test.ts` | Tests | Callout tests |
| `diagram-generator.ts` | `generateTreeDiagram`, `generateMoveDiagram`, `generateOrganizeSummary`, `TreeNode`, `MoveRecord` | Mermaid diagram generation for organize summaries |
| `diagram-generator.test.ts` | Tests | Diagram generator tests |
| `slider-helper.ts` | `addEnhancedSlider` | Settings UI helper for range sliders with ticks |
| `folder-picker-modal.ts` | `FolderPickerModal` | Modal for folder selection with autocomplete |
| `folder-picker-modal.test.ts` | Tests | FolderPickerModal tests |
| `id-utils.ts` | `generateId`, `isValidCheckpointId` | ID generation and validation for checkpoint paths |
| `checkpoint-types.ts` | `CheckpointModule`, `CheckpointStatus`, `CheckpointWorkItem`, `DeferredTask`, `Checkpoint` | Checkpoint data model types |
| `checkpoint-manager.ts` | `CheckpointManager` | CRUD and lifecycle management for resumable operation checkpoints |
| `checkpoint-manager.test.ts` | Tests | CheckpointManager tests |
| `tweet-fetcher.ts` | `fetchTweetContent`, `isTwitterUrl`, `TweetContent` | Twitter/X.com tweet fetching with oEmbed → fxtwitter → vxtwitter fallback chain |
| `exclusions.ts` | `FeatureId`, `ExclusionRule`, `findMatchingRule`, `isPathExcluded`, `matchesExcludeTag`, `ALL_FEATURE_IDS`, `buildMigratedExclusions`, `LegacyModuleExclusions` | Centralized per-path exclusion (#307): case-sensitive glob→regex matcher (`/**`, `/*`, exact, bare-token recursive; escapes metacharacters), shared tag-exclusion check, and the legacy `excludeFolders`→`exclusions` migration builder |
| `exclusions.test.ts` | Tests | Exclusion matcher + migration tests |
| `tweet-fetcher.test.ts` | Tests | Tweet fetcher tests |
| `content-schemas.ts` | `ContentSchema`, `PipelineStage`, `SchemaMode`, `CONTENT_SCHEMAS`, `detectSchemaFor`, `isRecipeContent`, `scoreRecipeContent`, `isReceiptContent`, `scoreReceiptContent` | Content-aware formatting registry (#233): recipe/receipt detection heuristics + prompts, stage-gated via `appliesTo` (`'transcription' \| 'summary'`) and `mode` (`'reformat' \| 'summarize'`). Promoted out of `summarize/` so both summarize and transcription stages can consult it via `detectSchemaFor(stage, content)` |
| `content-schemas.test.ts` | Tests | Schema detection + scoring + stage-gate lock tests |
| `index.ts` | re-exports | Barrel file |

## AIClient Provider Routing

```
AIClient.chat(messages)
|-- resolveModelId(provider, model)
|     Anthropic: opus->claude-opus-4-6, sonnet->claude-sonnet-4-6, haiku->claude-haiku-4-5-20251001
|     Others: pass-through
|
|-- 'openai'    --> POST api.openai.com/v1/chat/completions
|                   Auth: Bearer {ai.apiKey}
|-- 'anthropic' --> POST api.anthropic.com/v1/messages
|                   Auth: x-api-key, system message extracted to top-level field
|-- 'gemini'    --> POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
|                   Auth: x-goog-api-key; system routed to system_instruction; 'assistant'->'model';
|                   response parsed via extractGeminiResponseText() (throws on blocked/empty 200)
|-- 'ollama'    --> POST {ollamaEndpoint}/api/chat
|                   HTTPS required (HTTP for localhost only)
|
All use Obsidian requestUrl via safeRequest() (120s timeout, redacts secrets in error bodies via redactSecrets)
```

## CheckpointManager Lifecycle

```
create(module, label, items)
  --> generates ID via generateId()
  --> saves to .synapse/checkpoints/{id}.json
  --> returns Checkpoint (status: 'active')

completeItem(checkpointId, itemId)
  --> moves item from remainingItems to completedItems
  --> serialized with per-checkpoint write mutex

addDeferredTask(checkpointId, task)
  --> appends task to deferredTasks array

complete(checkpointId)
  --> sets status to 'completed'
  --> returns deferredTasks for caller to execute

discard(checkpointId)
  --> sets status to 'discarded'
  --> deferred tasks are NOT executed

resume(checkpointId)
  --> returns checkpoint if status === 'active', else null

cleanup(maxAgeMs = 7 days)
  --> removes completed/discarded checkpoints older than threshold
```

Write concurrency: per-checkpoint mutex via `withLock()` prevents concurrent read-modify-write races.

## NotificationManager Features

- Tracked operations with animated ellipsis, progress counters, cancel buttons
- Non-dismissible notices for running operations
- Confirmation snackbars (Proceed/Cancel) returning `Promise<boolean>`
- Status bar integration (shows active operation count)
- CSS injection for styled notices
- API key redaction in error messages

## Validation Rules

| Function | Rejects |
|----------|---------|
| `sanitizeUrl` | null bytes, non-HTTP(S), shell metacharacters |
| `sanitizePath` | empty, null bytes, `..` traversal, shell metacharacters |
| `ensureWithinVault` | paths resolving outside vault base (helper EXISTS but is not yet wired into write paths — no active write-boundary enforcement) |
| `sanitizeAIResponse` | script tags, event handlers, javascript/data/vbscript URIs, iframe/embed/object |
| `blockquoteOriginal` | (transforms) wraps body in blockquote, preserves frontmatter |
| `isValidCheckpointId` | anything not matching `/^[a-z0-9]+$/` |

## Consumers

| Utility | Used By |
|---------|---------|
| `AIClient` | elaboration/proposer, elaboration/image-analyzer, audio/post-processor, image/extractor, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `redactSecrets` | ai-client (safeRequest error bodies), api-utils/notifyError (user/console errors) |
| `extractGeminiResponseText` | ai-client (callGemini), audio/transcriber (Gemini provider) |
| `arrayBufferToBase64` / `base64EncodedLength` | image/preprocess (re-exports), audio/transcriber (Gemini inline audio), elaboration/image-analyzer |
| `classifyNetworkError` / `describeNetworkError` | audio/transcriber (retry gating + failure disclosure) |
| `NotificationManager` | all feature modules (injected via constructor) |
| `CheckpointManager` | main (creates), elaboration, audio, video, image, enrichment, summarize, organize, deep-dive, rem (all injected via constructor) |
| `fetchArticleContent` / `fetchPageContent` | summarize/index, intake/index |
| `classifyUrl` / `extractUrls` | summarize, enrichment, intake (URL routing) |
| `detectPlatform` / `isSupportedUrl` | video/index, transcription/, summarize (platform gating) |
| `ensureFolder` | elaboration/proposal-store, enrichment/enrichment-store, tidy/tidy-store, video/index, organize/index, deep-dive/index, checkpoint-manager |
| `wordCount` | elaboration/detector, deep-dive/index |
| `readNote` | deep-dive/index |
| `writeNote` | deep-dive/index, organize/index |
| `fetchTweetContent` | summarize/index, elaboration/proposer, enrichment/index |
| `isTwitterUrl` | elaboration/proposer, enrichment/index |
| `sanitizeUrl` | video/index, video/audio-extractor |
| `sanitizePath` | video/audio-extractor |
| `sanitizeAIResponse` | elaboration/index, elaboration/proposer, audio/post-processor, image/index, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `parseFrontmatter` | enrichment/index, enrichment/enrichment-applier, tidy/index |
| `serializeFrontmatter` | enrichment/enrichment-applier, tidy/index |
| `mergeTags` | enrichment/enrichment-applier |
| `blockquoteOriginal` | elaboration/index |
| `withRetry` | tidy/index |
| `generateId` | elaboration, enrichment, summarize, organize, deep-dive (proposal/run IDs) |
| `notifyError` | (legacy, replaced by NotificationManager in most modules) |
