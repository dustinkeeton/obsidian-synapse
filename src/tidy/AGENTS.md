---
last-updated: 2026-07-03
---

# Tidy Module

AI spelling correction and markdown formatting for notes with no content changes, plus single-snapshot undo.

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
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  tidy(file: TFile): Promise<void>
  // private undoTidy(file: TFile): Promise<void>
}

interface TidySnapshot {
  id: string            // generateId()
  filePath: string      // source note path
  originalContent: string
  createdAt: string     // ISO timestamp
}

function renderTidySettings(ctx: SettingsSectionContext): void
```

Re-exports from `index.ts`: type `TidySnapshot` (index.ts:L8), `renderTidySettings` (index.ts:L192).

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `index.ts` | `TidyModule`, `TidySnapshot` (re-export), `renderTidySettings` (re-export) | Orchestrator: commands, AI call, undo, vault scan |
| `types.ts` | `TidySnapshot` | Snapshot type for undo (types.ts:L2) |
| `tidy-store.ts` | `TidyStore` | One pre-tidy snapshot per file path |
| `settings-section.ts` | `renderTidySettings` | Tidy settings accordion (toggle only, no options) |
| `tidy-store.test.ts` | Tests | TidyStore tests |
| `tidy-module.test.ts` | Tests | TidyModule tests |
| `settings-section.test.ts` | Tests | Settings section tests |

## TidyStore (`tidy-store.ts`, internal)

```ts
class TidyStore {
  constructor(app: App, getSettings: () => SynapseSettings)
  init(): Promise<void>                                  // ensureFolder(folderPath)
  save(snapshot: TidySnapshot): Promise<void>            // adapter.write (overwrite)
  load(filePath: string): Promise<TidySnapshot | null>   // null if path is folder/missing
  remove(filePath: string): Promise<void>                // fileManager.trashFile (recoverable)
  // private folderPath(): string                        // settings.tidy.snapshotFolderPath
  // private snapshotPath(filePath: string): string
}
```

- Storage folder: `settings.tidy.snapshotFolderPath` (default `.synapse/tidy-snapshots`).
- One snapshot per file path; re-tidy overwrites the previous one.
- Filename (tidy-store.ts:L53): `filePath` with `/` and `\` → `__`, trailing `.md` stripped, `.json` appended.
- Write via `vault.adapter.write()` (overwrites regardless of prior existence).
- Delete via `app.fileManager.trashFile()` (respects user "Deleted files" preference; recoverable).

## Data Flow — tidy(file) (index.ts:L125)

```
startOperation("Tidying <basename>", "tidy-<path>")
1. vault.read(file) -> content
2. snapshot { id: generateId(), filePath, originalContent: content, createdAt: ISO }
   store.save(snapshot)                       -- snapshot taken before any write
3. parseFrontmatter(content) -> { frontmatter, body }
4. if !body.trim(): op.finish("Nothing to tidy — note is empty"); return
5. withRetry(() => aiClient.complete(body, SYSTEM_PROMPT), 3, 2000)
     SYSTEM_PROMPT (index.ts:L10) constrains AI to:
       - spelling correction only (no grammar/word-choice/meaning changes)
       - markdown formatting (lists, quotes, headers, code blocks, emphasis)
       - no content add/remove/rephrase; preserve frontmatter/links/tags/embeds
       - return raw markdown, no code fence, no commentary
6. sanitizeAIResponse(tidiedBody) -> stripCodeFences() -> cleaned
7. vault.process(file, data => {
     fm = parseFrontmatter(data).frontmatter
     return fm ? serializeFrontmatter(fm, cleaned) : cleaned
   })                                         -- atomic; frontmatter re-parsed from fresh content
