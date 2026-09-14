---
last-updated: 2026-09-14
---

# Pipeline Module

Fire Synapse orchestration: runs the ordered multi-phase pipeline (elaboration -> summarize -> enrichment -> rem -> tidy -> organize) over a folder or a single note, where each phase is one feature module's scan function gated by settings and the command registry. Also builds the post-op chaining hooks (enrich -> title check, auto-organize) that `main.ts` assigns to each feature module's completion slot (#483).

## Public API

Re-exported from `index.ts`:

```ts
// types.ts
type PipelineModuleKey =
  | 'elaboration'
  | 'summarize'
  | 'enrichment'
  | 'rem'
  | 'tidy'
  | 'organize';

// Scan-fn contract every pipeline module must satisfy.
// folderPath scopes the scan; skipConfirmation bypasses the confirm dialog
// (always true from Fire Synapse); onlyFile narrows a folder scan to a single
// note (filtered right after getMarkdownFiles). Returns a processed count or void.
type PipelineScanFn = (
  folderPath?: string,
  skipConfirmation?: boolean,
  onlyFile?: TFile,
) => Promise<number | void>;

interface PipelinePhase {
  key: PipelineModuleKey;
  label: string;
}

type PipelineModuleMap = Record<PipelineModuleKey, PipelineScanFn>;

const SYNAPSE_PIPELINE: PipelinePhase[]; // ordered phases (see table below)

// synapse-runner.ts
class SynapseRunner {
  constructor(
    modules: PipelineModuleMap,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
  );
  fire(folderPath?: string): Promise<void>; // folder-scoped, all active phases
  fireOnFile(file: TFile): Promise<void>;   // single-note scoped (intake #111)
}

// types.ts:51 / :54 / :56 / :58 (#483 post-op wiring)
type PostOpSource = 'elaboration' | 'audio' | 'video' | 'image' | 'summarize' | 'deep-dive';
type PostOpTrigger = 'elaboration' | 'transcription' | 'summarization' | 'deep-dive';   // EnrichmentTrigger minus 'manual'
type PostOpHook = (filePath: string) => void;
type AutoOrganizeTrigger = 'deep-dive' | 'summarize';

// post-op-hooks.ts:7
interface PostOpHookDeps {
  getSettings: () => SynapseSettings;
  notifications: NotificationManager;
  enrich: (filePath: string, trigger: PostOpTrigger) => Promise<void>;
  checkTitle: (filePath: string) => Promise<void>;
  organizeNote: (file: TFile) => Promise<unknown>;
}
// post-op-hooks.ts:31 — null when nothing is wired (module hook slot left untouched)
function buildPostOpHook(deps: PostOpHookDeps, source: PostOpSource): PostOpHook | null;
// post-op-hooks.ts:53 — null unless organize.enabled AND the trigger's opt-in flag
function buildAutoOrganizeHook(deps: PostOpHookDeps, trigger: AutoOrganizeTrigger): ((file: TFile) => void) | null;
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `PipelineModuleKey`, `PipelineModuleMap`, `PipelinePhase`, `PipelineScanFn`, `SYNAPSE_PIPELINE`, `PostOpSource`, `PostOpTrigger`, `PostOpHook`, `AutoOrganizeTrigger` | Phase model + ordered phase list + scan-fn contract + post-op hook types |
| `synapse-runner.ts` | `SynapseRunner` | Sequential phase executor with per-phase progress + error isolation |
| `post-op-hooks.ts` | `buildPostOpHook`, `buildAutoOrganizeHook`, `PostOpHookDeps` | Settings-gated post-op hook factories (enrich -> title check; single-note auto-organize); every dispatch goes through `fireAndForget` |
| `index.ts` | re-exports everything above | Barrel (public API) |
| `synapse-runner.test.ts` | tests | Runner behaviour (filtering, progress, error isolation, fireOnFile) |
| `fire-flow-gate.test.ts` | tests | Flow-gate filtering via `isPipelineKeyInFlow` |
| `post-op-hooks.test.ts` | tests | Hook gating (wire-time vs live title gate, deep-dive opt-in, null cases) |

## Ordered Phases (`SYNAPSE_PIPELINE`)

Source: types.ts:L41-L48. Order is load-bearing — the runner executes phases in array order.

| Order | key | label |
|-------|-----|-------|
| 1 | `elaboration` | Elaboration |
| 2 | `summarize` | Summarize |
| 3 | `enrichment` | Enrichment |
| 4 | `rem` | REM |
| 5 | `tidy` | Tidy |
| 6 | `organize` | Organize |

Organize is intentionally last: it is the content-aware mover that relocates notes to their proper folder.

## Data Flow

```
fire(folderPath?)  /  fireOnFile(file)
  --> activePhases = SYNAPSE_PIPELINE.filter(p =>
        settings[p.key].enabled && isPipelineKeyInFlow(p.key, 'fire-synapse'))
  --> if activePhases.length === 0: notifications.info('No features are enabled'); return
  --> op = notifications.startOperation('Fire Synapse (0/N)' | 'Fire Synapse on <basename> (0/N)')
  --> for each phase (sequential, in order):
        if op.cancelled: break
        op.progress(completed, N, 'Phase i/N: <label>')
        try { await modules[phase.key](folderPath, true[, file]) }  // skipConfirmation=true
        catch { console.warn('[Synapse] Phase <label> failed: <msg>') }  // isolated; run continues
  --> if !op.cancelled: op.finish('Fire Synapse complete — <completed> phases run')
```

- `fire` (synapse-runner.ts:L14): folder-scoped; never passes `onlyFile`.
- `fireOnFile` (synapse-runner.ts:L70): scopes `folderPath` to the note's parent folder so `getMarkdownFiles` returns a superset that includes it, then passes the note as `onlyFile` (3rd arg) so each module filters to that single path. A root-level note (parent is root/undefined) passes `folderPath = undefined`. Uses operation id `synapse-fire-file`; `fire` uses `synapse-fire`.

## Post-Op Hooks (`post-op-hooks.ts`)

Wired in `main.ts:180-194`: one `PostOpHookDeps` (`main.ts:180-186`) feeds `buildPostOpHook` for each source (`elaboration.onProposalAccepted`, `audio.onTranscriptionComplete`, `video.onTranscriptionComplete`, `image.onExtractionComplete`, `summarize.onSummaryComplete`, `deepDive.onNoteAccepted`) and `buildAutoOrganizeHook` for `deepDive.onOrganizeRequested` / `summarize.onOrganizeRequested`.

`buildPostOpHook(deps, source)` (`post-op-hooks.ts:31`), evaluated once at wire time:

| Wire-time condition | Returned hook |
|---------------------|---------------|
| `enrichment.enabled && enrichment.autoEnrich`, source `'deep-dive'` and `!deepDive.autoEnrichOnAccept` | `null` (`:40`) |
| `enrichment.enabled && enrichment.autoEnrich` (otherwise) | `fireAndForget(enrich(filePath, TRIGGER_BY_SOURCE[source]))`, then a title check gated LIVE per call on `title.enabled && title.checkAfterOperations` (`:42-46`) |
| else `title.enabled && title.checkAfterOperations` | standalone `fireAndForget(checkTitle(filePath))` (`:48`) |
| else | `null` |

`TRIGGER_BY_SOURCE` (`post-op-hooks.ts:16`): elaboration -> `'elaboration'`; audio/video/image -> `'transcription'`; summarize -> `'summarization'`; deep-dive -> `'deep-dive'`.

`buildAutoOrganizeHook(deps, trigger)` (`post-op-hooks.ts:53`): `null` unless `organize.enabled` AND (`deepDive.autoOrganizeOnAccept` for `'deep-dive'` | `summarize.autoOrganizeOnSummarize` for `'summarize'`); otherwise `(file) => fireAndForget(organizeNote(file))`.

## Configuration

| Settings access | Source | Effect |
|-----------------|--------|--------|
| `settings[phase.key].enabled` | per-feature settings section keyed by `PipelineModuleKey` | Phase included only when its feature is enabled |
| `getSettings()` | injected accessor | Read-only; runner never mutates settings |
| `enrichment.enabled`, `enrichment.autoEnrich`, `deepDive.autoEnrichOnAccept`, `title.enabled`, `title.checkAfterOperations` | `post-op-hooks.ts:34-48` | Post-op hook shape (see table above); title gate re-read live under auto-enrich |
| `organize.enabled`, `deepDive.autoOrganizeOnAccept`, `summarize.autoOrganizeOnSummarize` | `post-op-hooks.ts:57-62` | Auto-organize hook wired or `null` |

## Error States

| Condition | Handling |
|-----------|----------|
| No phases enabled / in flow | `notifications.info('No features are enabled')`, early return, no operation started |
| A phase throws | Caught per-phase, logged via `console.warn('[Synapse] Phase <label> failed: ...')`; remaining phases still run (error isolation) |
| Operation cancelled | `op.cancelled` checked at top of each iteration; loop breaks and `op.finish` is skipped |

## Dependencies

| Import | From |
|--------|------|
| `isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean` | `../commands` (registry.ts:L107; fail-open on unmapped key) |
| `fireAndForget` (runtime) | `../shared` (`post-op-hooks.ts:2`) |
| `NotificationManager` (type) | `../shared` |
| `SynapseSettings` (type) | `../settings` |
| `TFile` (type) | `obsidian` (`types.ts:1`, `post-op-hooks.ts:1`) |
| `PipelineModuleMap` instances | injected by `main.ts:92-99` from each feature module's scan fn |
| `PostOpHookDeps` instance | injected by `main.ts:180-186` (`enrichment.enrich`, `title.checkTitle`, `organize.organizeNote` wrapped with `{ postOp: true }` where applicable) |

Pipeline imports `commands` (for the `fire-synapse` flow gate) and `shared` (`fireAndForget`) but NOT the feature modules directly — `main.ts` injects the `PipelineModuleMap` and `PostOpHookDeps`, keeping the runner and the hooks decoupled from concrete feature implementations.
