---
last-updated: 2026-03-12
---

# Shared Module

Cross-cutting utilities used by all feature modules: AI client, file operations, and API helpers.

## Public API

Exported from `index.ts`:

```ts
// ai-client.ts
class AIClient {
  constructor(getSettings: () => AutoNotesSettings)
  complete(prompt: string, systemPrompt?: string): Promise<string>
  chat(messages: ChatMessage[]): Promise<string>
}

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
| `ai-client.ts` | `AIClient`, `ChatMessage` | Multi-provider AI completion (OpenAI, Anthropic, Ollama) |
| `file-utils.ts` | `ensureFolder`, `readNote`, `writeNote`, `getMarkdownFiles`, `wordCount` | Vault file operations with path normalization |
| `api-utils.ts` | `withRetry`, `sleep`, `notifyError` | Retry with exponential backoff, error notification with key redaction |
| `validation.ts` | `sanitizeUrl`, `sanitizePath`, `ensureWithinVault`, `sanitizeAIResponse` | Input validation and output sanitization |
| `index.ts` | re-exports all | Barrel file |

## AIClient Provider Routing

```
AIClient.chat(messages)
├── 'openai'    → POST https://api.openai.com/v1/chat/completions
│                  Auth: Bearer {ai.apiKey}
│                  Uses: requestUrl (Obsidian)
├── 'anthropic' → POST https://api.anthropic.com/v1/messages
│                  Auth: x-api-key header, anthropic-version: 2023-06-01
│                  Extracts system message separately
│                  Uses: requestUrl (Obsidian)
└── 'ollama'    → POST {ai.ollamaEndpoint}/api/chat
                   No auth, stream: false
                   Validates endpoint: HTTPS required (HTTP allowed for localhost only)
                   Uses: requestUrl (Obsidian)
```

## Validation Utilities

```
sanitizeUrl(url)
├── Rejects null bytes
├── Parses URL (must be http/https)
└── Rejects shell metacharacters: ; | & ` $ ( ) { } ! \n \r

sanitizePath(filePath)
├── Rejects empty, null bytes
├── Rejects path traversal (..)
└── Rejects shell metacharacters

ensureWithinVault(filePath, vaultBasePath)
└── Resolves path, verifies it starts with vault base (prevents path escape)

sanitizeAIResponse(text)
├── Strips <script> tags and content
├── Strips HTML event handlers (onclick, onerror, etc.)
├── Strips javascript:/data:/vbscript: URIs in markdown links
└── Strips <iframe>/<embed>/<object> tags
```

## Consumers

| Utility | Used By |
|---------|---------|
| `AIClient` | `elaboration/proposer.ts`, `audio/post-processor.ts` |
| `writeNote` | `audio/index.ts`, `video/index.ts` |
| `ensureFolder` | `elaboration/proposal-store.ts`, `video/index.ts` |
| `readNote` | (available, not currently used) |
| `getMarkdownFiles` | (available, not currently used) |
| `wordCount` | `elaboration/detector.ts` |
| `notifyError` | `elaboration/index.ts`, `audio/index.ts`, `video/index.ts` |
| `withRetry` | (available, not currently used) |
| `sanitizeUrl` | `video/index.ts`, `video/audio-extractor.ts` |
| `sanitizePath` | `video/audio-extractor.ts` |
| `ensureWithinVault` | (available, not currently used) |
| `sanitizeAIResponse` | `elaboration/index.ts`, `audio/post-processor.ts` |

## Key Behaviors

- `writeNote`: creates parent folders automatically, updates existing file if path exists
- `ensureFolder`: no-op if folder already exists
- `wordCount`: splits on whitespace, filters empty strings
- `withRetry`: exponential backoff (delay * 2^attempt), default 3 retries / 1000ms base
- `notifyError`: shows Obsidian `Notice` and logs to `console.error` with `[Auto Notes]` prefix; redacts API keys/tokens from displayed messages