8. op.finish("Note tidied")
catch: op.error("Tidy failed — <msg>")
```

## Data Flow — undoTidy(file) (index.ts:L176, private)

```
1. store.load(file.path) -> snapshot | null
2. if !snapshot: notifications.info("No tidy to undo for this note"); return
3. vault.process(file, () => snapshot.originalContent)
4. store.remove(file.path)                    -- trashes snapshot (recoverable)
5. notifications.success("Tidy undone")
```

Reachable in code only via the `undo-tidy` command, which is gated off (registry status `disabled`); not invokable from the palette today.

## Data Flow — scanVault(folderPath?, skipConfirmation?, onlyFile?) (index.ts:L76)

```
1. getMarkdownFiles(app, folderPath) -> allFiles
2. if onlyFile: filter to f.path === onlyFile.path        (per-file scoping, #111)
3. if allFiles.length === 0: return 0
4. if !skipConfirmation: confirm("Found N notes to tidy. Proceed?",
     { proceedLabel: "Tidy", cancelLabel: "Cancel" })
     if declined: info("Tidy scan skipped"); return 0
5. startOperation("Tidying notes", "tidy-vault")
6. for each file:
     if op.cancelled: break
     op.progress(i+1, total, "Tidying notes")
     if isPathExcluded(path, "tidy", settings): continue   (silent skip, #307)
     try { tidy(file); tidied++ } catch { console.warn(...) }
7. if !op.cancelled: op.finish("Tidied N notes")
8. return tidied
```

Note: tidy does NOT use `CheckpointManager`. The vault scan has no resume/checkpoint capability.

## Commands

Registry entries live in `src/commands/registry.ts`. Source ids are bare; Obsidian namespaces the runtime id as `synapse:<id>`. `TidyModule.onload()` calls `registrar.register(...)` for the two palette ids; the registrar only reaches `addCommand` when the registry status is `active`, the flow includes `palette`, and `tidy.enabled` is true.

| Id | Name | Status | Flow | Context | Handler | Registered when |
|----|------|--------|------|---------|---------|-----------------|
| `tidy-current-note` | Tidy current note | active | palette | note | editorCallback → `tidy(file)` | `tidy.enabled` true |
| `undo-tidy` | Undo last tidy on current note | disabled | palette | note | editorCallback → `undoTidy(file)` | never (gated off by status) |
| `tidy-vault` | Scan folder for notes to tidy | active | fire-synapse | vault | pipeline → `scanVault()` | synthetic; never passed to `register()` |

- `tidy-current-note` editorCallback (index.ts:L49): if `findMatchingRule(path, "tidy", settings)` matches, shows a Notice naming the rule pattern and skips; otherwise runs `tidy(file)`.
- `undo-tidy` is attempted in `onload()` (index.ts:L65) but its registry status is `disabled`, so `addCommand` is never called.
- `tidy-vault` (registry.ts:L66) is pipeline-only with `pipelineKey: 'tidy'`; Fire Synapse runs `scanVault()` vault-wide. It has no matching palette command (the palette `tidy-current-note` runs `tidy()` on one note — a different operation).

## Configuration

`TidySettings` (settings.ts:L178), under `settings.tidy`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module + palette command activation |
| `snapshotFolderPath` | `string` | `.synapse/tidy-snapshots` | Snapshot storage folder |

Path exclusion is centralized in `settings.exclusions: ExclusionRule[]` (#307). Tidy has no per-module `excludeFolders`/`excludeTags` field. Checked via `isPathExcluded(path, 'tidy', settings)` (batch, silent skip) and `findMatchingRule(path, 'tidy', settings)` (single-note, Notice) from `../shared`.

Settings UI: `renderTidySettings` (settings-section.ts:L7) renders an accordion with the enable toggle and a static empty-note placeholder — no configurable options.

## Error States

| Condition | Handling |
|-----------|----------|
| Empty note body | `op.finish("Nothing to tidy — note is empty")`; snapshot still saved, no write |
| AI call failure | `withRetry` 3 attempts / 2000ms backoff; on final failure `op.error("Tidy failed — <msg>")` |
| Per-file tidy failure in scan | caught; `console.warn`; scan continues to next file |
| `undoTidy` with no snapshot | `notifications.info("No tidy to undo for this note")` |
| Excluded single note | Notice naming the matched rule pattern; `tidy()` skipped |
| Excluded note in batch scan | silently skipped (`isPathExcluded`) |

## Dependencies

| Imports | From |
|---------|------|
| `Plugin`, `TFile`, `App` | `obsidian` |
| `AIClient`, `NotificationManager`, `getMarkdownFiles`, `parseFrontmatter`, `sanitizeAIResponse`, `stripCodeFences`, `serializeFrontmatter`, `withRetry`, `generateId`, `isPathExcluded`, `findMatchingRule`, `ensureFolder`, `SettingsSectionContext` | `../shared` |
| `CommandRegistrar` | `../commands` |
| `SynapseSettings` | `../settings` |
| `TidyStore` | `./tidy-store` |
| `TidySnapshot` | `./types` |

No `CheckpointManager` dependency. No `TidySettings` import (only `SynapseSettings`). No per-module exclusion fields.
