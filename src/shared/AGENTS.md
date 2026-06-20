---
last-updated: 2026-06-19
---

# Shared Module

Cross-cutting base layer used by all feature modules: AI client, secret redaction, file operations, base64 encoding, notifications, validation, frontmatter parsing, checkpoint management, ID generation, URL platform detection / classification, web content fetching, credential validation, JSON utilities, and Node.js desktop-only loader. Depends on NO feature module — this is the bottom of the dependency graph.

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
type NoticeLevel = 'info' | 'progress' | 'success' | 'warning' | 'error'
interface NoticeAction {
  label: string
  onClick: () => void
}
interface OperationHandle {
  update(message: string): void
  progress(current: number, total: number, label?: string): void
  finish(message?: string, action?: NoticeAction): void
  error(message: string): void
  readonly cancelled: boolean
}
class NotificationManager {
  setStatusBarEl(el: HTMLElement): void
  startOperation(label: string, id?: string): OperationHandle
  confirm(message: string, options?: { proceedLabel?: string; cancelLabel?: string; level?: NoticeLevel }): Promise<boolean>
  cancelOperation(id: string): void
  info(message: string, duration?: number, action?: NoticeAction): void
  success(message: string, duration?: number, action?: NoticeAction): void
  notifyError(context: string, error: unknown): void
  dispose(): void
}

// file-utils.ts
function ensureFolder(app: App, path: string): Promise<void>
function readNote(app: App, path: string): Promise<string | null>
function writeNote(app: App, path: string, content: string): Promise<TFile>
function getMarkdownFiles(app: App, folder?: string): TFile[]
function getIncludedMarkdownFiles(app: App, feature: FeatureId, settings: ExclusionSettings, folder?: string): TFile[]
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
function normalizeFrontmatterTags(value: unknown): string[]   // array|comma-string|other → string[]

// tweet-fetcher.ts
function fetchTweetContent(url: string, maxLength: number): Promise<string>
function isTwitterUrl(url: string): boolean
interface TweetContent { author: string; text: string; url: string }

// callouts.ts
const CALLOUT_TYPES: {
  summary: 'synapse-summary'
  transcription: 'synapse-transcription'
  lyrics: 'synapse-lyrics'
  verse: 'synapse-verse'
  chorus: 'synapse-chorus'
  enrichment: 'synapse-enrichment'
  elaboration: 'synapse-elaboration'
  deepDive: 'synapse-deep-dive'
  nav: 'synapse-nav'
  ocr: 'synapse-ocr'
}
type CalloutType = (typeof CALLOUT_TYPES)[keyof typeof CALLOUT_TYPES]
const ENRICHMENT_START: string   // '%% synapse-enrichment-start %%'
const ENRICHMENT_END: string     // '%% synapse-enrichment-end %%'
function buildCallout(type: CalloutType, title: string, body: string, collapsed?: boolean): string
function calloutForTranscriptionResult(result: { reformatted?: boolean; schemaId?: string }): { type: CalloutType; verb: string }

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

// provider-metadata.ts
type CredentialProvider = 'openai' | 'anthropic' | 'gemini' | 'deepgram' | 'ollama'
interface ProbeSpec { method: 'GET'; url: string; headers: Record<string, string> }
interface ProviderMetadata {
  label: string
  getKeyUrl: string
  placeholder: string
  formatHint: string
  requiresKey: boolean
  buildProbe(input: { key: string; endpoint?: string }): ProbeSpec | null
}
const PROVIDER_METADATA: Record<CredentialProvider, ProviderMetadata>
function aiProviderToCredential(provider: AIProvider): CredentialProvider

// credential-validator.ts
type ValidationStatus = 'valid' | 'invalid' | 'error' | 'skipped'
interface ValidationResult { status: ValidationStatus; provider: CredentialProvider; message: string }
interface ValidateOptions { endpoint?: string; timeoutMs?: number }
function validateCredentials(provider: CredentialProvider, key: string, opts?: ValidateOptions): Promise<ValidationResult>

