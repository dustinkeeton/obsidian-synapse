---
last-updated: 2026-10-09
---

# Pipeline Module

Fire Synapse orchestration: runs the ordered multi-phase pipeline (elaboration -> summarize -> enrichment -> rem -> illustrate -> tidy -> organize) over a folder or a single note, where each phase is one feature module's scan function gated by settings and the command registry. Also builds the post-op chaining hooks (enrich -> title check, deep-dive REM, illustrate, auto-organize) that `main.ts` assigns to each feature module's completion slot (#483).

## Public API

Re-exported from `index.ts`:

```ts
// types.ts
type PipelineModuleKey =
  | 'elaboration'
  | 'summarize'
  | 'enrichment'
  | 'rem'
  | 'illustrate'
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

// types.ts:54 / :57 / :60 / :62 / :64 (#483 post-op wiring)
type PostOpSource = 'elaboration' | 'audio' | 'video' | 'image' | 'summarize' | 'deep-dive' | 'enrichment';   // 'enrichment' (#213) chains illustrate only, never re-enrichment
type PostOpTrigger = 'elaboration' | 'transcription' | 'summarization' | 'deep-dive';   // EnrichmentTrigger minus 'manual'
type PostOpContext = SourceContext;   // shared/source-context.ts: { sourceUrls?, sourceImages?, producedRegion? } — the material the action processed and the region it wrote (#213)
type PostOpHook = (filePath: string, ctx?: PostOpContext) => void;   // callers with no material pass nothing
type AutoOrganizeTrigger = 'deep-dive' | 'summarize';

// post-op-hooks.ts:7
interface PostOpHookDeps {
  getSettings: () => SynapseSettings;
  notifications: NotificationManager;
  enrich: (filePath: string, trigger: PostOpTrigger) => Promise<void>;
  checkTitle: (filePath: string) => Promise<void>;
  organizeNote: (file: TFile) => Promise<unknown>;
  illustrateNote: (filePath: string, ctx?: PostOpContext) => Promise<void>;   // #213 illustrate leg
  remNote: (filePath: string) => Promise<unknown>;                           // #581 deep-dive REM leg
}
// post-op-hooks.ts:46 — null when no leg is wired (module hook slot left untouched)
function buildPostOpHook(deps: PostOpHookDeps, source: PostOpSource): PostOpHook | null;
// post-op-hooks.ts:89 — null unless organize.enabled AND the trigger's opt-in flag
function buildAutoOrganizeHook(deps: PostOpHookDeps, trigger: AutoOrganizeTrigger): ((file: TFile) => void) | null;
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `PipelineModuleKey`, `PipelineModuleMap`, `PipelinePhase`, `PipelineScanFn`, `SYNAPSE_PIPELINE`, `PostOpSource`, `PostOpTrigger`, `PostOpContext`, `PostOpHook`, `AutoOrganizeTrigger` | Phase model + ordered phase list + scan-fn contract + post-op hook types |
| `synapse-runner.ts` | `SynapseRunner` | Sequential phase executor with per-phase progress + error isolation |
| `post-op-hooks.ts` | `buildPostOpHook`, `buildAutoOrganizeHook`, `PostOpHookDeps` | Settings-gated post-op hook factories (enrich -> title check; deep-dive REM; illustrate; single-note auto-organize); every dispatch goes through `fireAndForget` |
| `index.ts` | re-exports everything above | Barrel (public API) |
| `synapse-runner.test.ts` | tests | Runner behaviour (filtering, progress, error isolation, fireOnFile) |
| `fire-flow-gate.test.ts` | tests | Flow-gate filtering via `isPipelineKeyInFlow` |
| `post-op-hooks.test.ts` | tests | Hook gating (wire-time vs live title gate, deep-dive opt-in, deep-dive REM leg on/off/REM disabled, null cases) |

## Ordered Phases (`SYNAPSE_PIPELINE`)

Source: `types.ts:43-51`. Order is load-bearing — the runner executes phases in array order.

| Order | key | label |
|-------|-----|-------|
| 1 | `elaboration` | Elaboration |
| 2 | `summarize` | Summarize |
| 3 | `enrichment` | Enrichment |
| 4 | `rem` | REM |
| 5 | `illustrate` | Illustrate |
| 6 | `tidy` | Tidy |
| 7 | `organize` | Organize |

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

- `fire` (`synapse-runner.ts:14`): folder-scoped; never passes `onlyFile`.
- `fireOnFile` (`synapse-runner.ts:70`): scopes `folderPath` to the note's parent folder so `getMarkdownFiles` returns a superset that includes it, then passes the note as `onlyFile` (3rd arg) so each module filters to that single path. A root-level note (parent is root/undefined) passes `folderPath = undefined`. Uses operation id `synapse-fire-file`; `fire` uses `synapse-fire`.

## Post-Op Hooks (`post-op-hooks.ts`)

Wired in `main.ts:185-202`: one `PostOpHookDeps` (`main.ts:185-193`; `illustrateNote` -> `illustrate.illustrateNote(filePath, ctx)`, `:191`; `remNote` -> `rem.remScanNote(filePath, { postOp: true })`, `:192`) feeds `buildPostOpHook` for each source (`elaboration.onProposalAccepted`, `audio.onTranscriptionComplete`, `video.onTranscriptionComplete`, `image.onExtractionComplete`, `summarize.onSummaryComplete`, `enrichment.onEnrichmentApplied` (`:199`), `deepDive.onNoteAccepted`) and `buildAutoOrganizeHook` for `deepDive.onOrganizeRequested` / `summarize.onOrganizeRequested`.

`buildPostOpHook(deps, source)` builds independent legs at wire time and runs every wired leg per call with `(filePath, ctx)`; `null` when no leg is wired (`post-op-hooks.ts:84`). Source `'enrichment'` (`enrichment.onEnrichmentApplied`) gets the illustrate leg only. Leg order per call: enrich/title, REM, illustrate (`post-op-hooks.ts:53-82`).

| Leg | Wire-time gate | Per-call behavior |
|-----|----------------|-------------------|
| enrich + title | source != `'enrichment'`; `enrichment.enabled && enrichment.autoEnrich`; NOT (deep-dive with `!deepDive.autoEnrichOnAccept` — that opts the source out of the whole enrich/title chain) | `fireAndForget(enrich(filePath, TRIGGER_BY_SOURCE[source]))`, then a title check gated LIVE on `title.enabled && title.checkAfterOperations` |
| standalone title | source != `'enrichment'`, auto-enrich off, `title.enabled && title.checkAfterOperations` | `fireAndForget(checkTitle(filePath))` |
| deep-dive REM (#581) | source == `'deep-dive'`; `rem.enabled && deepDive.autoRemOnAccept` | `fireAndForget(remNote(filePath))`; main.ts wires `rem.remScanNote(filePath, { postOp: true })`; RemModule takes the queue slot (REM's own auto-accept applies) |
| illustrate (#213) | `illustrate.enabled` | LIVE: `illustrate.enabled && illustrate.runAfter[RUN_AFTER_BY_SOURCE[source]]` -> `fireAndForget(illustrateNote(filePath, ctx))` |

`TRIGGER_BY_SOURCE`: elaboration -> `'elaboration'`; audio/video/image -> `'transcription'`; summarize -> `'summarization'`; deep-dive -> `'deep-dive'`. `RUN_AFTER_BY_SOURCE`: elaboration -> `elaboration`; audio/video/image -> `transcription`; summarize -> `summarize`; deep-dive -> `deepDive`; enrichment -> `enrichment`.

Context producers (`ctx`): elaboration accept -> `sourceUrls` = links in the note body; enrichment accept -> `sourceUrls` = links in the note body; deep-dive accept -> `sourceUrls` = `topic.relatedUrls` + links in the generated body; summarize -> `sourceUrls` = fetched URLs, `sourceImages` = page images (`fetchPageContentWithImages`) + media thumbnails, `producedRegion` = its `synapse-summary` callout (title when exactly one was written), fired ONCE per distinct note path per run; URL transcription (`insert-url-transcript.ts`) -> `sourceUrls` = [url], `sourceImages` = YouTube poster frame when the caption tier exposed one, `producedRegion` = the transcript callout; elaboration / enrichment / deep-dive -> `producedRegion: { kind: 'whole-note' }`; local audio/video/image embeds pass nothing.

`buildAutoOrganizeHook(deps, trigger)` (`post-op-hooks.ts:89`): `null` unless `organize.enabled` AND (`deepDive.autoOrganizeOnAccept` for `'deep-dive'` | `summarize.autoOrganizeOnSummarize` for `'summarize'`); otherwise `(file) => fireAndForget(organizeNote(file))`.

## Configuration

| Settings access | Source | Effect |
|-----------------|--------|--------|
| `settings[phase.key].enabled` | per-feature settings section keyed by `PipelineModuleKey` | Phase included only when its feature is enabled |
| `getSettings()` | injected accessor | Read-only; runner never mutates settings |
| `enrichment.enabled`, `enrichment.autoEnrich`, `deepDive.autoEnrichOnAccept`, `title.enabled`, `title.checkAfterOperations` | `post-op-hooks.ts:54-67` | Post-op hook shape (see table above); title gate re-read live under auto-enrich |
| `rem.enabled`, `deepDive.autoRemOnAccept` | `post-op-hooks.ts:70-73` | REM leg wired (wire time only) for deep-dive only |
| `illustrate.enabled` (wire time + live), `illustrate.runAfter[key]` (live) | `post-op-hooks.ts:75-82` | Illustrate leg wired / fired |
| `organize.enabled`, `deepDive.autoOrganizeOnAccept`, `summarize.autoOrganizeOnSummarize` | `post-op-hooks.ts:93-98` | Auto-organize hook wired or `null` |

## Error States

| Condition | Handling |
|-----------|----------|
| No phases enabled / in flow | `notifications.info('No features are enabled')`, early return, no operation started |
| A phase throws | Caught per-phase, logged via `console.warn('[Synapse] Phase <label> failed: ...')`; remaining phases still run (error isolation) |
| Operation cancelled | `op.cancelled` checked at top of each iteration; loop breaks and `op.finish` is skipped |

## Dependencies

| Import | From |
|--------|------|
| `isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean` | `../commands` (`commands/registry.ts:112`; fail-open on unmapped key) |
| `fireAndForget` (runtime) | `../shared` (`post-op-hooks.ts:2`) |
| `NotificationManager`, `SourceContext` (types) | `../shared` (`post-op-hooks.ts:3`, `types.ts:2`) |
| `SynapseSettings`, `IllustrateRunAfterKey` (types) | `../settings` (`post-op-hooks.ts:4`; `IllustrateRunAfterKey` is re-exported by `settings.ts:11` from `illustrate/types`) |
| `TFile` (type) | `obsidian` (`types.ts:1`, `post-op-hooks.ts:1`) |
| `PipelineModuleMap` instances | injected by `main.ts:92-100` from each feature module's scan fn |
| `PostOpHookDeps` instance | injected by `main.ts:185-193` (`enrichment.enrich`, `title.checkTitle` wrapped with `{ postOp: true }`; `organize.organizeNote`; `illustrate.illustrateNote`; `remNote` = `rem.remScanNote(filePath, { postOp: true })`; `RemModule` takes the queue slot) |

Pipeline imports `commands` (for the `fire-synapse` flow gate) and `shared` (`fireAndForget`) but NOT the feature modules directly — `main.ts` injects the `PipelineModuleMap` and `PostOpHookDeps`, keeping the runner and the hooks decoupled from concrete feature implementations.
