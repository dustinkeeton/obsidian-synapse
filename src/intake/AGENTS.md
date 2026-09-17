---
last-updated: 2026-09-17
---

# Intake Module

Watches a configurable intake folder and auto-processes newly added/settled notes (#111), plus a one-shot startup catch-up scan for un-stamped notes that never fired an event (#462): routes each note (transcription URL / article URL / general), runs the full Synapse pipeline on it, stamps a processed flag, and optionally relocates it. Opt-in adoption of root-level shared captures (#455). Imports only `obsidian`, `src/shared/*`, and the `SynapseSettings` type; all cross-module work goes through injected `IntakeDeps`.

## Public API

Exported from `index.ts` (`index.ts:23-31`, `index.ts:720`):

```ts
// index.ts:68 — class IntakeModule
class IntakeModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    deps: IntakeDeps,
  )
  onload(): Promise<void>    // index.ts:92 — registers vault create+modify listeners when intake.enabled; arms the startup catch-up scan (#462)
  onunload(): void           // index.ts:115 — clears the catch-up timer, all debounce timers, pending/inFlight/failureNotified sets
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

| Body shape | `classifyUrl` type | Route `kind` | Branch (execute, index.ts:429) |
|------------|--------------------|--------------|--------------------------------|
| Not a bare URL (prose / 0 / multiple URLs) | — | `general` | `deps.fireOnFile` |
| Bare URL | `video` or `audio` | `transcription` | `deps.transcribeUrlToNote` → `deps.fireOnFile` |
| Bare URL | `article` | `article` | `fetchArticleContent` → append → `deps.fireOnFile` |
| Bare URL | `unknown` (or default) | `general` | `deps.fireOnFile` |

## Data Flow

```
vault create/modify event
  --> handleEvent (index.ts:181): cheap sync guards, cheapest-first:
        is TFile && .md  -->  intake.enabled
        -->  isInIntakeFolder (index.ts:246; excludes capture-log subfolder)
             OR isAdoptionCandidate (index.ts:224; #455)
        -->  not isPathExcluded(...,'intake',...)  -->  not inFlight
  --> scheduleFlush(path, extraDelayMs = 0) (index.ts:287): per-path debounce, resets timer on every event
        settleWindowMs (index.ts:310) = intake.settleSeconds * 1000
        (fallback DEBOUNCE_MS=5000ms when missing/not a positive number, index.ts:39)

startup catch-up scan (#462), armed by onload via workspace.onLayoutReady + CATCHUP_DELAY_MS (index.ts:107)
  --> catchUp (index.ts:130): vault.getMarkdownFiles()
        isInIntakeFolder AND not isPathExcluded AND not pending AND not inFlight
        sort by stat.mtime ascending --> skip stamped (isFileProcessed, index.ts:161)
        first CATCHUP_MAX_NOTES=10 --> scheduleFlush(path, i * CATCHUP_STAGGER_MS=2000)
  --> flush(path) (index.ts:323) after the note is quiet for the full window:
        path outside intake folder --> maybeAdoptCapture(file) (index.ts:375), return
        read + parseFrontmatter
        idempotency guard (isProcessed, index.ts:412): skip if SYNAPSE_PROCESSED_FLAG truthy
        dispatcher.route(file, parsed) --> execute(file, route)
  --> execute (index.ts:429):
        snapshot originalPath (organize mutates file.path on rename)
        transcription: deps.transcribeUrlToNote(url, mediaType, file) --> deps.fireOnFile
        article:       fetchArticleContent(url) --> appendArticleContent (index.ts:476) --> deps.fireOnFile
        general:       deps.fireOnFile
        markProcessedAndMaybeMove (index.ts:507) --> optional writeCaptureBreadcrumb (index.ts:601)
```

`transcribeUrlToNote` implementation is `appendUrlTranscript` (`src/transcription/insert-url-transcript.ts:84`), wired at `main.ts:72-79`: `UrlTranscriptionRouter.transcribe(url)` → `buildUrlTranscriptBlock(result, url, video.embedInNote)` → `vault.process` append under operation toast `intake-url-<path>`; on error the toast reports and the error is rethrown so the note stays un-stamped. No speech (#524) resolves instead: notice, nothing appended, note stamped (final, not retriable).

## Startup Catch-up Scan (#462)

Event-driven watching misses two cases: a note synced in while Obsidian was closed (e.g. the mobile→desktop handoff for a URL no mobile tier could transcribe, #184) and a note whose earlier processing threw (left un-stamped by design). `onload` therefore arms a one-shot scan (`workspace.onLayoutReady` so the file index is complete, then `CATCHUP_DELAY_MS` = 7000ms, landing after the plugin's 3s/5s startup checks).

- `catchUp` (index.ts:130) re-checks `intake.enabled`, enumerates `vault.getMarkdownFiles()`, keeps notes inside the intake folder (capture-log subfolder excluded via `isInIntakeFolder`) that are not path-excluded and not already `pending`/`inFlight` (an event-scheduled debounce is never reset), sorts oldest-first by `stat.mtime`, skips stamped notes (`isFileProcessed`, index.ts:161; a read failure counts as processed), and schedules at most `CATCHUP_MAX_NOTES` = 10 through the normal `scheduleFlush` path with `i * CATCHUP_STAGGER_MS` (2000ms) extra delay per note so flushes fan out instead of bursting AI calls.
- Everything downstream (settle window, idempotency guard, routing, stamp, move, breadcrumb) is unchanged; a note beyond the cap is picked up on the next startup or its next event.
- `onunload` clears the catch-up timer; the scan is a no-op if intake was disabled after load.

Failure notices are once-per-session per path (`reportFailure`, index.ts:357; `failureNotified` set): the first failure toasts via `notifications.notifyError`, repeats only `console.warn`. A `modify` event for the path clears the entry so edited content gets a fresh toast.

## Shared-Capture Adoption (#455)

Off by default (`intake.adoptSharedCaptures`). Targets Obsidian's mobile share receiver, which creates the note at the vault root.

- `isAdoptionCandidate` (index.ts:224): `adoptSharedCaptures === true` AND event kind is `create` (never `modify`) AND path has no `/` (vault root) AND `intakeFolder` is non-blank.
- `maybeAdoptCapture` (index.ts:375): re-checks the toggle; skips already-stamped notes; requires `dispatcher.bareUrl(body)` non-null AND `classifyUrl(url).type !== 'unknown'`; then `moveNote(file, intakeFolder)` and `scheduleFlush(file.path)` (a rename fires no create/modify event, so the adopted note is re-queued explicitly).
- Anything else (prose, multiple URLs, unclassifiable link) is left where the user created it.
- Failure → `notifications.notifyError('Could not adopt shared capture ...')` (index.ts:399); the note is not moved.

## Processing Semantics

- Idempotency: a note carrying `synapse-processed` (boolean `true` or string `'true'`) is never reprocessed; this also suppresses the modify echo from the flag-stamp write.
- In-flight guard: paths being flushed are tracked in `inFlight` (keyed on originalPath) so the stamp/move rename echo does not re-enter `flush`.
- Path exclusion: `isPathExcluded(file.path, 'intake', settings)` is checked before scheduling; excluded notes are silently skipped (#307).
- Primary mover is organize (last pipeline phase inside `fireOnFile`). `moveWhenDone` is a FALLBACK mover (index.ts:507), applied only when organize left the note inside the intake folder (low confidence / no-op).
- Stamp-before-move: the processed flag is written before any relocation (`stampProcessed`, index.ts:553) so idempotency survives the move's rename echo.
- `moveNote` (index.ts:566) uses `fileManager.renameFile` so inbound links stay intact and `ensureFolder` to create the destination.
- Unqueued by design: stamp/move/breadcrumb writes run after every pipeline phase has released the note's `NoteOperationQueue` slot; `vault.process` callbacks re-derive from fresh content.

## Capture Log (#224)

When `intake.captureLog` is true and a processed note actually left the intake folder (`movedOutOfIntake`, index.ts:544), a dated breadcrumb is written to `<intakeFolder>/<captureLogFolder>/<YYYY-MM-DD> — <title>.md` (default subfolder `_captured`). The capture-log subfolder is excluded from the watcher (`isInIntakeFolder`, index.ts:246; `captureLogPath`, index.ts:272) and breadcrumbs are stamped `synapse-processed: true` (defense-in-depth) so they are never re-ingested.

Collision policy (#227, `resolveBreadcrumbPath`, index.ts:647): two distinct notes that sanitize to the same dated title get a uniqueness suffix (` (2)`, ` (3)`, ...). Re-processing the same note overwrites its own breadcrumb idempotently (`breadcrumbTargets`, index.ts:679).

## Configuration

All under `settings.intake` (`IntakeSettings`, settings.ts:243; defaults `DEFAULT_SETTINGS.intake`, settings.ts:527):

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | `true` | Module activation (watcher registration + startup catch-up scan) |
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
| File vanished before flush | `flush` returns silently (index.ts:325-327) |
| Note already processed | `flush` returns before routing (idempotency, index.ts:342) |
| Processing throws (transcription/fetch/pipeline) | Caught in `flush`; note left un-stamped (retriable); surfaced via `reportFailure` (index.ts:357) — `notifications.notifyError` once per session per path, then `console.warn`; cleared by a `modify` event |
| No transcription tier for the URL (e.g. TikTok on mobile) | `transcribeUrlToNote` rethrows `NoTranscriptionPathError`; same un-stamped/retriable path; a synced desktop vault's watcher or its startup catch-up scan (#462) finishes it |
| Adoption read/move fails | Caught in `maybeAdoptCapture`; `notifications.notifyError` (index.ts:399); note untouched |
| Breadcrumb read fails during collision check | Treated as "not ours" → falls through to a suffix rather than clobbering (`breadcrumbTargets`, index.ts:679) |
| Empty/whitespace `intakeFolder` | Watches nothing; `isInIntakeFolder` returns false (index.ts:247-249); adoption disabled; catch-up scan schedules nothing |
| Catch-up read of a candidate fails | Treated as processed (`isFileProcessed`, index.ts:161); skipped silently |

## Dependencies

| Import | From | File |
|--------|------|------|
| `Plugin`, `TFile`, `normalizePath`, `TAbstractFile` (type) | `obsidian` | `index.ts:1-2` |
| `vault.getMarkdownFiles`, `workspace.onLayoutReady` | `obsidian` (runtime `app` surfaces used by the catch-up scan) | `index.ts:107`, `index.ts:137` |
| `Setting` | `obsidian` | `settings-section.ts:1` |
| `NotificationManager`, `classifyUrl`, `ensureFolder`, `fetchArticleContent`, `isPathExcluded`, `parseFrontmatter`, `redactError`, `serializeFrontmatter`, `writeNote` | `../shared` | `index.ts:4-14` |
| `classifyUrl`, `extractUrls`, `ParsedNote` (type) | `../shared` | `intake-dispatcher.ts:2-3` |
| `SettingsSectionContext` (type) | `../shared` | `settings-section.ts:2` |
| `SynapseSettings` (type) | `../settings` | `index.ts:3` |
| `fireOnFile`, `transcribeUrlToNote` | injected via `IntakeDeps` (wired in `main.ts:72-79`) | |

Architecture rule: intake imports no feature module. `fireOnFile` is `SynapseRunner.fireOnFile`; `transcribeUrlToNote` is `appendUrlTranscript` from `src/transcription/insert-url-transcript.ts` (router transcribe + `buildUrlTranscriptBlock` + append), both injected by `main.ts`.
