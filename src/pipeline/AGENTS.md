---
last-updated: 2026-06-19
---

# Pipeline Module

Fire Synapse orchestration: runs the ordered multi-phase pipeline (elaboration → summarize → enrichment → REM → tidy → organize) over a folder or a single note. Each phase is one feature module's scan function, gated by settings and the command registry.

## Public API

Exported from `index.ts`:

```ts
// types.ts
type PipelineModuleKey = 'elaboration' | 'summarize' | 'enrichment' | 'rem' | 'tidy' | 'organize'

// Scan-fn contract every pipeline module must satisfy.
// folderPath scopes the scan; skipConfirmation bypasses the confirm dialog (always true from Fire Synapse);
// onlyFile narrows a folder scan to a single note (filtered right after getMarkdownFiles).
type PipelineScanFn = (
  folderPath?: string,
  skipConfirmation?: boolean,
  onlyFile?: TFile,
) => Promise<number | void>

interface PipelinePhase { key: PipelineModuleKey; label: string }
type PipelineModuleMap = Record<PipelineModuleKey, PipelineScanFn>

const SYNAPSE_PIPELINE: PipelinePhase[]   // ordered phases (see below)

// synapse-runner.ts
class SynapseRunner {
  constructor(modules: PipelineModuleMap, getSettings: () => SynapseSettings, notifications: NotificationManager)
  fire(folderPath?: string): Promise<void>        // folder-scoped, all active phases
  fireOnFile(file: TFile): Promise<void>          // single-note scoped (used by intake #111)
}
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `PipelineModuleKey`, `PipelineModuleMap`, `PipelinePhase`, `PipelineScanFn`, `SYNAPSE_PIPELINE` | Phase model + ordered phase list |
| `synapse-runner.ts` | `SynapseRunner` | Sequential phase executor with per-phase progress + error isolation |
| `index.ts` | re-exports all of the above | Barrel |
| `synapse-runner.test.ts`, `fire-flow-gate.test.ts` | Tests | |

## Ordered Phases (`SYNAPSE_PIPELINE`)

| Order | key | label |
|-------|-----|-------|
| 1 | `elaboration` | Elaboration |
| 2 | `summarize` | Summarize |
| 3 | `enrichment` | Enrichment |
| 4 | `rem` | REM |
| 5 | `tidy` | Tidy |
| 6 | `organize` | Organize |

Organize is intentionally last: it is the content-aware mover that relocates notes to their proper folder.

## Execution

```
fire(folderPath?) / fireOnFile(file)
  --> activePhases = SYNAPSE_PIPELINE.filter(p =>
        settings[p.key].enabled && isPipelineKeyInFlow(p.key, 'fire-synapse'))
  --> if none active: notify "No features are enabled", return
  --> startOperation with N-phase progress
  --> for each phase (sequential, ordered):
        modules[phase.key](folderPath, true[, file])   // skipConfirmation=true; onlyFile for fireOnFile
        per-phase try/catch — a thrown phase is logged (console.warn) and the run continues
  --> finish unless cancelled
```

`fireOnFile` scopes each phase to the note's parent folder (so `getMarkdownFiles` includes it) and passes
the note as `onlyFile`; every module's scan fn filters to that single path. The folder-scoped `fire` path
never passes `onlyFile`.

## Dependencies

| Import | From |
|--------|------|
| `isPipelineKeyInFlow` | `../commands` |
| `NotificationManager`, `SynapseSettings` (type) | `../shared`, `../settings` |
| `PipelineModuleMap` | wired in `main.ts` from each module's scan fn |

Pipeline imports `commands` but NOT the feature modules directly — `main.ts` injects the `PipelineModuleMap`,
keeping the runner decoupled from concrete feature implementations.
