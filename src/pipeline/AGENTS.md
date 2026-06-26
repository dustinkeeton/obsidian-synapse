---
last-updated: 2026-06-25
---

# Pipeline Module

Fire Synapse orchestration: runs the ordered multi-phase pipeline (elaboration -> summarize -> enrichment -> rem -> tidy -> organize) over a folder or a single note, where each phase is one feature module's scan function gated by settings and the command registry.

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
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `PipelineModuleKey`, `PipelineModuleMap`, `PipelinePhase`, `PipelineScanFn`, `SYNAPSE_PIPELINE` | Phase model + ordered phase list + scan-fn contract |
| `synapse-runner.ts` | `SynapseRunner` | Sequential phase executor with per-phase progress + error isolation |
| `index.ts` | re-exports `SynapseRunner`, `SYNAPSE_PIPELINE`, and the four types | Barrel (public API) |
| `synapse-runner.test.ts` | tests | Runner behaviour (filtering, progress, error isolation, fireOnFile) |
| `fire-flow-gate.test.ts` | tests | Flow-gate filtering via `isPipelineKeyInFlow` |

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

## Configuration

| Settings access | Source | Effect |
|-----------------|--------|--------|
| `settings[phase.key].enabled` | per-feature settings section keyed by `PipelineModuleKey` | Phase included only when its feature is enabled |
| `getSettings()` | injected accessor | Read-only; runner never mutates settings |

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
| `NotificationManager` (type) | `../shared` |
| `SynapseSettings` (type) | `../settings` |
| `TFile` (type) | `obsidian` |
| `PipelineModuleMap` instances | injected by `main.ts` from each feature module's scan fn |

Pipeline imports `commands` (for the `fire-synapse` flow gate) but NOT the feature modules directly — `main.ts` injects the `PipelineModuleMap`, keeping the runner decoupled from concrete feature implementations.
