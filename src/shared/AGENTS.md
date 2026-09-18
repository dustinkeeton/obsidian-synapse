---
last-updated: 2026-09-17
---

# Shared Module

Cross-cutting base layer used by all feature modules: AI client, secret redaction, file operations, base64 encoding, notifications, in-app update checking, validation, frontmatter parsing, checkpoint management, per-note AI-operation serialization, the media-URL transcript store, ID generation, note-title predicates, URL platform detection / classification, web / Reddit / tweet content fetching, credential validation, JSON utilities, Node.js desktop-only loader, and the feature-module lifecycle contract (`ModuleDeps` / `FeatureModule` / `FeatureSettingsKey`, #504). Depends on NO feature module — this is the bottom of the dependency graph (one type-only edge to `commands/` for `CommandRegistrar`, erased at compile time).

Canonical homes (re-exported elsewhere for back-compat — import from the `shared` barrel, never an internal file):
- `url-detector.ts` (`detectPlatform`, `isSupportedUrl`, `Platform`, `UrlDetectionResult`) — moved here from `src/video/` to break the former shared⇄video import cycle; `video` re-exports for back-compat.
- `redact.ts` (`redactSecrets`, `redactError`) — single source of truth for API-key/token redaction; `ai-client.ts` re-exports `redactSecrets` (only). `redactSecrets` is consumed by `ai-client.ts`, `credential-validator.ts`, `credential-field.ts` (Test-button validation-catch message), `update-checker.ts` (fetch-failure detail), and `notifications.ts` (operation-error + notifyError paths). `redactError(value)` renders a caught error to a redacted, log-safe string (prefers `.stack`, falls back to `name: message`, then `redactSecrets`); it is the one sanctioned way to log a raw error, routed through by every raw-error console sink (`main.ts` settings-migration catch, `shared/data-folder-migration.ts`, `onboarding/onboarding.ts` first-run catch, `checkpoints/checkpoint-recovery.ts`, `update-checker.ts` unexpected-error catch, `transcript-cache.ts`, audio, intake, rem/semantic-matcher, elaboration/image-analyzer, elaboration/proposer, image/preprocess, transcription/caption-strategy + youtube-captions, the clipboard-copy catches in `notifications.ts` + `video/settings-section.ts`, shared/fire-and-forget). Previously `ai-client` and the former `api-utils.notifyError` each kept inline copies that drifted (the `notifyError` copy lacked the Google `AIza` pattern). The console-sink contract is lint-enforced (#418) by the custom type-aware rule `synapse/no-unredacted-console` (`scripts/eslint-rules/no-unredacted-console.mjs`, scoped in `eslint.config.mjs` to shipped `src/**/*.ts`, excluding tests/mocks/test-utils): every value reaching `console.*` must be statically string-like or routed through `redactError`/`redactSecrets`.
- `encoding.ts` (`arrayBufferToBase64`, `base64EncodedLength`) — base64 helpers; `image/preprocess.ts` re-exports them so audio + image + elaboration share one implementation.
- `title-detector.ts` (`isUntitled`, `isGenericTitle`) — note-title predicates; lives here (not in `title/`) so non-title features can reuse them without a cross-feature import. `title/title-detector.ts` re-exports `isUntitled`.

## Public API

Exported from `index.ts`:

```ts
// ai-client.ts
interface AIRequestOptions {                          // type re-exported from the barrel (#527)
  bypassCache?: boolean                               // forces fresh dispatch for "regenerate"
  onCacheHit?: () => void                             // #527; called only when the response is replayed from the cache (never for a dispatch, a bypass, or a coalesced join)
}
class AIClient {
  constructor(getSettings: () => SynapseSettings)
  complete(prompt: string, systemPrompt?: string, opts?: AIRequestOptions): Promise<string>
  chat(messages: ChatMessage[], opts?: AIRequestOptions): Promise<string>   // providers: openai | anthropic | gemini | ollama
}
function extractGeminiResponseText(json: unknown): string  // throws on blocked/empty 200 shapes
export { redactSecrets }                              // re-export of redact.ts (back-compat; redactError is NOT re-exported here)
// chat()/complete() wrap a private dispatch() with an opt-in per-instance LRU response cache (max 50)
// + in-flight coalescing (#397). Cacheable when ai.temperature === 0 OR ai.cacheResponses === true.
// Key = contentKey([JSON(messages), provider, model, temperature, maxTokens]); bypassCache skips the
// cache read + coalescing but still refreshes the cache; only successful dispatches are cached.

// redact.ts (single source of truth for secret redaction)
function redactSecrets(text: string): string         // replaces sk-/key-/dg-/Bearer/Token/anthropic-/AIza secrets with [REDACTED]
function redactError(value: unknown): string         // render a caught value to a redacted, log-safe string: Error -> (stack ?? `name: message`), else String(value); then redactSecrets. Sanctioned raw-error console sink.

// encoding.ts
function arrayBufferToBase64(buffer: ArrayBuffer): string
function base64EncodedLength(byteLength: number): number   // exact base64 char count for a byte length

// types.ts
interface TextContentBlock { type: 'text'; text: string }
interface ImageContentBlock { type: 'image'; data: string; mediaType: string }
type ContentBlock = TextContentBlock | ImageContentBlock
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentBlock[] }

// notifications.ts
function linkLoadError(source: string, reason: string): string   // standardized "Could not load content from {source}: {reason}" message
type NoticeLevel = 'info' | 'progress' | 'success' | 'warning' | 'error'   // NOT re-exported via the barrel; module-local, used by signatures below
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
  infoSticky(message: string, action: NoticeAction): void   // duration 0, dismissible; used by UpdateChecker
  success(message: string, duration?: number, action?: NoticeAction): void
  error(message: string): void   // persistent, copy-on-dismiss; redacts via redactSecrets
  notifyError(context: string, error: unknown): void   // error object + context label; routes through error()/redactSecrets
  dispose(): void
}

// update-checker.ts
function isNewerVersion(latest: string, current: string): boolean   // strict semver gt; tolerant of leading 'v'; false on equal/older/malformed
interface UpdateCheckerDeps {
  currentVersion: string
  app: App
  notifications: NotificationManager
  getSettings: () => SynapseSettings
  saveSettings: () => Promise<void>
}
class UpdateChecker {
  constructor(deps: UpdateCheckerDeps)
  maybeCheck(now?: number): Promise<void>   // gated on settings.updates.enableUpdateNotifications; polls GitHub Releases at most 1/24h; fails silently; never nags twice
}

// file-utils.ts
function ensureFolder(app: App, path: string): Promise<void>
function readNote(app: App, path: string): Promise<string | null>
function writeNote(app: App, path: string, content: string): Promise<TFile>
function getMarkdownFiles(app: App, folder?: string): TFile[]
function getIncludedMarkdownFiles(app: App, feature: FeatureId, settings: ExclusionSettings, folder?: string): TFile[]
function wordCount(text: string): number
function findAvailableVaultPath(app: App, desiredPath: string): string   // Obsidian-style de-dup: appends -1,-2,... before the extension until free

// api-utils.ts (notifyError now lives on NotificationManager, not here)
function withRetry<T>(fn: () => Promise<T>, maxRetries?: number, delayMs?: number, shouldRetry?: (error: unknown) => boolean): Promise<T>   // defaults: maxRetries 3, delayMs 1000, shouldRetry () => true; exponential backoff
function sleep(ms: number): Promise<void>
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

// reddit-fetcher.ts
function fetchRedditContent(url: string, maxLength: number): Promise<string>   // resolves share/short links, reads per-post .rss Atom feed, formats post + top comments
function isRedditUrl(url: string): boolean                       // reddit.com / *.reddit.com / redd.it hostnames
function extractCanonicalPostUrl(html: string): string          // derive /comments/ permalink from share-page HTML; '' if none (exported mainly for tests)
interface RedditContent { author: string; title: string; selftext: string; comments: string[]; url: string }

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

// open-scan-folder-picker.ts:9
function openScanFolderPicker(app: App, onChoose: (path: string | undefined) => void): void   // undefined = vault root

// confirm-modal.ts:4 / :22 (#420; settle-once yes/no modal; dismiss = false)
interface ConfirmModalOptions { title: string; message: string; confirmLabel?: string }   // confirmLabel default 'Reset'
class ConfirmModal extends Modal {
  constructor(app: App, opts: ConfirmModalOptions)
  openAndConfirm(): Promise<boolean>   // confirm-modal.ts:74
}

// settings-reset.ts (per-section + global settings reset)
function sectionHasReset(key: string): boolean                                   // :25; false only for 'about'
function applySectionReset(settings: SynapseSettings, key: string): void         // :57; mutates in place; special keys: 'general', 'ai', 'audio'
function sectionMatchesDefaults(settings: SynapseSettings, key: string): boolean // :141
function applyResetAll(current: SynapseSettings): SynapseSettings               // :193; fresh defaults, preserves settingsVersion/onboarding.hasSeenWelcome/ui.collapsedSections/updates.lastUpdateCheck+dismissedUpdateVersion

// id-utils.ts
function generateId(): string                    // timestamp(base36) + random(base36)
function isValidCheckpointId(id: string): boolean // /^[a-z0-9]+$/

// title-detector.ts
function isUntitled(title: string): boolean       // matches Obsidian 'Untitled' / 'Untitled N' default (case-insensitive)
function isGenericTitle(title: string): boolean   // generic = Untitled default | date-style daily-note name | bare URL

// note-operation-queue.ts (#483; path-keyed FIFO serialization of note read -> AI -> write cycles)
interface NoteOperationOptions {
  onWait?: () => void   // called SYNCHRONOUSLY at submission time, only when the operation must wait for a predecessor
}
class NoteOperationQueue {
  isBusy(notePath: string): boolean   // an operation is queued or running for this path
  get size(): number                  // number of paths with queued/running operations (diagnostics/tests)
  run<T>(notePath: string, operation: () => Promise<T>, options?: NoteOperationOptions): Promise<T>
}
// One instance per plugin (created in main.ts:56), injected into every module that mutates a note after an AI call.
// Chain entries never reject (built from internal resolve-only promises), so a failing operation cannot poison a key;
// `run` rejections still propagate to the caller and still release the slot (note-operation-queue.ts:85).

// feature-module.ts (#504; the contract every src/<feature>/index.ts module class implements; driven by modules/registry.ts)
interface ModuleDeps {
  plugin: Plugin
  getSettings: () => SynapseSettings
  notifications: NotificationManager
  checkpointManager: CheckpointManager
  registrar: CommandRegistrar        // type-only import from ../commands (commands imports nothing in src/ → no cycle)
  noteQueue: NoteOperationQueue
}
// Every module constructor takes ModuleDeps FIRST; module-specific inputs follow positionally (see modules/registry.ts).
type FeatureSettingsKey = 'elaboration' | 'audio' | 'video' | 'image' | 'enrichment' | 'summarize' | 'tidy' | 'organize' | 'deepDive' | 'title' | 'rem' | 'intake'
// derived: keys of SynapseSettings whose value has `enabled: boolean`; adding such a section forces a registry entry (FeatureModules is mapped over it)
interface FeatureModule {
  onload(): Promise<void>
  onunload(): void
  onViewRefreshNeeded?: (() => Promise<void>) | null   // proposal-sidebar slots; main.ts assigns them only where the slot exists (!== undefined)
  onOpenProposalView?: (() => void) | null
}

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

// review-action.ts (#366: centralized "Review" completion-toast gate)
interface ReviewActionOptions { generated: boolean; shouldAutoAccept: () => boolean; openProposalView: (() => void) | null; postOp?: boolean }
function reviewAction(opts: ReviewActionOptions): NoticeAction | undefined   // Review action iff generated && !shouldAutoAccept() && !postOp; else undefined

// hash-utils.ts (browser-safe FNV-1a content hashing; content-addressing only, NOT security)
function hashString(input: string): string            // 16-char lowercase hex digest (two 32-bit FNV-1a lanes)
function contentKey(parts: string[]): string          // length-prefixed (netstring) join of parts, then hashString

// untrusted-content.ts (structural prompt-injection defense for fetched external text)
const UNTRUSTED_OPEN_TAG: string                       // 'UNTRUSTED_EXTERNAL_CONTENT'
const UNTRUSTED_CLOSE_FENCE: string                    // '<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>'
function wrapUntrusted(content: string, source?: string): string   // fence content in labeled delimiters + anti-breakout sanitization

// settings-migrations.ts (#93: version-stamped settings migration runner)
interface SettingsMigration { to: number; migrate: (raw: Record<string, unknown>) => Record<string, unknown> }
const CURRENT_SETTINGS_VERSION: number                 // 2 (highest migration `to`; DEFAULT_SETTINGS stamps this)
const SETTINGS_MIGRATIONS: SettingsMigration[]         // ordered chain: v1 excludeFolders->exclusions (#307), v2 drop inert rem.semanticMatching
function readSettingsVersion(raw: Record<string, unknown> | null | undefined): number   // 0 when absent/non-numeric
function migrateSettings(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown>   // clones, replays migrations with to > fromVersion

// settings-merge.ts:10 — persisted settings over defaults; nested records recurse, arrays/primitives overwrite; drops __proto__/constructor/prototype keys; NOT a deep clone (untouched nested defaults shared by reference)
function deepMergeSettings<T extends object>(target: T, source: Record<string, unknown>): T

// data-folder-migration.ts:5 / :6 / :13 — one-time `.auto-notes/` -> `.synapse/` rename at load (main.ts:50); never throws
const LEGACY_DATA_FOLDER = '.auto-notes'
const DATA_FOLDER = '.synapse'
function migrateDataFolder(adapter: DataAdapter, notifications: NotificationManager): Promise<void>   // absent old folder = silent return; both present = console.warn, no rename; failure = console.error(redactError) + notifications.error

// json-utils.ts
function parseJson(text: string): unknown                                         // throws SyntaxError on malformed input
function isRecord(v: unknown): v is Record<string, unknown>
function asStringArray(v: unknown): string[]
function readJsonFile<T>(adapter: DataAdapter, path: string, guard: (v: unknown) => v is T): Promise<T | null>

// transcript-cache.ts (#488) — vault-file transcript store behind every URL-transcription path
interface CachedTranscript { text: string; raw: string; source: string; title?: string; language?: string; videoVaultPath?: string; reformatted?: boolean; schemaId?: string }   // structural subset of transcription's UrlTranscript
interface TranscriptCacheEntry extends CachedTranscript { url: string; fetchedAt: number; lastUsedAt: number }   // url = canonicalMediaUrl(url)
interface TranscriptCacheOptions { path?: string; maxEntries?: number; maxChars?: number }   // defaults: .synapse/transcript-cache.json, 200, 4_000_000
function canonicalMediaUrl(url: string): string                    // youtube -> https://www.youtube.com/watch?v=<id>; instagram -> https://www.instagram.com/p/<id>; tiktok -> params stripped; else fragment + trailing slash stripped
function transcriptCacheKey(url: string, timeRange?: TimeRange): string   // canonical + '#t=<start>-<end>' when clipped
class TranscriptCache {
  constructor(app: App, options?: TranscriptCacheOptions)
  get(url: string, timeRange?: TimeRange): Promise<TranscriptCacheEntry | null>   // bumps lastUsedAt (LRU)
  put(url: string, transcript: CachedTranscript, timeRange?: TimeRange): Promise<void>   // overwrites, then evicts LRU past maxEntries / maxChars (text+raw length)
  clear(): Promise<void>                                            // empties memory + removes the file
  size(): Promise<number>
}
// Never throws: unreadable/corrupt file = empty store, failed write = console.warn(redactError). Lazy single load, in-memory map, full-file rewrite on every put/get.

// cache-notice.ts (#527) — single source of "served from cache" finish wording
interface CacheUse { transcript?: boolean; ai?: boolean }          // which caches served any part of ONE result
function usedCache(use: CacheUse): boolean                         // module-only (not on the barrel); the filter behind withCacheReport
function mergeCacheUse(uses: CacheUse[]): CacheUse                 // OR per cache (several sources -> one result)
function transcriptCacheUse(result: { cached?: boolean; aiCached?: boolean }): CacheUse   // routed URL transcript flags -> CacheUse
function trackAiCache(use: CacheUse): AIRequestOptions             // { onCacheHit } that sets use.ai; any replayed call in an operation marks it
function withCacheReport(message: string, items: CacheUse[], unit?: string): string   // items = one per result; no hit -> message unchanged; 1 item -> ' — used a cached transcript ("Fetch a fresh transcript" in Transcribe media replaces it)' | ' — used a cached AI response' | both; >1 -> ' — N of M <unit>s served from cache' (unit = singular noun for one item: 'note' | 'proposal' | 'summary' | 'transcription' | 'extraction'; every batch caller passes one)

// no-speech.ts (#524) — typed no-speech outcome shared by audio, video, transcription
const NO_SPEECH_MESSAGE: string                                   // 'No speech detected — nothing to transcribe'
const MIN_TRANSCRIPT_CHARS_FOR_AI: number                         // 10 letters/digits
class NoSpeechDetectedError extends Error { constructor(message?: string) }   // name = 'NoSpeechDetectedError' (summarize matches by name; keep stable)
function isNoSpeechError(error: unknown): boolean                 // walks the `cause` chain by name; cycle-safe
function hasSpeechContent(text: string): boolean                  // false for blank text and annotation-only text (`[Music]`, `(applause)`, `♪`)
function isWorthPostProcessing(text: string): boolean             // hasSpeechContent AND >= MIN_TRANSCRIPT_CHARS_FOR_AI letters/digits
function noSpeechNotice(subject?: string): string                 // 'No speech detected in <subject> — nothing to transcribe'

// node-loader.ts
interface NodeModules { os: typeof import('os'); path: typeof import('path'); fs: typeof import('fs'); execFile: typeof import('child_process')['execFile'] }
class DesktopOnlyError extends Error { constructor(message?: string) }
function assertDesktop(context?: string): void
function loadNodeModules(): NodeModules
function shellEnv(): NodeJS.ProcessEnv

// settings-section.ts (imports `type SynapsePlugin` from ../main — type-only back-edge, erased at compile time)
interface SectionRegistryEntry { key: string; title: string; bodyEl: HTMLElement; reset?: () => Promise<void> }   // settings-section.ts:21
interface SettingsSectionContext {
  containerEl: HTMLElement
  plugin: SynapsePlugin
  sections: SectionRegistryEntry[]   // every rendered accordion, in render order
  featureSection(key: string, title: string, getEnabled: () => boolean, setEnabled: (value: boolean) => void, toggleDesc?: string): HTMLElement
  configSection(key: string, title: string): HTMLElement
  rerender: () => void
  onFeatureToggle(listener: FeatureToggleListener): void   // fires after a feature enable toggle is saved
}
type FeatureToggleListener = () => void | Promise<void>
interface SettingsSectionContextOptions {
  containerEl: HTMLElement
  plugin: SynapsePlugin
  onFeatureToggle?: FeatureToggleListener   // seed listener
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
| `ai-client.ts` | `AIClient`, `AIRequestOptions`, `extractGeminiResponseText`, re-export `redactSecrets` | Multi-provider AI completion (openai/anthropic/gemini/ollama) with multi-modal support. `chat()`/`complete()` accept `opts?: AIRequestOptions` and wrap a private `dispatch()` with an opt-in per-instance LRU response cache (max 50) + in-flight coalescing (#397; key via `contentKey`); `safeRequest`, `resolveModelId`, `cacheGet`/`cacheSet`, `to*Content` (internal). Imports `redactSecrets` from `redact.ts`, `contentKey` from `hash-utils.ts` |
| `redact.ts` | `redactSecrets`, `redactError` | Single source of truth for API-key/token redaction (sk-/key-/dg-/Bearer/Token/anthropic-/AIza). `redactSecrets` consumed by `ai-client.ts`, `credential-validator.ts`, `credential-field.ts`, `update-checker.ts`, `notifications.ts`; `redactError(value)` renders a caught error to a redacted log-safe string (stack ?? `name: message` -> redactSecrets) for every raw-error console sink (main, data-folder-migration, onboarding, checkpoints, update-checker, transcript-cache, audio, intake, rem, elaboration x2, image/preprocess, transcription x2, clipboard catches in notifications + video settings, fire-and-forget). Behavior covered by `redact.test.ts` |
| `redact.test.ts` | Tests | Redaction pattern tests |
| `encoding.ts` | `arrayBufferToBase64`, `base64EncodedLength` | Base64 encode + exact encoded-length calc; canonical home reused by audio/image/elaboration |
| `encoding.test.ts` | Tests | Encoding tests |
| `types.ts` | `ChatMessage`, `ContentBlock`, `TextContentBlock`, `ImageContentBlock` | Shared types including multi-modal content blocks |
| `notifications.ts` | `NotificationManager`, `linkLoadError`, `OperationHandle`, `NoticeAction` (barrel); `NoticeLevel` (module-local, not re-exported) | Centralized notifications with cancellation, progress, confirmation snackbars, and action buttons. `dispose()` tears down all in-flight operations (called from `main.ts` `onunload()`). `info()`/`success()` accept optional `action?: NoticeAction`; `infoSticky()` shows a duration-0 dismissible action toast; `error()`/`notifyError()`/operation-error `console.error` all route through `redactSecrets` (single redaction source). One-shot `info()`/`success()`/`error()` (no action) are equal-message throttled within 3s (#396) to prevent per-item toast floods; tracked-operation, `confirm()`, action, and `notifyError()` toasts are exempt. `linkLoadError(source, reason)` builds the shared external-link failure message used by Elaborate + Summarize |
| `notifications.test.ts` | Tests | NotificationManager tests |
| `update-checker.ts` | `UpdateChecker`, `isNewerVersion`, `UpdateCheckerDeps` | In-app "newer Synapse available" check (#365). Polls the plugin's own public GitHub Releases API at most once/24h (gated on `settings.updates.enableUpdateNotifications`), compares the latest tag to the running version, and shows a sticky notice via `notifications.infoSticky` whose button opens Settings → Community plugins. Fails silently (offline/non-200/malformed → logged `null`); the fetch-failure detail is logged through `redactSecrets` and the outer unexpected-error catch through `redactError`. Records the shown version so it never nags twice. `isNewerVersion` is pure semver gt |
| `update-checker.test.ts` | Tests | UpdateChecker + isNewerVersion tests |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `getIncludedMarkdownFiles`, `wordCount`, `findAvailableVaultPath` | Vault file operations. `getIncludedMarkdownFiles` drops notes excluded by centralized exclusion rules for a given `FeatureId`. `findAvailableVaultPath` resolves a non-colliding vault path (Obsidian-style `-1`/`-2` suffix before the extension); used by video re-downloads + title duplicate "iterate" resolution (#408) |
| `api-utils.ts` | `withRetry`, `sleep`, `classifyNetworkError`, `isTransientNetworkError`, `describeNetworkError` | Retry with exponential backoff + per-error `shouldRetry` gate, network-error classification/disclosure. `notifyError` no longer lives here — error display moved to `NotificationManager` |
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
| `open-scan-folder-picker.ts` | `openScanFolderPicker` | Unified scan-folder picker wrapper over `FolderPickerModal`; root-first sort so Enter-on-open scans the whole vault; `onChoose(undefined)` = root. Used by main (`fire`) and the elaboration, enrichment, summarize, organize, rem folder-scan commands |
| `open-scan-folder-picker.test.ts` | Tests | Scan folder picker tests |
| `confirm-modal.ts` | `ConfirmModal`, `ConfirmModalOptions` | Reusable settle-once yes/no confirmation modal (#420); Escape/click-away resolves `false`. Used by `settings-section.ts` reset controls |
| `confirm-modal.test.ts` | Tests | ConfirmModal tests |
| `settings-reset.ts` | `sectionHasReset`, `applySectionReset`, `sectionMatchesDefaults`, `applyResetAll` | Per-section and global reset-to-defaults over `DEFAULT_SETTINGS` (`structuredClone`); `general`/`ai`/`audio` keys reset field subsets rather than whole groups. Imports `../settings` (DEFAULT_SETTINGS) |
| `settings-reset.test.ts` | Tests | Reset helper tests |
| `id-utils.ts` | `generateId`, `isValidCheckpointId` | ID generation and validation for checkpoint paths |
| `checkpoint-types.ts` | `CheckpointModule`, `CheckpointStatus`, `CheckpointWorkItem`, `DeferredTask`, `Checkpoint` | Checkpoint data model types |
| `checkpoint-manager.ts` | `CheckpointManager` | CRUD and lifecycle management for resumable operation checkpoints |
| `checkpoint-manager.test.ts` | Tests | CheckpointManager tests |
| `note-operation-queue.ts` | `NoteOperationQueue`, `NoteOperationOptions` | Per-note serialization of AI operations (#483): path-keyed FIFO promise chain (same pattern as `CheckpointManager.withLock`, but keyed on note path and used by feature modules). Operations submitted for the same path run in submission order, so each reads what the previous one wrote. Contract: key on the note the operation reads/writes; acquire AT MOST ONCE per operation (no nesting → no lock ordering → no deadlock) — public entry points acquire, the private cores they delegate to do not; incidental writes to OTHER notes (title backlink remediation + merge targets, deep-dive syllabus/sibling nav, organize summary notes) stay unqueued; batch scans take one slot per note, never one per batch. Fire-and-forget post-op follow-ups (enrichment / title check) started from inside a queued operation enqueue BEHIND it and run against the post-write content (nothing awaits them → no cycle). A rename inside a queued operation (title accept) is keyed on the PRE-rename path; work queued under the old path runs afterwards, finds no file and exits early |
| `note-operation-queue.test.ts` | Tests | Ordering, cross-path independence, lost-update, rejection-does-not-poison, `onWait`-only-on-wait, `isBusy`, burst-drain tests |
| `feature-module.ts` | `ModuleDeps`, `FeatureModule`, `FeatureSettingsKey` | Feature-module lifecycle contract (#504): the service bundle every module constructor takes first, the `onload`/`onunload` + optional proposal-hook-slot interface `modules/registry.ts` drives, and the settings-key union that gates load. Type-only imports (`obsidian` `Plugin`, `../settings`, `../commands` `CommandRegistrar`); no runtime code |
| `transcript-cache.ts` | `TranscriptCache`, `canonicalMediaUrl`, `transcriptCacheKey`, `CachedTranscript`, `TranscriptCacheEntry`, `TranscriptCacheOptions` | Persistent media-URL transcript store (#488) at `.synapse/transcript-cache.json`, keyed by canonical URL + time range. Consumed by `transcription/url-transcription.ts` (router read-through/write-through via the `TranscriptStore` slice), constructed once in `main.ts` (`SynapsePlugin.transcriptCache`), cleared from `video/settings-section.ts`. Imports `url-detector`, `json-utils`, `file-utils` (`ensureFolder`), `redact` |
| `no-speech.ts` | `NoSpeechDetectedError`, `isNoSpeechError`, `hasSpeechContent`, `isWorthPostProcessing`, `noSpeechNotice`, `NO_SPEECH_MESSAGE`, `MIN_TRANSCRIPT_CHARS_FOR_AI` | No-speech outcome (#524). Thrown by `audio/transcriber.ts`, `audio/index.ts`, `transcription/url-transcription.ts`, `transcription/local-extraction-strategy.ts`; branched on by the audio/video/transcription write sites; `summarize` matches it by name. No imports |
| `cache-notice.ts` | `CacheUse`, `mergeCacheUse`, `transcriptCacheUse`, `trackAiCache`, `withCacheReport` (barrel); `usedCache` (module-only) | Cache-hit reporting (#527): wording + batch aggregation for operation finish messages. Type-only import of `ai-client`. Used by audio, video, transcription, summarize, tidy, elaboration, enrichment, deep-dive, organize, rem, title, image |
| `cache-notice.test.ts` | Tests | Unchanged-on-miss, per-cache wording, batch aggregation, flag mapping |
| `no-speech.test.ts` | Tests | Error name/message, cause-chain + cycle matching, blank/annotation detection, AI minimum length, notice wording |
| `transcript-cache.test.ts` | Tests | Canonicalization, key/time-range separation, round-trip persistence, LRU entry + char eviction, corrupt-file tolerance, write-failure tolerance |
| `tweet-fetcher.ts` | `fetchTweetContent`, `isTwitterUrl`, `TweetContent` | Twitter/X.com tweet fetching with oEmbed → fxtwitter → vxtwitter fallback chain |
| `tweet-fetcher.test.ts` | Tests | Tweet fetcher tests |
| `reddit-fetcher.ts` | `fetchRedditContent`, `isRedditUrl`, `extractCanonicalPostUrl`, `RedditContent` | Reddit post fetching via the per-post `.rss` Atom feed (the `.json` API now 403s unauthenticated clients). Resolves `/s/` share + `redd.it` short links to canonical `/comments/` permalinks from share-page HTML, retries 429/503 with backoff, formats post body + top `MAX_COMMENTS` comments. Uses Obsidian `requestUrl` (never native fetch) for mobile CSP (#88) |
| `reddit-fetcher.test.ts` | Tests | Reddit fetcher + canonical-URL + Atom-parsing tests |
| `title-detector.ts` | `isUntitled`, `isGenericTitle` | Note-title predicates shared across features (canonical home; `title/title-detector.ts` re-exports `isUntitled`). `isGenericTitle` = Untitled default OR date-style daily-note name (validated month/day ranges) OR bare URL; used by elaboration's anti-fabrication guard so a generic-titled empty note is refused rather than fabricated from the filename |
| `title-detector.test.ts` | Tests | Title-predicate tests |
| `exclusions.ts` | `FeatureId`, `ExclusionRule`, `ExclusionSettings`, `LegacyModuleExclusions`, `ALL_FEATURE_IDS`, `findMatchingRule`, `isPathExcluded`, `matchesExcludeTag`, `buildMigratedExclusions` | Centralized per-path exclusion (#307): case-sensitive glob→regex matcher (`/**`, `/*`, exact, bare-token recursive; escapes metacharacters), shared tag-exclusion check, and the legacy `excludeFolders`→`exclusions` migration builder |
| `exclusions.test.ts` | Tests | Exclusion matcher + migration tests |
| `content-schemas.ts` | `ContentSchema`, `PipelineStage`, `SchemaMode`, `CONTENT_SCHEMAS`, `detectSchemaFor`, `isRecipeContent`, `scoreRecipeContent`, `isReceiptContent`, `scoreReceiptContent`, `isLyricsContent`, `scoreLyricsContent` | Content-aware formatting registry (#233): recipe/receipt/lyrics detection heuristics + prompts, stage-gated via `appliesTo` and `mode`. `isLyricsContent`/`scoreLyricsContent` added for audio transcription lyric reformatting (#234) |
| `content-schemas.test.ts` | Tests | Schema detection + scoring + stage-gate lock tests |
| `provider-metadata.ts` | `PROVIDER_METADATA`, `aiProviderToCredential`, `CredentialProvider`, `ProviderMetadata`, `ProbeSpec` | Per-provider credential metadata: console URL, placeholder, format hint, minimal authenticated probe spec. Pure data module (no Obsidian runtime import). Covers openai/anthropic/gemini/deepgram/ollama |
| `credential-validator.ts` | `validateCredentials`, `ValidationResult`, `ValidationStatus`, `ValidateOptions` | Live credential validation via provider probe; 10s timeout; never throws; redacts secrets from all error messages. Status: `valid`/`invalid`/`error`/`skipped` |
| `credential-field.ts` | `decorateCredentialField`, `CredentialFieldOptions`, `CredentialFieldHandle` | Decorates a Setting row with a Test button, get-key deep link, and live status chip. Result applied via `setTimeout(0)` (macrotask) to avoid Obsidian settings DOM freeze (#335). The validation-catch path renders its error into the status chip through `redactSecrets` so a key echoed in a thrown message never reaches the chip |
| `feature-chip-select.ts` | `renderFeatureChipSelect`, `FeatureChipSelectOptions` | Renders a chip multi-select for exclusion rule feature scope. Self-redraws its container on every edit; caller's `onChange` only needs to persist |
| `fire-and-forget.ts` | `fireAndForget`, `FireAndForgetOptions` | Attaches rejection handling to an intentionally un-awaited promise. Routes errors through `NotificationManager.notifyError` when available; both the background-mode and no-manager-fallback `console.error` sinks route through `redactError` (single redaction source). Supports background mode (log only, no toast) |
| `review-action.ts` | `reviewAction`, `ReviewActionOptions` | Centralized "Review" completion-toast gate (#366): returns a `NoticeAction` opening the unified proposal view iff something was generated, auto-accept is off for the kind, and it is not an automatic post-op side effect. Shared by elaboration, enrichment, organize, deep-dive, title, rem |
| `review-action.test.ts` | Tests | reviewAction gate tests |
| `hash-utils.ts` | `hashString`, `contentKey` | Browser-safe FNV-1a string hashing (no Node `crypto`); content-addressing only, NOT security. `hashString` -> 16-char hex; `contentKey` length-prefixes parts before hashing. Used by ai-client cache key, elaboration proposal dedup, title content keys |
| `hash-utils.test.ts` | Tests | Hash + content-key tests |
| `untrusted-content.ts` | `wrapUntrusted`, `UNTRUSTED_OPEN_TAG`, `UNTRUSTED_CLOSE_FENCE` | Structural prompt-injection defense: fences fetched external text (article/tweet/Reddit bodies, image analysis) in labeled delimiters with a data-not-instructions frame + anti-breakout sentinel scrubbing. Used by elaboration/proposer |
| `untrusted-content.test.ts` | Tests | Fence/sanitization tests |
| `settings-migrations.ts` | `migrateSettings`, `readSettingsVersion`, `CURRENT_SETTINGS_VERSION`, `SETTINGS_MIGRATIONS`, `SettingsMigration` (+ `foldExcludeFoldersIntoExclusions`, `dropSemanticMatching` for tests) | Version-stamped settings migration runner (#93). Pure; imports only `shared/exclusions` (stays bottom layer, never imports `../settings`). Replays every migration with `to > persisted settingsVersion` over the raw `data.json` before defaults merge. v1 folds legacy `excludeFolders` -> `exclusions` (#307); v2 drops the inert `rem.semanticMatching` flag |
| `settings-migrations.test.ts` | Tests | Migration runner + per-step + drift-guard tests |
| `settings-merge.ts` | `deepMergeSettings` | Prototype-pollution-safe merge of persisted settings over `DEFAULT_SETTINGS` (nested records recurse, arrays are leaves, not a deep clone). No imports. Used by `main.loadSettings` (`main.ts:285`) |
| `settings-merge.test.ts` | Tests | Merge semantics + pollution-key tests |
| `data-folder-migration.ts` | `migrateDataFolder`, `LEGACY_DATA_FOLDER`, `DATA_FOLDER` | One-time `.auto-notes/` -> `.synapse/` data-folder rename via `DataAdapter` (skip when absent, warn when both exist, `notifications.success`/`error` outcome). Imports `redact`, `notifications` (type). Called once at `main.ts:50` |
| `data-folder-migration.test.ts` | Tests | Rename / skip / conflict / failure paths |
| `json-utils.ts` | `parseJson`, `isRecord`, `asStringArray`, `readJsonFile` | Type-safe JSON helpers. `parseJson` returns `unknown` (not `any`). `readJsonFile` reads via `DataAdapter`, validates with a type guard, returns `null` on any failure |
| `node-loader.ts` | `loadNodeModules`, `assertDesktop`, `shellEnv`, `DesktopOnlyError`, `NodeModules` | Single sanctioned entry point for desktop-only Node.js builtins (os/path/fs/child_process). Lazy-loads inside function body so importing never triggers a module load on mobile. `shellEnv()` builds a narrowed subprocess environment with PATH augmented for common tool install locations |
| `settings-section.ts` | `createSettingsSectionContext`, `isSectionCollapsed`, `persistCollapse`, `SettingsSectionContext`, `SettingsSectionContextOptions`, `SectionRegistryEntry`, `FeatureToggleListener` | Shared accordion plumbing for the settings tab (#243). Feature renderers receive a `SettingsSectionContext` and call `featureSection()`/`configSection()` to build accordions without importing `settings-tab.ts` |
| `markdown.d.ts` | ambient `declare module '*.md'` | Types `import X from '*.md'` as a string (esbuild inlines the file at build time); used by `changelog-modal.ts` to bundle CHANGELOG.md (#375). Not part of the barrel |
| `index.ts` | re-exports | Barrel file |

## AIClient Provider Routing

`chat()` is the cache/coalescing wrapper (#397, see Public API); on a cache miss or `bypassCache` it calls
the private `dispatch()` shown below (behavior unchanged from the pre-cache `chat()`).

```
AIClient.chat(messages) --> dispatch(messages)
|-- resolveModelId(provider, model)
|     Anthropic: fable->claude-fable-5-1, opus->claude-opus-5, sonnet->claude-sonnet-5,
|                haiku->claude-haiku-4-5
|     Others: pass-through
|
|-- 'openai'    --> POST api.openai.com/v1/chat/completions
|                   Auth: Bearer {ai.apiKey}; sends max_completion_tokens (never max_tokens);
|                   temperature omitted for reasoning models
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
- Styling via `styles.css` classes (prefix `synapse-notice`), loaded/unloaded with the plugin
- Secret redaction on every error path via `redactSecrets` — `error()`, `notifyError()`, and the operation `error()` `console.error` all route through `showErrorNotice`/`redactSecrets`. Source ref: `notifications.ts:L295` (operation-error console sink), `notifications.ts:L431` (`error()`), `notifications.ts:L519` (`notifyError()`)
- `info()` and `success()` accept optional `action?: NoticeAction` 3rd param — renders an action button on the toast (floors duration to 8s, then auto-dismiss)
- `infoSticky(message, action)` — duration-0 dismissible action toast that stays up until the user clicks the action or clicks the toast; used by `UpdateChecker` for the "update available" prompt. Source ref: `notifications.ts:L405`
- `error(message)` — persistent (until clicked) error toast; clicking copies the redacted text to the clipboard. `notifyError(context, error)` wraps an error object + context label through the same sink
- `OperationHandle.finish(message?, action?)` accepts optional `action?: NoticeAction` — completion toast includes a button that runs `action.onClick()` then hides the toast
- `dispose()` — tears down every in-flight tracked operation (stops its `setInterval` + hides its notice, clears the map). Called from `main.ts` `onunload()` so disabling the plugin mid-operation never leaves an orphaned 400ms timer firing against a detached toast. Source ref: `notifications.ts:L170`
- One-shot `info()`/`success()`/`error()` calls WITHOUT an action are equal-message throttled within `NOTICE_THROTTLE_MS` (3s) via private `isThrottled` (#396): a second identical `${level}:${message}` toast inside the window is dropped (prevents per-item loop floods, e.g. a per-image notice). Tracked-operation toasts, `confirm()`, action notices (`showActionNotice`/`infoSticky`), and `notifyError()` are exempt. `dispose()` also clears the `lastShown` dedup map

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
| `AIClient` | elaboration/proposer, elaboration/image-analyzer, audio/post-processor, image/extractor, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index, summarize/summarizer, organize/content-analyzer, deep-dive/topic-analyzer, deep-dive/note-generator, rem/semantic-matcher, title/title-suggester |
| `redactSecrets` | ai-client (safeRequest error bodies + API-error wrap), credential-validator (probe error messages), credential-field (Test-button validation-catch chip message), update-checker (fetch-failure detail), notifications (`error`/`notifyError`/operation-error toast + console paths) |
| `redactError` | main (settings-migration console sink only, `main.ts:281`), shared/data-folder-migration, onboarding/onboarding (`runFirstRunOnboarding` catch), checkpoints/checkpoint-recovery, update-checker (unexpected-error catch), shared/transcript-cache, elaboration/proposer, elaboration/image-analyzer, audio/index, intake/index, rem/semantic-matcher, image/preprocess (downscale fallback), transcription/caption-strategy, transcription/youtube-captions, notifications (clipboard-copy catch), video/settings-section (clipboard-copy catch), fire-and-forget (every raw-error `console.warn`/`console.error` sink). Enforced by the `synapse/no-unredacted-console` lint rule (#418) |
| `withCacheReport` / `trackAiCache` / `transcriptCacheUse` / `mergeCacheUse` | audio/index, video/index, transcription/insert-url-transcript, summarize/index, tidy/index, elaboration/index, enrichment/index, deep-dive/index, organize/index, rem/index, title/index, image/index (#527 finish messages) |
| `reviewAction` | elaboration, enrichment, organize, deep-dive, title, rem (Review completion-toast gate, #366) |
| `hashString` / `contentKey` | ai-client (response cache key), elaboration/proposer + elaboration (proposal dedup content keys), title (title content keys) |
| `wrapUntrusted` | elaboration/proposer (fetched-link content + image-analysis prompt fencing) |
| `findAvailableVaultPath` | video/index (same-day re-download), title/index (duplicate "iterate" resolution, #408) |
| `migrateSettings` / `readSettingsVersion` / `CURRENT_SETTINGS_VERSION` | main (loadSettings migration runner), settings (DEFAULT_SETTINGS version stamp) |
| `deepMergeSettings` | main (`loadSettings`, `main.ts:285`: migrated raw record over `DEFAULT_SETTINGS`) |
| `migrateDataFolder` | main (`onload`, `main.ts:50`, right after `NotificationManager` construction) |
| `extractGeminiResponseText` | ai-client (callGemini), audio/transcriber (Gemini provider) |
| `arrayBufferToBase64` / `base64EncodedLength` | image/preprocess (re-exports), audio/transcriber (Gemini inline audio), elaboration/image-analyzer |
| `classifyNetworkError` / `describeNetworkError` | audio/transcriber (retry gating + failure disclosure) |
| `NotificationManager` | all feature modules (injected via `ModuleDeps`) |
| `CheckpointManager` | main (creates), elaboration, audio, video, image, enrichment, summarize, organize, deep-dive, rem (all injected via `ModuleDeps`) |
| `ModuleDeps` / `FeatureModule` / `FeatureSettingsKey` | every feature module (`implements FeatureModule`, `constructor(deps: ModuleDeps, ...)`), modules/registry (`FeatureModules` mapped over `FeatureSettingsKey`; construct/load/unload loops), main (builds the ONE `ModuleDeps`, `main.ts:60-67`), `__test-utils__/mock-factories.makeModuleDeps` |
| `NoteOperationQueue` | main (creates the ONE shared instance, `main.ts:56`), audio, video, image, elaboration, enrichment, title, summarize, tidy, organize, deep-dive (all injected via `ModuleDeps`), transcription/insert-url-transcript (`InsertUrlTranscriptDeps.noteQueue`) |
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
| `UpdateChecker` / `isNewerVersion` | main (instantiated with `UpdateCheckerDeps`; `maybeCheck()` fired from a delayed startup timer) |
| `linkLoadError` | summarize/index, elaboration/proposer (shared external-link fetch-failure message) |
| `fetchRedditContent` / `isRedditUrl` | summarize/index, elaboration/proposer (Reddit URL routing + fetch) |
| `isGenericTitle` | elaboration/proposer (anti-fabrication guard) |
| `isUntitled` | title/index, title/title-detector (re-export); elaboration/proposer |
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