// credential-field.ts
interface CredentialFieldOptions {
  setting: Setting
  container: HTMLElement
  provider: CredentialProvider
  getKey: () => string
  getEndpoint?: () => string
  validate?: typeof validateCredentials
}
interface CredentialFieldHandle { reset(): void }
function decorateCredentialField(opts: CredentialFieldOptions): CredentialFieldHandle

// feature-chip-select.ts
interface FeatureChipSelectOptions {
  value: 'all' | FeatureId[]
  labels: Record<FeatureId, string>
  order: FeatureId[]
  onChange: (next: 'all' | FeatureId[]) => void
}
function renderFeatureChipSelect(container: HTMLElement, options: FeatureChipSelectOptions): void

// fire-and-forget.ts
interface FireAndForgetOptions {
  notifications?: NotificationManager
  background?: boolean
}
function fireAndForget(promise: Promise<unknown>, label: string, options?: FireAndForgetOptions): void

// json-utils.ts
function parseJson(text: string): unknown                                         // throws SyntaxError on malformed input
function isRecord(v: unknown): v is Record<string, unknown>
function asStringArray(v: unknown): string[]
function readJsonFile<T>(adapter: DataAdapter, path: string, guard: (v: unknown) => v is T): Promise<T | null>

// node-loader.ts
interface NodeModules { os: typeof import('os'); path: typeof import('path'); fs: typeof import('fs'); execFile: typeof import('child_process')['execFile'] }
class DesktopOnlyError extends Error { constructor(message?: string) }
function assertDesktop(context?: string): void
function loadNodeModules(): NodeModules
function shellEnv(): NodeJS.ProcessEnv

// settings-section.ts
interface SettingsSectionContext {
  containerEl: HTMLElement
  plugin: SynapsePlugin
  featureSection(key: string, title: string, getEnabled: () => boolean, setEnabled: (value: boolean) => void, toggleDesc?: string): HTMLElement
  configSection(key: string, title: string): HTMLElement
  rerender: () => void
}
interface SettingsSectionContextOptions {
  containerEl: HTMLElement
  plugin: SynapsePlugin
  onFeatureToggle?: () => void | Promise<void>
  rerender?: () => void
}
function createSettingsSectionContext(options: SettingsSectionContextOptions): SettingsSectionContext
function isSectionCollapsed(plugin: SynapsePlugin, key: string, enabled: boolean | null): boolean
function persistCollapse(plugin: SynapsePlugin, key: string, collapsed: boolean): Promise<void>

// exclusions.ts
type FeatureId = 'elaboration' | 'enrichment' | 'summarize' | 'tidy' | 'organize' | 'deep-dive' | 'audio' | 'video' | 'title' | 'image' | 'rem' | 'intake'
const ALL_FEATURE_IDS: Record<FeatureId, true>
interface ExclusionRule { pattern: string; features: 'all' | FeatureId[] }
interface ExclusionSettings { exclusions: ExclusionRule[] }
interface LegacyModuleExclusions {
  elaboration?: { detection?: { excludeFolders?: unknown } }
  enrichment?: { excludeFolders?: unknown }
  summarize?: { excludeFolders?: unknown }
  organize?: { excludeFolders?: unknown }
  deepDive?: { excludeFolders?: unknown }
}
function findMatchingRule(path: string, feature: FeatureId, settings: ExclusionSettings): ExclusionRule | null
function isPathExcluded(path: string, feature: FeatureId, settings: ExclusionSettings): boolean
function matchesExcludeTag(file: TFile, excludeTags: string[], metadataCache: MetadataCache): boolean
function buildMigratedExclusions(data: LegacyModuleExclusions): ExclusionRule[]

