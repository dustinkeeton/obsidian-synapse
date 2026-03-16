---
last-updated: 2026-03-16
---

# Shared Module

Cross-cutting utilities used by all feature modules: AI client, file operations, notifications, validation, and frontmatter parsing.

## Public API

Exported from `index.ts`:

```ts
// ai-client.ts
class AIClient {
  constructor(getSettings: () => AutoNotesSettings)
  complete(prompt: string, systemPrompt?: string): Promise<string>
  chat(messages: ChatMessage[]): Promise<string>
}

// types.ts
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

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
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `ai-client.ts` | `AIClient` | Multi-provider AI completion; `safeRequest`, `redactSecrets`, `resolveModelId` (internal) |
| `types.ts` | `ChatMessage` | Shared type |
| `notifications.ts` | `NotificationManager`, `OperationHandle`, `NoticeLevel` | Centralized notifications with cancellation, progress, confirmation snackbars |
| `notifications.test.ts` | Tests | NotificationManager tests |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `wordCount` | Vault file operations |
| `api-utils.ts` | `withRetry`, `sleep`, `notifyError` | Retry with exponential backoff, error display |
| `validation.ts` | `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse`, `blockquoteOriginal` | Input validation and output sanitization |
| `validation.test.ts` | Tests | Validation tests |
| `frontmatter-utils.ts` | `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `ParsedNote` | YAML frontmatter parsing and serialization |
| `frontmatter-utils.test.ts` | Tests | Frontmatter tests |
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

## Consumers

| Utility | Used By |
|---------|---------|
| `AIClient` | elaboration/proposer, audio/post-processor, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `NotificationManager` | all feature modules (injected via constructor) |
| `ensureFolder` | elaboration/proposal-store, enrichment/enrichment-store, tidy/tidy-store, video/index, organize/index, deep-dive/index |
| `wordCount` | elaboration/detector, deep-dive/index |
| `readNote` | deep-dive/index |
| `writeNote` | deep-dive/index |
| `sanitizeUrl` | video/index, video/audio-extractor |
| `sanitizePath` | video/audio-extractor |
| `sanitizeAIResponse` | elaboration/index, elaboration/proposer, audio/post-processor, enrichment/metadata-classifier, enrichment/topic-extractor, enrichment/prompt-builder, tidy/index |
| `parseFrontmatter` | enrichment/index, enrichment/enrichment-applier, tidy/index |
| `serializeFrontmatter` | enrichment/enrichment-applier, tidy/index |
| `mergeTags` | enrichment/enrichment-applier |
| `blockquoteOriginal` | elaboration/index |
| `withRetry` | tidy/index |
| `notifyError` | (legacy, replaced by NotificationManager in most modules) |
