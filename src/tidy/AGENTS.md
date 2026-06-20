---
last-updated: 2026-06-19
---

# Tidy Module

Spelling correction and markdown formatting for notes via AI. No content changes — only fixes typos and applies structural formatting. Supports undo via pre-tidy snapshots.

## Public API (`index.ts`)

```ts
class TidyModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    registrar: CommandRegistrar
  )
  onload(): Promise<void>
  onunload(): void
  tidy(file: TFile): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
}

interface TidySnapshot {
  id: string
  filePath: string
  originalContent: string
  createdAt: string
}
```

Exported types: `TidySnapshot`

Exported functions: `renderTidySettings(ctx: SettingsSectionContext): void`

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `index.ts` | `TidyModule`, type + fn re-exports | Orchestrator, commands, AI interaction, undo |
| `types.ts` | `TidySnapshot` | Snapshot type for undo |
| `tidy-store.ts` | `TidyStore` | Stores pre-tidy snapshots (one per file path) |
| `settings-section.ts` | `renderTidySettings` | Tidy settings UI section (no configurable options; placeholder only) |
| `tidy-store.test.ts` | Tests | TidyStore tests |
| `tidy-module.test.ts` | Tests | TidyModule tests |
| `settings-section.test.ts` | Tests | Settings section tests |

## Data Flow

```
tidy(file)
  1. vault.read(file) --> content
  2. TidyStore.save(snapshot)        -- saves original for undo
  3. parseFrontmatter(content)       -- separate frontmatter from body
  4. withRetry(3, 2000ms):
       AIClient.complete(body, SYSTEM_PROMPT)
     System prompt constrains AI to:
       - Spelling correction only (no grammar/word choice/meaning changes)
       - Markdown formatting (lists, headers, code blocks, emphasis)
       - No content addition/removal/rephrasing
       - Preserve all links, tags, embeds, Obsidian syntax
  5. sanitizeAIResponse() --> stripCodeFences()
  6. vault.process(file, (data) => {
       fm = parseFrontmatter(data).frontmatter
       return fm ? serializeFrontmatter(fm, cleaned) : cleaned
     })                              -- atomic write; frontmatter re-parsed from fresh content
```

## Undo Flow

```
undoTidy(file)   [triggered by synapse:undo-tidy command]
  1. TidyStore.load(file.path) --> snapshot | null
  2. vault.process(file, () => snapshot.originalContent)
  3. TidyStore.remove(file.path)   -- trashes snapshot file (recoverable)
```

## Vault Scan

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)
  --> getMarkdownFiles(app, folderPath)
  --> if onlyFile: narrow to single file
  --> optional confirmation prompt
  --> for each file:
        isPathExcluded(path, 'tidy', settings) --> skip silently (batch)
        findMatchingRule(path, 'tidy', settings) --> named in Notice (single-note command)
        tidy(file)
  --> returns count of tidied files
```

Note: `tidy` module does NOT use `CheckpointManager`. Vault scan has no resume capability.

## TidyStore

- Storage path: `settings.tidy.snapshotFolderPath` (default: `.synapse/tidy-snapshots`)
- One snapshot per file path (overwrites previous on re-tidy)
- Filename: `{path-with-double-underscores}.json` (deterministic, no collisions)
- Write: `vault.adapter.write()` (atomic overwrite)
- Delete: `app.fileManager.trashFile()` (respects user's "Deleted files" preference; recoverable)

## Commands

Registered in `onload()` (both gated by `tidy.enabled`):

| ID | Name | Type |
|----|------|------|
| `synapse:tidy-current-note` | Tidy current note | editorCallback |
| `synapse:undo-tidy` | Undo last tidy on current note | editorCallback |

Single-note command shows an exclusion Notice naming the matched rule. Batch scan silently skips.

## Settings Keys

All under `settings.tidy` (`TidySettings`):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | — | Module + command activation |
| `snapshotFolderPath` | `string` | `.synapse/tidy-snapshots` | Snapshot storage location |

Path exclusion: centralized `settings.exclusions: ExclusionRule[]` (#307). No per-module `excludeFolders` field and no `excludeTags` field. Checked via `isPathExcluded(path, 'tidy', settings)` and `findMatchingRule(path, 'tidy', settings)` from `shared`.

## Dependencies

| Import | From |
|--------|------|
| `AIClient`, `NotificationManager`, `getMarkdownFiles`, `parseFrontmatter`, `sanitizeAIResponse`, `stripCodeFences`, `serializeFrontmatter`, `withRetry`, `generateId`, `isPathExcluded`, `findMatchingRule` | `../shared` |
| `CommandRegistrar` | `../commands` |
| `SynapseSettings`, `TidySettings` | `../settings` |
| `TidyStore` | `./tidy-store` |

No `CheckpointManager` dependency. No `excludeTags` per-module field.
