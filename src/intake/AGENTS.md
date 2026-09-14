---
last-updated: 2026-09-14
---

# Intake Module

Watches a configurable intake folder and auto-processes newly added/settled notes (#111): routes each note (transcription URL / article URL / general), runs the full Synapse pipeline on it, stamps a processed flag, and optionally relocates it. Opt-in adoption of root-level shared captures (#455). Imports only `obsidian`, `src/shared/*`, and the `SynapseSettings` type; all cross-module work goes through injected `IntakeDeps`.

## Public API

Exported from `index.ts` (`index.ts:22-30`, `index.ts:640`):

```ts
// index.ts:59 — class IntakeModule
class IntakeModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    deps: IntakeDeps,
  )
  onload(): Promise<void>    // index.ts:79 — registers vault create+modify listeners when intake.enabled
  onunload(): void           // index.ts:94 — clears all debounce timers + pending/inFlight sets
}

// types.ts:9 / types.ts:12
const SYNAPSE_PROCESSED_FLAG = 'synapse-processed'        // frontmatter idempotency flag
const SYNAPSE_PROCESSED_AT_FLAG = 'synapse-processed-at'  // ISO timestamp companion

// types.ts:19
type IntakeRoute =
  | { kind: 'transcription'; url: string; mediaType: 'video' | 'audio' }   // tiered URL transcription (#112/#184)
  | { kind: 'article'; url: string }                                        // fetch + append + pipeline
  | { kind: 'general' }                                                     // pipeline on note as-is

// types.ts:46
interface IntakeDeps {
  fireOnFile(file: TFile): Promise<void>                                    // run whole pipeline on ONE note
  transcribeUrlToNote(url: string, mediaType: 'video' | 'audio', file: TFile): Promise<void>
    // MUST throw on failure or when no tier handles the URL (note stays un-stamped/retriable)
}

// intake-dispatcher.ts:18
class IntakeDispatcher {
  route(file: TFile, parsed: ParsedNote): IntakeRoute   // intake-dispatcher.ts:25 — classify note into a route
  bareUrl(body: string): string | null                  // intake-dispatcher.ts:58 — single-URL body test; reused by adoption (#455)
}

// settings-section.ts:7
function renderIntakeSettings(ctx: SettingsSectionContext): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `IntakeModule`, `IntakeDispatcher`, `IntakeDeps`, `IntakeRoute`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG`, `renderIntakeSettings` | Barrel + folder watcher + shared-capture adoption |
| `intake-dispatcher.ts` | `IntakeDispatcher` | Pure routing of a parsed note to an `IntakeRoute` |
| `types.ts` | `IntakeRoute`, `IntakeDeps`, `SYNAPSE_PROCESSED_FLAG`, `SYNAPSE_PROCESSED_AT_FLAG` | Type model |
| `settings-section.ts` | `renderIntakeSettings` | Settings UI accordion (#243) |
| `intake-module.test.ts`, `intake-dispatcher.test.ts`, `intake-organize-e2e.test.ts`, `settings-section.test.ts` | Tests | |

## Routing Table

`IntakeDispatcher.route` (intake-dispatcher.ts:25) maps a note to a branch. A note is "bare URL" only when the body contains exactly one URL and nothing but whitespace remains after removing it (`bareUrl`, intake-dispatcher.ts:58). The URL is then classified via `classifyUrl`.

| Body shape | `classifyUrl` type | Route `kind` | Branch (execute, index.ts:349) |
|------------|--------------------|--------------|--------------------------------|
| Not a bare URL (prose / 0 / multiple URLs) | — | `general` | `deps.fireOnFile` |
| Bare URL | `video` or `audio` | `transcription` | `deps.transcribeUrlToNote` → `deps.fireOnFile` |
| Bare URL | `article` | `article` | `fetchArticleContent` → append → `deps.fireOnFile` |
| Bare URL | `unknown` (or default) | `general` | `deps.fireOnFile` |

## Data Flow

```
vault create/modify event
  --> handleEvent (index.ts:114): cheap sync guards, cheapest-first:
        is TFile && .md  -->  intake.enabled
        -->  isInIntakeFolder (index.ts:174; excludes capture-log subfolder)
             OR isAdoptionCandidate (index.ts:152; #455)
        -->  not isPathExcluded(...,'intake',...)  -->  not inFlight
  --> scheduleFlush(path) (index.ts:215): per-path debounce, resets timer on every event
        settleWindowMs (index.ts:238) = intake.settleSeconds * 1000
        (fallback DEBOUNCE_MS=5000ms when missing/not a positive number, index.ts:38)
  --> flush(path) (index.ts:251) after the note is quiet for the full window:
        path outside intake folder --> maybeAdoptCapture(file) (index.ts:295), return
        read + parseFrontmatter
        idempotency guard (isProcessed, index.ts:332): skip if SYNAPSE_PROCESSED_FLAG truthy
        dispatcher.route(file, parsed) --> execute(file, route)
  --> execute (index.ts:349):
        snapshot originalPath (organize mutates file.path on rename)
        transcription: deps.transcribeUrlToNote(url, mediaType, file) --> deps.fireOnFile
        article:       fetchArticleContent(url) --> appendArticleContent (index.ts:396) --> deps.fireOnFile
        general:       deps.fireOnFile
        markProcessedAndMaybeMove (index.ts:427) --> optional writeCaptureBreadcrumb (index.ts:521)
```

`transcribeUrlToNote` implementation (main.ts:466-489): `UrlTranscriptionRouter.transcribe(url)` → `buildUrlTranscriptBlock(result, url, video.embedInNote)` → `vault.process` append; on error the operation toast reports and the error is rethrown so the note stays un-stamped.

## Shared-Capture Adoption (#455)

Off by default (`intake.adoptSharedCaptures`). Targets Obsidian's mobile share receiver, which creates the note at the vault root.

- `isAdoptionCandidate` (index.ts:152): `adoptSharedCaptures === true` AND event kind is `create` (never `modify`) AND path has no `/` (vault root) AND `intakeFolder` is non-blank.
- `maybeAdoptCapture` (index.ts:295): re-checks the toggle; skips already-stamped notes; requires `dispatcher.bareUrl(body)` non-null AND `classifyUrl(url).type !== 'unknown'`; then `moveNote(file, intakeFolder)` and `scheduleFlush(file.path)` (a rename fires no create/modify event, so the adopted note is re-queued explicitly).
- Anything else (prose, multiple URLs, unclassifiable link) is left where the user created it.
- Failure → `notifications.notifyError('Could not adopt shared capture ...')` (index.ts:319); the note is not moved.

## Processing Semantics

- Idempotency: a note carrying `synapse-processed` (boolean `true` or string `'true'`) is never reprocessed; this also suppresses the modify echo from the flag-stamp write.
- In-flight guard: paths being flushed are tracked in `inFlight` (keyed on originalPath) so the stamp/move rename echo does not re-enter `flush`.
- Path exclusion: `isPathExcluded(file.path, 'intake', settings)` is checked before scheduling; excluded notes are silently skipped (#307).
- Primary mover is organize (last pipeline phase inside `fireOnFile`). `moveWhenDone` is a FALLBACK mover (index.ts:427), applied only when organize left the note inside the intake folder (low confidence / no-op).
- Stamp-before-move: the processed flag is written before any relocation (`stampProcessed`, index.ts:473) so idempotency survives the move's rename echo.
- `moveNote` (index.ts:486) uses `fileManager.renameFile` so inbound links stay intact and `ensureFolder` to create the destination.
- Unqueued by design: stamp/move/breadcrumb writes run after every pipeline phase has released the note's `NoteOperationQueue` slot; `vault.process` callbacks re-derive from fresh content.

## Capture Log (#224)

When `intake.captureLog` is true and a processed note actually left the intake folder (`movedOutOfIntake`, index.ts:464), a dated breadcrumb is written to `<intakeFolder>/<captureLogFolder>/<YYYY-MM-DD> — <title>.md` (default subfolder `_captured`). The capture-log subfolder is excluded from the watcher (`isInIntakeFolder`, index.ts:174; `captureLogPath`, index.ts:200) and breadcrumbs are stamped `synapse-processed: true` (defense-in-depth) so they are never re-ingested.

Collision policy (#227, `resolveBreadcrumbPath`, index.ts:567): two distinct notes that sanitize to the same dated title get a uniqueness suffix (` (2)`, ` (3)`, ...). Re-processing the same note overwrites its own breadcrumb idempotently (`breadcrumbTargets`, index.ts:599).

## Configuration

All under `settings.intake` (`IntakeSettings`, settings.ts:243; defaults `DEFAULT_SETTINGS.intake`, settings.ts:527):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | `true` | Module activation (watcher registration) |
| `intakeFolder` | string | `'Inbox'` | Folder watched; empty/whitespace watches nothing |
| `markProcessed` | boolean | `true` | Stamp `synapse-processed` after processing |
| `moveWhenDone` | string \| undefined | `''` | Fallback destination when organize did not relocate the note |
| `settleSeconds` | number | `5` | Debounce settle window (seconds) before processing |
| `captureLog` | boolean | `true` | Write breadcrumb when a note is organized out of the intake folder |
| `captureLogFolder` | string | `'_captured'` | Breadcrumb subfolder (excluded from watcher) |
| `adoptSharedCaptures` | boolean | `false` | Also watch newly created root-level bare-URL notes and move them into `intakeFolder` (#455); settings row `settings-section.ts:52` |

## Error States

| Condition | Handling |
|-----------|----------|
| File vanished before flush | `flush` returns silently (index.ts:253-255) |
| Note already processed | `flush` returns before routing (idempotency, index.ts:271) |
| Processing throws (transcription/fetch/pipeline) | Caught in `flush`; note left un-stamped (retriable); surfaced via `notifications.notifyError` (index.ts:278) |
| No transcription tier for the URL (e.g. TikTok on mobile) | `transcribeUrlToNote` rethrows `NoTranscriptionPathError`; same un-stamped/retriable path; a synced desktop vault's watcher finishes it |
| Adoption read/move fails | Caught in `maybeAdoptCapture`; `notifications.notifyError` (index.ts:319); note untouched |
| Breadcrumb read fails during collision check | Treated as "not ours" → falls through to a suffix rather than clobbering (`breadcrumbTargets`, index.ts:599) |
| Empty/whitespace `intakeFolder` | Watches nothing; `isInIntakeFolder` returns false (index.ts:175-177); adoption disabled |

## Dependencies

| Import | From | File |
|--------|------|------|
| `Plugin`, `TFile`, `normalizePath`, `TAbstractFile` (type) | `obsidian` | `index.ts:1-2` |
| `Setting` | `obsidian` | `settings-section.ts:1` |
| `NotificationManager`, `classifyUrl`, `ensureFolder`, `fetchArticleContent`, `isPathExcluded`, `parseFrontmatter`, `serializeFrontmatter`, `writeNote` | `../shared` | `index.ts:4-13` |
| `classifyUrl`, `extractUrls`, `ParsedNote` (type) | `../shared` | `intake-dispatcher.ts:2-3` |
| `SettingsSectionContext` (type) | `../shared` | `settings-section.ts:2` |
| `SynapseSettings` (type) | `../settings` | `index.ts:3` |
| `fireOnFile`, `transcribeUrlToNote` | injected via `IntakeDeps` (wired in `main.ts:464-489`) | |

Architecture rule: intake imports no feature module. `fireOnFile` is `SynapseRunner.fireOnFile`; `transcribeUrlToNote` wraps `UrlTranscriptionRouter.transcribe` + `buildUrlTranscriptBlock` (`src/transcription`), both injected by `main.ts`.
