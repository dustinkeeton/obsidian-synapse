---
last-updated: 2026-03-19
---

# Shared Module

Cross-cutting utilities used by all feature modules: AI client, file operations, notifications, validation, frontmatter parsing, checkpoint management, and ID generation.

## Public API

Exported from `index.ts`:

```ts
// ai-client.ts
class AIClient {
  constructor(getSettings: () => SynapseSettings)
  complete(prompt: string, systemPrompt?: string): Promise<string>
  chat(messages: ChatMessage[]): Promise<string>
}

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
function withRetry<T>(fn: () => Promise<T>, maxRetries?: number, delayMs?: number): Promise<T>
function sleep(ms: number): Promise<void>
function notifyError(context: string, error: unknown): void

// validation.ts
function sanitizeUrl(url: string): string
function sanitizePath(filePath: string): string
function ensureWithinVault(filePath: string, vaultBasePath: string): string
function sanitizeAIResponse(text: string): string
function blockquoteOriginal(content: string): string

// frontmatter-utils.ts
interface ParsedNote { frontmatter: Record<string, unknown>; body: string; hasFrontmatter: boolean }
function parseFrontmatter(content: string): ParsedNote
function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string
function mergeTags(frontmatter: Record<string, unknown>, newTags: string[]): void

// callouts.ts
const CALLOUT_TYPES: { summary, transcription, enrichment, elaboration, deepDive, nav }
type CalloutType = 'synapse-summary' | 'synapse-transcription' | ...
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
type CheckpointModule = 'deep-dive' | 'elaboration' | 'enrichment' | 'audio' | 'video' | 'image' | 'summarize' | 'organize'
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
| `ai-client.ts` | `AIClient` | Multi-provider AI completion with multi-modal support; `safeRequest`, `redactSecrets`, `resolveModelId`, `toOpenAIContent`, `toAnthropicContent`, `toOllamaMessage` (internal) |
| `types.ts` | `ChatMessage`, `ContentBlock`, `TextContentBlock`, `ImageContentBlock` | Shared types including multi-modal content blocks |
| `notifications.ts` | `NotificationManager`, `OperationHandle`, `NoticeLevel` | Centralized notifications with cancellation, progress, confirmation snackbars |
| `notifications.test.ts` | Tests | NotificationManager tests |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `wordCount` | Vault file operations |
| `api-utils.ts` | `withRetry`, `sleep`, `notifyError` | Retry with exponential backoff, error display |
| `validation.ts` | `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse`, `blockquoteOriginal` | Input validation and output sanitization |
| `validation.test.ts` | Tests | Validation tests |
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
|-- 'ollama'    --> POST {ollamaEndpoint}/api/chat
|                   HTTPS required (HTTP for localhost only)
|
All use Obsidian requestUrl via safeRequest() (handles errors, redacts secrets)
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
| `ensureWithinVault` | paths resolving outside vault base |
| `sanitizeAIResponse` | script tags, event handlers, javascript/data/vbscript URIs, iframe/embed/object |
| `blockquoteOriginal` | (transforms) wraps body in blockquote, preserves frontmatter |
| `isValidCheckpointId` | anything not matching `/^[a-z0-9]+$/` |

## Consumers

| Utility | Used By |
|---------|---------|
| `AIClient` | elaboration/proposer, elaboration/image-analyzer, audio/post-processor, image/extractor, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `NotificationManager` | all feature modules (injected via constructor) |
| `CheckpointManager` | main (creates), elaboration, audio, video, image, enrichment, summarize, organize, deep-dive (all injected via constructor) |
| `ensureFolder` | elaboration/proposal-store, enrichment/enrichment-store, tidy/tidy-store, video/index, organize/index, deep-dive/index, checkpoint-manager |
| `wordCount` | elaboration/detector, deep-dive/index |
| `readNote` | deep-dive/index |
| `writeNote` | deep-dive/index, organize/index |
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
