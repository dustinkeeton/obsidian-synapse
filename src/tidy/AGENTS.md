---
last-updated: 2026-03-18
---

# Tidy Module

Spelling correction and markdown formatting for notes via AI. No content changes -- only fixes typos and applies structural formatting.

## Public API

Exported from `index.ts`:

```ts
class TidyModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  tidy(file: TFile): Promise<void>
}

interface TidySnapshot {
  id: string
  filePath: string
  originalContent: string
  createdAt: string
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `TidySnapshot` | Snapshot type for undo |
| `tidy-store.ts` | `TidyStore` | Stores pre-tidy snapshots (one per file) |
| `tidy-store.test.ts` | Tests | TidyStore tests |
| `tidy-module.test.ts` | Tests | TidyModule tests |
| `index.ts` | `TidyModule` | Orchestrator, commands, AI interaction |

## Data Flow

```
1. User triggers synapse:tidy-current-note
   |
2. TidyStore.save(snapshot) -- saves original content for undo
   |
3. parseFrontmatter(content) -- separate frontmatter from body
   |
4. AIClient.complete(body, SYSTEM_PROMPT) via withRetry(3, 2000ms)
   |  System prompt constrains AI to:
   |  - Spelling correction only (no grammar changes)
   |  - Markdown formatting (lists, headers, code blocks, emphasis)
   |  - No content addition/removal/rephrasing
   |
5. sanitizeAIResponse() --> stripCodeFences()
   |
6. serializeFrontmatter(original_frontmatter, tidied_body)
   |
7. vault.modify(file, finalContent)
```

## Undo Flow

```
1. User triggers synapse:undo-tidy
   |
2. TidyStore.load(filePath) -- retrieves snapshot
   |
3. vault.modify(file, snapshot.originalContent)
   |
4. TidyStore.remove(filePath)
```

## TidyStore

- Storage: `settings.tidy.snapshotFolderPath` (default: `.synapse/tidy-snapshots`)
- One snapshot per file path (overwrites previous)
- Filename: `{path-with-double-underscores}.json` (deterministic)
- Uses `vault.adapter.write()` for atomic overwrites

## Settings Keys

All under `settings.tidy`:

| Key | Controls |
|-----|----------|
| `enabled` | Module activation |
| `snapshotFolderPath` | Snapshot storage location |

## Dependencies

| Import | From |
|--------|------|
| `AIClient` | `shared/ai-client` |
| `NotificationManager` | `shared/notifications` |
| `parseFrontmatter`, `serializeFrontmatter` | `shared/frontmatter-utils` |
| `sanitizeAIResponse` | `shared/validation` |
| `withRetry` | `shared/api-utils` |
| `TidyStore` | `./tidy-store` |