// content-schemas.ts
type PipelineStage = 'transcription' | 'summary'
type SchemaMode = 'reformat' | 'summarize'
interface ContentSchema { id: string; name: string; appliesTo: PipelineStage[]; mode: SchemaMode; detect: (content: string) => boolean; prompt: string }
const CONTENT_SCHEMAS: ContentSchema[]
function detectSchemaFor(stage: PipelineStage, content: string): ContentSchema | null
function isRecipeContent(content: string): boolean
function scoreRecipeContent(content: string): number
function isReceiptContent(content: string): boolean
function scoreReceiptContent(content: string): number
function isLyricsContent(content: string): boolean
function scoreLyricsContent(content: string): number
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `ai-client.ts` | `AIClient`, `extractGeminiResponseText`, re-export `redactSecrets` | Multi-provider AI completion (openai/anthropic/gemini/ollama) with multi-modal support; `safeRequest`, `resolveModelId`, `toOpenAIContent`, `toAnthropicContent`, `toGeminiContent`, `toOllamaMessage` (internal). Imports `redactSecrets` from `redact.ts` |
| `redact.ts` | `redactSecrets` | Single source of truth for API-key/token redaction (sk-/key-/dg-/Bearer/Token/anthropic-/AIza). Consumed by `ai-client.ts` + `api-utils.ts`; redaction behavior covered by `ai-client.test.ts` + `api-utils.test.ts` |
| `encoding.ts` | `arrayBufferToBase64`, `base64EncodedLength` | Base64 encode + exact encoded-length calc; canonical home reused by audio/image/elaboration |
| `encoding.test.ts` | Tests | Encoding tests |
| `types.ts` | `ChatMessage`, `ContentBlock`, `TextContentBlock`, `ImageContentBlock` | Shared types including multi-modal content blocks |
| `notifications.ts` | `NotificationManager`, `OperationHandle`, `NoticeLevel`, `NoticeAction` | Centralized notifications with cancellation, progress, confirmation snackbars, and action buttons. `dispose()` tears down all in-flight operations (called from `main.ts` `onunload()`). `info()` and `success()` accept optional `action?: NoticeAction`. `OperationHandle.finish()` accepts optional `action?: NoticeAction`. |
| `notifications.test.ts` | Tests | NotificationManager tests |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `getIncludedMarkdownFiles`, `wordCount` | Vault file operations. `getIncludedMarkdownFiles` drops notes excluded by centralized exclusion rules for a given `FeatureId` |
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
| `frontmatter-utils.ts` | `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `normalizeFrontmatterTags`, `ParsedNote` | YAML frontmatter parsing and serialization. `normalizeFrontmatterTags` coerces array/comma-string/other → `string[]` |
| `frontmatter-utils.test.ts` | Tests | Frontmatter tests |
| `callouts.ts` | `CALLOUT_TYPES`, `buildCallout`, `calloutForTranscriptionResult`, `ENRICHMENT_START`, `ENRICHMENT_END`, `CalloutType` | Unified callout registry and builder for AI content. `CALLOUT_TYPES` adds `lyrics`/`verse`/`chorus` entries. `calloutForTranscriptionResult` selects callout type and verb based on `schemaId` |
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
| `tweet-fetcher.test.ts` | Tests | Tweet fetcher tests |
| `exclusions.ts` | `FeatureId`, `ExclusionRule`, `ExclusionSettings`, `LegacyModuleExclusions`, `ALL_FEATURE_IDS`, `findMatchingRule`, `isPathExcluded`, `matchesExcludeTag`, `buildMigratedExclusions` | Centralized per-path exclusion (#307): case-sensitive glob→regex matcher (`/**`, `/*`, exact, bare-token recursive; escapes metacharacters), shared tag-exclusion check, and the legacy `excludeFolders`→`exclusions` migration builder |
| `exclusions.test.ts` | Tests | Exclusion matcher + migration tests |
| `content-schemas.ts` | `ContentSchema`, `PipelineStage`, `SchemaMode`, `CONTENT_SCHEMAS`, `detectSchemaFor`, `isRecipeContent`, `scoreRecipeContent`, `isReceiptContent`, `scoreReceiptContent`, `isLyricsContent`, `scoreLyricsContent` | Content-aware formatting registry (#233): recipe/receipt/lyrics detection heuristics + prompts, stage-gated via `appliesTo` and `mode`. `isLyricsContent`/`scoreLyricsContent` added for audio transcription lyric reformatting (#234) |
| `content-schemas.test.ts` | Tests | Schema detection + scoring + stage-gate lock tests |
| `provider-metadata.ts` | `PROVIDER_METADATA`, `aiProviderToCredential`, `CredentialProvider`, `ProviderMetadata`, `ProbeSpec` | Per-provider credential metadata: console URL, placeholder, format hint, minimal authenticated probe spec. Pure data module (no Obsidian runtime import). Covers openai/anthropic/gemini/deepgram/ollama |
| `credential-validator.ts` | `validateCredentials`, `ValidationResult`, `ValidationStatus`, `ValidateOptions` | Live credential validation via provider probe; 10s timeout; never throws; redacts secrets from all error messages. Status: `valid`/`invalid`/`error`/`skipped` |
| `credential-field.ts` | `decorateCredentialField`, `CredentialFieldOptions`, `CredentialFieldHandle` | Decorates a Setting row with a Test button, get-key deep link, and live status chip. Result applied via `setTimeout(0)` (macrotask) to avoid Obsidian settings DOM freeze (#335) |
| `feature-chip-select.ts` | `renderFeatureChipSelect`, `FeatureChipSelectOptions` | Renders a chip multi-select for exclusion rule feature scope. Self-redraws its container on every edit; caller's `onChange` only needs to persist |
| `fire-and-forget.ts` | `fireAndForget`, `FireAndForgetOptions` | Attaches rejection handling to an intentionally un-awaited promise. Routes errors through `NotificationManager.notifyError` when available; supports background mode (log only, no toast) |
| `json-utils.ts` | `parseJson`, `isRecord`, `asStringArray`, `readJsonFile` | Type-safe JSON helpers. `parseJson` returns `unknown` (not `any`). `readJsonFile` reads via `DataAdapter`, validates with a type guard, returns `null` on any failure |
| `node-loader.ts` | `loadNodeModules`, `assertDesktop`, `shellEnv`, `DesktopOnlyError`, `NodeModules` | Single sanctioned entry point for desktop-only Node.js builtins (os/path/fs/child_process). Lazy-loads inside function body so importing never triggers a module load on mobile. `shellEnv()` builds a narrowed subprocess environment with PATH augmented for common tool install locations |
| `settings-section.ts` | `createSettingsSectionContext`, `isSectionCollapsed`, `persistCollapse`, `SettingsSectionContext`, `SettingsSectionContextOptions` | Shared accordion plumbing for the settings tab (#243). Feature renderers receive a `SettingsSectionContext` and call `featureSection()`/`configSection()` to build accordions without importing `settings-tab.ts` |
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
- `info()` and `success()` accept optional `action?: NoticeAction` 3rd param — renders an action button on the toast (8s auto-dismiss)
- `OperationHandle.finish(message?, action?)` accepts optional `action?: NoticeAction` — completion toast includes a button that runs `action.onClick()` then hides the toast
- `dispose()` — tears down every in-flight tracked operation (stops its `setInterval` + hides its notice, clears the map). Called from `main.ts` `onunload()` so disabling the plugin mid-operation never leaves an orphaned 400ms timer firing against a detached toast. Source ref: `notifications.ts:L139`

## Validation Rules

| Function | Rejects |
|----------|---------|
| `sanitizeUrl` | null bytes, non-HTTP(S), shell metacharacters |
| `sanitizePath` | empty, null bytes, `..` traversal, shell metacharacters |
| `ensureWithinVault` | paths resolving outside vault base (helper EXISTS but is not yet wired into write paths — no active write-boundary enforcement) |
| `sanitizeAIResponse` | script tags, event handlers, javascript/data/vbscript URIs, iframe/embed/object |
| `blockquoteOriginal` | (transforms) wraps body in blockquote, preserves frontmatter |
| `isValidCheckpointId` | anything not matching `/^[a-z0-9]+$/` |

## Exclusion Pattern Forms

| Pattern form | Matches |
|---|---|
| `dir/**` | folder and all descendants, NOT the folder itself |
| `dir/*` | direct children only |
| `dir/file.md` (has `/`, no wildcard) | that exact vault-relative path |
| `templates` (bare token, no `/`, no wildcard) | the token itself and every descendant |

Mid-segment wildcards (e.g. `dir/*.md`) are out of scope for v1 and fall through to exact-path matching.

## Content Schema Registry

| Schema id | Stage | Mode | Detection threshold |
|---|---|---|---|
| `recipe` | `summary` | `summarize` | score >= 5 (structural + cooking verbs + measurement terms) |
| `receipt` | `summary` | `summarize` | score >= 5 (currency + total headers + line items + payment terms) |
| `lyrics` | `transcription` | `reformat` | score >= 5 (section markers + repetition ratio + short-segment profile + stanza structure) |

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
| `getIncludedMarkdownFiles` | candidate/index enumerations (tag indexes, title maps, link/mention targets) |
| `fetchTweetContent` | summarize/index, elaboration/proposer, enrichment/index |
| `isTwitterUrl` | elaboration/proposer, enrichment/index |
| `sanitizeUrl` | video/index, video/audio-extractor |
| `sanitizePath` | video/audio-extractor |
| `sanitizeAIResponse` | elaboration/index, elaboration/proposer, audio/post-processor, image/index, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `parseFrontmatter` | enrichment/index, enrichment/enrichment-applier, tidy/index |
| `serializeFrontmatter` | enrichment/enrichment-applier, tidy/index |
| `mergeTags` | enrichment/enrichment-applier |
| `normalizeFrontmatterTags` | exclusions/matchesExcludeTag, json-utils docs |
| `blockquoteOriginal` | elaboration/index |
| `withRetry` | tidy/index |
| `generateId` | elaboration, enrichment, summarize, organize, deep-dive (proposal/run IDs) |
| `notifyError` | (legacy, replaced by NotificationManager in most modules) |
| `PROVIDER_METADATA` / `aiProviderToCredential` | credential-field, credential-validator, settings-tab |
| `validateCredentials` | credential-field (injected; default impl used by Test button) |
| `decorateCredentialField` | settings-tab (per provider credential row) |
| `renderFeatureChipSelect` | settings-tab (exclusion rule feature scope editor) |
| `fireAndForget` | feature modules (non-blocking background operations) |
| `parseJson` / `isRecord` / `asStringArray` / `readJsonFile` | checkpoint-manager, proposal-store, enrichment-store, and other JSON stores |
| `loadNodeModules` / `assertDesktop` / `shellEnv` | audio/transcriber, video/audio-extractor (yt-dlp/ffmpeg/ffprobe subprocess calls) |
| `createSettingsSectionContext` | settings-tab (orchestrator) |
| `findMatchingRule` / `isPathExcluded` | file-utils/getIncludedMarkdownFiles, all feature entry points |
| `matchesExcludeTag` | elaboration, enrichment, summarize, tidy, organize, deep-dive, rem |
| `buildMigratedExclusions` | settings migration (on load, if legacy excludeFolders present) |
| `detectSchemaFor` | summarize/index (summary stage), audio/transcriber (transcription stage) |
| `isLyricsContent` / `scoreLyricsContent` | content-schemas (internal detection), audio transcription pipeline |
| `calloutForTranscriptionResult` | audio/transcriber, video transcription pipeline |
