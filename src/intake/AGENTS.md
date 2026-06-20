---
last-updated: 2026-06-19
---

# Intake Module

Watches a configurable intake folder and auto-processes newly added/settled notes (#111): routes each note (article URL / media URL / general), runs the full Synapse pipeline on it, stamps a processed flag, and optionally relocates it. Imports only `obsidian` and `src/shared/*`; all cross-module work goes through injected `IntakeDeps`.

## Public API

Exported from `index.ts`:

```ts
// index.ts
class IntakeModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, deps: IntakeDeps)
  onload(): Promise<void>    // registers vault create+modify listeners when intake.enabled
  onunload(): void           // clears all pending debounce timers
}

// types.ts
const SYNAPSE_PROCESSED_FLAG = 'synapse-processed'        // frontmatter idempotency flag
const SYNAPSE_PROCESSED_AT_FLAG = 'synapse-processed-at'  // ISO timestamp companion

type IntakeRoute =
  | { kind: 'transcription'; url: string; mediaType: 'video' | 'audio' }   // STUB (#112)
  | { kind: 'article'; url: string }                                        // fetch + append + pipeline
  | { kind: 'general' }                                                     // pipeline on note as-is

interface IntakeDeps {
  fireOnFile(file: TFile): Promise<void>                                    // run whole pipeline on ONE note
  transcribeUrlToNote(url: string, mediaType: 'video' | 'audio', file: TFile): Promise<void>  // STUB (#112)
}

// intake-dispatcher.ts
class IntakeDispatcher {
  route(file: TFile, parsed: ParsedNote): IntakeRoute   // classifies note into a route
}

// settings-section.ts
function renderIntakeSettings(ctx: SettingsSectionContext): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `IntakeModule`, `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG`, `renderIntakeSettings` | Barrel + folder watcher |
| `intake-dispatcher.ts` | `IntakeDispatcher` | Routes a parsed note to an `IntakeRoute` |
| `types.ts` | `IntakeRoute`, `IntakeDeps`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG` | Type model |
| `settings-section.ts` | `renderIntakeSettings` | Settings UI accordion (#243) |
| `intake-module.test.ts`, `intake-dispatcher.test.ts`, `intake-organize-e2e.test.ts`, `settings-section.test.ts` | Tests | |

## Data Flow

```
vault create/modify event
  --> handleEvent: cheap sync guards (is .md, intake.enabled, in intake folder,
                   not capture-log subfolder, not path-excluded, not in-flight)
  --> scheduleFlush(path): per-path debounce, resets timer on every event (settle window)
        settleWindowMs = intake.settleSeconds * 1000 (fallback 5000ms if missing/invalid)
  --> flush(path) after the note is quiet for the full window:
        read + parseFrontmatter
        idempotency guard: skip if SYNAPSE_PROCESSED_FLAG is truthy
        dispatcher.route(file, parsed) --> execute(file, route)
  --> execute:
        snapshot originalPath (organize mutates file.path on rename)
        transcription: deps.transcribeUrlToNote (STUB no-op)
        article:       fetchArticleContent(url) --> appendArticleContent --> deps.fireOnFile
        general:       deps.fireOnFile
        markProcessedAndMaybeMove --> optional writeCaptureBreadcrumb
```

## Processing Semantics

- Idempotency: a note carrying `synapse-processed` (boolean `true` or string `'true'`) is never reprocessed; this also suppresses the modify echo from the flag-stamp write.
- In-flight guard: paths being flushed are tracked so the stamp/move rename echo does not re-enter `flush`.
- Path exclusion: `isPathExcluded(file.path, 'intake', settings)` is checked before scheduling; excluded notes are silently skipped (#307).
- Primary mover is organize (last pipeline phase). `moveWhenDone` is a FALLBACK mover, applied only when organize left the note inside the intake folder (low-confidence / no-op).
- Stamp-before-move: the processed flag is written before any relocation so idempotency survives the move's rename echo.
- Failure leaves the note un-stamped (retriable); errors surface via `notifications.notifyError`.

## Capture Log (#224)

When `intake.captureLog` is true and a processed note actually left the intake folder, a dated breadcrumb
is written to `<intakeFolder>/<captureLogFolder>/<YYYY-MM-DD> — <title>.md` (default subfolder `_captured`).
The capture-log subfolder is excluded from the watcher and breadcrumbs are stamped `synapse-processed: true`
(defense-in-depth) so they are never re-ingested — preventing an infinite ingest loop.

Collision policy (#227): two distinct notes that sanitize to the same dated title get a uniqueness suffix
(` (2)`, ` (3)`, ...). Re-processing the same note overwrites its own breadcrumb idempotently.

## Settings Keys

All under `settings.intake` (`IntakeSettings`):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | true | Module activation (watcher registration) |
| `intakeFolder` | string | `'Inbox'` | Folder watched; empty/whitespace watches nothing |
| `markProcessed` | boolean | true | Stamp `synapse-processed` after processing |
| `moveWhenDone` | string? | `''` | Fallback destination when organize did not relocate the note |
| `settleSeconds` | number | 5 | Debounce settle window (seconds) before processing |
| `captureLog` | boolean | true | Write breadcrumb when a note is organized out of the intake folder |
| `captureLogFolder` | string | `'_captured'` | Breadcrumb subfolder (excluded from watcher) |

## Dependencies

| Import | From |
|--------|------|
| `NotificationManager`, `ensureFolder`, `fetchArticleContent`, `isPathExcluded`, `parseFrontmatter`, `serializeFrontmatter`, `writeNote`, `classifyUrl`, `extractUrls`, `ParsedNote`, `SettingsSectionContext` | `../shared` |
| `fireOnFile`, `transcribeUrlToNote` | injected via `IntakeDeps` (wired in `main.ts`) |

Architecture rule: intake imports no feature module. `fireOnFile` is `SynapseRunner.fireOnFile` injected by `main.ts`.
The transcription branch (`transcribeUrlToNote`) is a STUB (#112) and currently no-ops with a notice.
