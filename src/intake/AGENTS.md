---
last-updated: 2026-07-03
---

# Intake Module

Watches a configurable intake folder and auto-processes newly added/settled notes (#111): routes each note (transcription URL / article URL / general), runs the full Synapse pipeline on it, stamps a processed flag, and optionally relocates it. Imports only `obsidian`, `src/shared/*`, and the `SynapseSettings` type; all cross-module work goes through injected `IntakeDeps`.

## Public API

Exported from `index.ts`:

```ts
// index.ts:58 — class IntakeModule
class IntakeModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    deps: IntakeDeps,
  )
  onload(): Promise<void>    // index.ts:78 — registers vault create+modify listeners when intake.enabled
  onunload(): void           // index.ts:93 — clears all debounce timers + pending/inFlight sets
}

// types.ts:9 / types.ts:12
const SYNAPSE_PROCESSED_FLAG = 'synapse-processed'        // frontmatter idempotency flag
const SYNAPSE_PROCESSED_AT_FLAG = 'synapse-processed-at'  // ISO timestamp companion

// types.ts:19
type IntakeRoute =
  | { kind: 'transcription'; url: string; mediaType: 'video' | 'audio' }   // STUB (#112)
  | { kind: 'article'; url: string }                                        // fetch + append + pipeline
  | { kind: 'general' }                                                     // pipeline on note as-is

// types.ts:46
interface IntakeDeps {
  fireOnFile(file: TFile): Promise<void>                                    // run whole pipeline on ONE note
  transcribeUrlToNote(url: string, mediaType: 'video' | 'audio', file: TFile): Promise<void>  // STUB (#112)
}

// intake-dispatcher.ts:18
class IntakeDispatcher {
  route(file: TFile, parsed: ParsedNote): IntakeRoute   // intake-dispatcher.ts:25 — classify note into a route
}

// settings-section.ts:7
function renderIntakeSettings(ctx: SettingsSectionContext): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `IntakeModule`, `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG`, `renderIntakeSettings` | Barrel + folder watcher |
| `intake-dispatcher.ts` | `IntakeDispatcher` | Pure routing of a parsed note to an `IntakeRoute` |
| `types.ts` | `IntakeRoute`, `IntakeDeps`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG` | Type model |
| `settings-section.ts` | `renderIntakeSettings` | Settings UI accordion (#243) |
| `intake-module.test.ts`, `intake-dispatcher.test.ts`, `intake-organize-e2e.test.ts`, `settings-section.test.ts` | Tests | |

Note: `index.ts` re-exports `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute`, and both flags from their source files; `IntakeModule` is the module's primary public class.

## Routing Table

`IntakeDispatcher.route` (intake-dispatcher.ts:25) maps a note to a branch. A note is "bare URL" only when the body contains exactly one URL and nothing but whitespace remains after removing it (`bareUrl`, intake-dispatcher.ts:55). The URL is then classified via `classifyUrl`.

| Body shape | `classifyUrl` type | Route `kind` | Branch (execute, index.ts:277) |
|------------|--------------------|--------------|--------------------------------|
| Not a bare URL (prose / 0 / multiple URLs) | — | `general` | `deps.fireOnFile` |
| Bare URL | `video` or `audio` | `transcription` | `deps.transcribeUrlToNote` (STUB no-op) |
| Bare URL | `article` | `article` | `fetchArticleContent` → append → `deps.fireOnFile` |
| Bare URL | `unknown` (or default) | `general` | `deps.fireOnFile` |

## Data Flow

```
vault create/modify event
  --> handleEvent (index.ts:107): cheap sync guards, cheapest-first:
        is TFile && .md  -->  intake.enabled  -->  isInIntakeFolder
        (excludes capture-log subfolder)  -->  not isPathExcluded(...,'intake',...)
        -->  not inFlight
  --> scheduleFlush(path) (index.ts:189): per-path debounce, resets timer on every event
        settleWindowMs (index.ts:212) = intake.settleSeconds * 1000
        (fallback DEBOUNCE_MS=5000ms when missing/not a positive number, index.ts:37)
  --> flush(path) (index.ts:225) after the note is quiet for the full window:
        read + parseFrontmatter
        idempotency guard (isProcessed, index.ts:260): skip if SYNAPSE_PROCESSED_FLAG truthy
        dispatcher.route(file, parsed) --> execute(file, route)
  --> execute (index.ts:277):
        snapshot originalPath (organize mutates file.path on rename)
        transcription: deps.transcribeUrlToNote (STUB no-op)
        article:       fetchArticleContent(url) --> appendArticleContent --> deps.fireOnFile
        general:       deps.fireOnFile
        markProcessedAndMaybeMove (index.ts:355) --> optional writeCaptureBreadcrumb (index.ts:449)
```

## Processing Semantics

- Idempotency: a note carrying `synapse-processed` (boolean `true` or string `'true'`) is never reprocessed; this also suppresses the modify echo from the flag-stamp write.
- In-flight guard: paths being flushed are tracked in `inFlight` (keyed on originalPath) so the stamp/move rename echo does not re-enter `flush`.
- Path exclusion: `isPathExcluded(file.path, 'intake', settings)` is checked before scheduling; excluded notes are silently skipped (#307).
- Primary mover is organize (last pipeline phase inside `fireOnFile`). `moveWhenDone` is a FALLBACK mover (index.ts:355), applied only when organize left the note inside the intake folder (low confidence / no-op).
- Stamp-before-move: the processed flag is written before any relocation (`stampProcessed`, index.ts:401) so idempotency survives the move's rename echo.
- `moveNote` (index.ts:414) uses `fileManager.renameFile` so inbound links stay intact and `ensureFolder` to create the destination.

## Capture Log (#224)

When `intake.captureLog` is true and a processed note actually left the intake folder (`movedOutOfIntake`, index.ts:392), a dated breadcrumb is written to `<intakeFolder>/<captureLogFolder>/<YYYY-MM-DD> — <title>.md` (default subfolder `_captured`). The capture-log subfolder is excluded from the watcher (`isInIntakeFolder`, index.ts:148) and breadcrumbs are stamped `synapse-processed: true` (defense-in-depth) so they are never re-ingested — preventing an infinite ingest loop.

Collision policy (#227, `resolveBreadcrumbPath`, index.ts:495): two distinct notes that sanitize to the same dated title get a uniqueness suffix (` (2)`, ` (3)`, ...). Re-processing the same note overwrites its own breadcrumb idempotently (`breadcrumbTargets`, index.ts:527).

## Configuration

All under `settings.intake` (`IntakeSettings`, settings.ts:236; defaults `DEFAULT_SETTINGS.intake`, settings.ts:508):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | `true` | Module activation (watcher registration) |
| `intakeFolder` | string | `'Inbox'` | Folder watched; empty/whitespace watches nothing |
| `markProcessed` | boolean | `true` | Stamp `synapse-processed` after processing |
| `moveWhenDone` | string \| undefined | `''` | Fallback destination when organize did not relocate the note |
| `settleSeconds` | number | `5` | Debounce settle window (seconds) before processing |
| `captureLog` | boolean | `true` | Write breadcrumb when a note is organized out of the intake folder |
| `captureLogFolder` | string | `'_captured'` | Breadcrumb subfolder (excluded from watcher) |

## Error States

| Condition | Handling |
|-----------|----------|
| File vanished before flush | `flush` returns silently (index.ts:226) |
| Note already processed | `flush` returns before routing (idempotency, index.ts:237) |
| Processing throws (fetch/pipeline) | Caught in `flush`; note left un-stamped (retriable); surfaced via `notifications.notifyError` (index.ts:243) |
| Breadcrumb read fails during collision check | Treated as "not ours" → falls through to a suffix rather than clobbering (`breadcrumbTargets`, index.ts:531) |
| Empty/whitespace `intakeFolder` | Watches nothing; `isInIntakeFolder` returns false (index.ts:149) |

## Dependencies

| Import | From |
|--------|------|
| `Plugin`, `TFile`, `TAbstractFile`, `normalizePath`, `Setting` | `obsidian` |
| `NotificationManager`, `ensureFolder`, `fetchArticleContent`, `isPathExcluded`, `parseFrontmatter`, `serializeFrontmatter`, `writeNote`, `classifyUrl`, `extractUrls`, `ParsedNote`, `SettingsSectionContext` | `../shared` |
| `SynapseSettings` (type) | `../settings` |
| `fireOnFile`, `transcribeUrlToNote` | injected via `IntakeDeps` (wired in `main.ts`) |

Architecture rule: intake imports no feature module — only `obsidian`, `src/shared/*`, and the `SynapseSettings` type. `fireOnFile` is `SynapseRunner.fireOnFile` injected by `main.ts`. The transcription branch (`transcribeUrlToNote`) is a STUB (#112) and currently no-ops with a notice.
