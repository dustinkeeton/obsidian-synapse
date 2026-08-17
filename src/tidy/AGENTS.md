---
last-updated: 2026-08-17
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
    registrar: CommandRegistrar,
    noteQueue: NoteOperationQueue      // #483, after registrar
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

Re-exports from `index.ts`: type `TidySnapshot` (index.ts:9), `renderTidySettings` (index.ts:209).

## Note Queue (#483)

Tidy is the sharpest lost-update case in the codebase: its write is a whole-note replace
(`vault.process(file, () => cleaned)`, index.ts:177) computed from a read taken BEFORE a
multi-second AI call. Unserialized, a tidy silently deletes anything that landed during that
call (its pre-AI snapshot never contained it, and its write replaces everything).

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`. Acquisition sites:

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `tidy(file)` (index.ts:136) | `file.path` | `runTidy(file, op)` | `op.update("Waiting for another Synapse operation on <basename>")` |
| `undoTidy(file)` (index.ts:199) | `file.path` | inline restore + snapshot removal | none (silent — the restore is instant) |

`scanVault` calls the PUBLIC `tidy` per file (index.ts:112), so the batch takes one slot per
note, never one per batch. `runTidy` acquires nothing — it already holds the slot.

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `index.ts` | `TidyModule`, `TidySnapshot` (re-export), `renderTidySettings` (re-export) | Orchestrator: commands, AI call, undo, vault scan |
| `types.ts` | `TidySnapshot` | Snapshot type for undo (types.ts:L2) |
| `tidy-store.ts` | `TidyStore` | One pre-tidy snapshot per file path |
| `settings-section.ts` | `renderTidySettings` | Tidy settings accordion (toggle only, no options) |
| `tidy-store.test.ts` | Tests | TidyStore tests |
| `tidy-module.test.ts` | Tests | TidyModule tests |
| `tidy-transcription-race.test.ts` | Tests | Regression (#483): a tidy submitted while an audio transcription is in flight for the same note serializes behind it, writes second (`writeOrder === ['transcription','tidy']`), tidies the transcript-inclusive body, and preserves the transcript. CONTROL case drives the identical interleaving with `AudioModule`/`TidyModule` on SEPARATE `NoteOperationQueue` instances (pre-#483 topology) and asserts the transcript IS lost — that is what makes the other assertions meaningful |
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

## Data Flow — tidy(file) (index.ts:127)

```
startOperation("Tidying <basename>", "tidy-<path>")
noteQueue.run(file.path, () => runTidy(file, op), { onWait })   -- index.ts:136
  |
  v  runTidy(file, op)  (index.ts:142, holds the slot for the whole cycle)
1. vault.read(file) -> content
2. snapshot { id: generateId(), filePath, originalContent: content, createdAt: ISO }
   store.save(snapshot)                       -- snapshot taken before any write
3. parseFrontmatter(content) -> { frontmatter, body }
4. if !body.trim(): op.finish("Nothing to tidy — note is empty"); return
5. withRetry(() => aiClient.complete(body, SYSTEM_PROMPT), 3, 2000)
     SYSTEM_PROMPT (index.ts:11) constrains AI to:
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

## Data Flow — undoTidy(file) (index.ts:188, private)

```
1. store.load(file.path) -> snapshot | null
2. if !snapshot: notifications.info("No tidy to undo for this note"); return
3. noteQueue.run(file.path, ...)              -- index.ts:199, silent (no onWait)
     3a. vault.process(file, () => snapshot.originalContent)
     3b. store.remove(file.path)              -- trashes snapshot (recoverable)
     3c. notifications.success("Tidy undone")
```

Reachable in code only via the `undo-tidy` command, which is gated off (registry status `disabled`); not invokable from the palette today.

## Data Flow — scanVault(folderPath?, skipConfirmation?, onlyFile?) (index.ts:78)

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
        (public tidy => one queue slot per note, index.ts:112)
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

- `tidy-current-note` editorCallback (index.ts:52): if `findMatchingRule(path, "tidy", settings)` matches, shows a Notice naming the rule pattern and skips; otherwise runs `tidy(file)`.
- `undo-tidy` is attempted in `onload()` (index.ts:67) but its registry status is `disabled`, so `addCommand` is never called.
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
| `AIClient`, `NotificationManager`, `NoteOperationQueue`, `getMarkdownFiles`, `parseFrontmatter`, `sanitizeAIResponse`, `stripCodeFences`, `serializeFrontmatter`, `withRetry`, `generateId`, `isPathExcluded`, `findMatchingRule`, `ensureFolder`, `SettingsSectionContext` | `../shared` |
| `OperationHandle` | `../shared` (type-only, index.ts:5) |
| `CommandRegistrar` | `../commands` |
| `SynapseSettings` | `../settings` |
| `TidyStore` | `./tidy-store` |
| `TidySnapshot` | `./types` |

No `CheckpointManager` dependency. No `TidySettings` import (only `SynapseSettings`). No per-module exclusion fields.
