---
last-updated: 2026-03-12
---

# Shared Module

Cross-cutting utilities used by all feature modules: AI client, file operations, API helpers, and input/output validation.

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
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
```

## Internal Files

| File | Exports | Purpose |
|------|---------|---------|
| `ai-client.ts` | `AIClient` | Multi-provider AI completion with model ID resolution; `safeRequest` wrapper; `redactSecrets` |
| `types.ts` | `ChatMessage` | Shared type definitions |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `wordCount` | Vault file operations with path normalization |
| `api-utils.ts` | `withRetry`, `sleep`, `notifyError` | Retry with exponential backoff, error notification with key redaction |
| `validation.ts` | `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse` | Input validation and output sanitization |
| `index.ts` | re-exports all public symbols | Barrel file |

## AIClient Provider Routing

```
AIClient.chat(messages)
|-- resolveModelId(provider, model) -- maps simplified names to API IDs
|
|-- 'openai'    -> POST https://api.openai.com/v1/chat/completions
|                   Auth: Bearer {ai.apiKey}
|                   Body: { model, messages, max_tokens, temperature }
|                   Uses: requestUrl (Obsidian) via safeRequest()
|-- 'anthropic' -> POST https://api.anthropic.com/v1/messages
|                   Auth: x-api-key header, anthropic-version: 2023-06-01
|                   Extracts system message into top-level 'system' field
|                   Uses: requestUrl (Obsidian) via safeRequest()
|-- 'ollama'    -> POST {ai.ollamaEndpoint}/api/chat
|                   No auth, stream: false
|                   Validates endpoint: HTTPS required (HTTP for localhost only)
|                   Uses: requestUrl (Obsidian) via safeRequest()
```

## Model ID Resolution

```ts
// ai-client.ts (module-level, not exported)
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
}

function resolveModelId(provider: string, model: string): string
// Returns ANTHROPIC_MODEL_MAP[model] for anthropic provider, otherwise pass-through.
```

## safeRequest Wrapper

```ts
// ai-client.ts (module-level, not exported)
async function safeRequest(options: RequestUrlParam): Promise<RequestUrlResponse>
// Wraps Obsidian requestUrl with throw: false
// On status >= 400: extracts error message, redacts API keys via redactSecrets(), throws Error
```

## Validation Utilities

```
sanitizeUrl(url)
|-- Rejects null bytes
|-- Parses URL (must be http or https)
|-- Rejects shell metacharacters: ; | & ` $ ( ) { } ! \n \r

sanitizePath(filePath)
|-- Rejects empty, null bytes
|-- Rejects path traversal (..)
|-- Rejects shell metacharacters

ensureWithinVault(filePath, vaultBasePath)
|-- Resolves path via path.resolve()
|-- Verifies resolved path starts with vault base directory

sanitizeAIResponse(text)
|-- Strips <script> tags and content
|-- Strips HTML event handlers (onclick, onerror, etc.)
|-- Strips javascript:/data:/vbscript: URIs in markdown links
|-- Strips <iframe>/<embed>/<object> tags
```

## Consumers

| Utility | Used By |
|---------|---------|
| `AIClient` | `elaboration/proposer.ts`, `audio/post-processor.ts` |
| `writeNote` | `audio/index.ts`, `video/index.ts` |
| `ensureFolder` | `elaboration/proposal-store.ts`, `video/index.ts` |
| `readNote` | (exported, not currently used) |
| `getMarkdownFiles` | (exported, not currently used) |
| `wordCount` | `elaboration/detector.ts` |
| `notifyError` | `elaboration/index.ts`, `audio/index.ts`, `video/index.ts` |
| `withRetry` | (exported, not currently used) |
| `sanitizeUrl` | `video/index.ts`, `video/audio-extractor.ts` |
| `sanitizePath` | `video/audio-extractor.ts` |
| `ensureWithinVault` | (exported, not currently used) |
| `sanitizeAIResponse` | `elaboration/index.ts` (acceptProposal, showProposalDetail), `elaboration/proposer.ts`, `audio/post-processor.ts` |

## Key Behaviors

- `writeNote`: creates parent folders via `ensureFolder`, updates existing file if path exists, returns `TFile`
- `ensureFolder`: no-op if folder already exists; catches "Folder already exists" error for vault cache race
- `wordCount`: splits on `\s+`, filters empty strings
- `withRetry`: exponential backoff (`delay * 2^attempt`), default 3 retries / 1000ms base
- `notifyError`: shows Obsidian `Notice` and logs to `console.error` with `[Auto Notes]` prefix; redacts API keys/tokens matching `sk-`, `key-`, `dg-`, `anthropic-`, `Bearer`, `Token` patterns
- `redactSecrets` (in ai-client.ts): same redaction patterns, applied to API error response bodies before throwing
