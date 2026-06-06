---
last-updated: 2026-06-05
status: implemented
module-path: src/commands/
---

# Command Registry

Developer-facing source of truth and master control for every user-invocable command in Synapse. It sits **above** user settings as an authoritative kill-switch / deprecation / per-flow-removal layer. Modules keep their handlers co-located but register them through a central registrar gated by this registry.

## Status

Implemented (Issue #215). Ships behavior-preserving: every command is `active` with flows matching prior behavior, so first load is a no-op functionally.

## File Structure

```
src/commands/
  types.ts       # CommandStatus, CommandFlow, FeatureKey, CommandDefinition
  registry.ts    # COMMAND_REGISTRY (24 entries) + derived maps + flow helpers
  registrar.ts   # CommandRegistrar — gated register(), attempted/registered tracking
  audit.ts       # auditCommands() — bidirectional drift detection
  index.ts       # public barrel
```

## Types (types.ts)

```ts
type CommandStatus = 'active' | 'deprecated' | 'disabled';   // only 'active' registers/runs
type CommandFlow   = 'palette' | 'fire-synapse' | 'startup';
type FeatureKey =
  | 'main' | 'elaboration' | 'enrichment' | 'organize' | 'deep-dive'
  | 'summarize' | 'tidy' | 'rem' | 'video';

interface CommandDefinition {
  id: string;
  name: string;
  feature: FeatureKey;
  status: CommandStatus;
  flows: readonly CommandFlow[];
  pipelineKey?: string;   // string (not PipelineModuleKey) on purpose — see Dependency Graph
  note?: string;
}
```

## Public API

```ts
// registry.ts
const COMMAND_REGISTRY: readonly CommandDefinition[];
const REGISTRY_BY_ID: ReadonlyMap<string, CommandDefinition>;
const REGISTRY_BY_PIPELINE_KEY: ReadonlyMap<string, CommandDefinition>;   // 1:1; throws on dup
function buildPipelineKeyMap(commands): Map<string, CommandDefinition>;   // exported for tests
function isInFlow(id: string, flow: CommandFlow): boolean;                // active AND flows.includes(flow)
function isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean;  // fail-open if unmapped

// registrar.ts
class CommandRegistrar {
  constructor(host: { addCommand(c: Command): unknown });
  register(id: string, userEnabled: boolean, spec: Omit<Command, 'id'>): void;
  getAttempted(): ReadonlySet<string>;
  getRegistered(): ReadonlySet<string>;
}

// audit.ts
function auditCommands(attempted: ReadonlySet<string>): string[];   // [] when consistent
```

## Precedence

All ANDed; the registry is authoritative:

```
status (dev) -> flow membership (dev) -> settings.[feature].enabled (user) -> hasTranscription (runtime)
```

`CommandRegistrar.register` calls `host.addCommand` only when
`entry.status === 'active' && entry.flows.includes('palette') && userEnabled`.
A `deprecated`/`disabled` entry never registers or runs in any flow, regardless of user settings.

## Registry (24 entries)

23 real palette commands + 1 synthetic pipeline-only entry (`tidy-vault`).

| ID | Feature | Status | Flows | pipelineKey |
|----|---------|--------|-------|-------------|
| `synapse:review-proposals` | main | active | palette | — |
| `synapse:manage-checkpoints` | main | active | palette | — |
| `synapse:transcribe-media` | main | active | palette | — |
| `synapse:transcribe-note-media` | main | active | palette | — |
| `synapse:fire` | main | active | palette | — |
| `synapse:scan-vault` | elaboration | active | palette, fire-synapse, startup | elaboration |
| `synapse:scan-current-note` | elaboration | active | palette | — |
| `synapse:clear-proposals` | elaboration | active | palette | — |
| `synapse:enrich-current-note` | enrichment | active | palette | — |
| `synapse:scan-vault-enrichment` | enrichment | active | palette, fire-synapse | enrichment |
| `synapse:undo-enrichment` | enrichment | active | palette | — |
| `synapse:organize-current-note` | organize | active | palette | — |
| `synapse:scan-directory-organize` | organize | active | palette, fire-synapse | organize |
| `synapse:undo-organize` | organize | active | palette | — |
| `synapse:deep-dive` | deep-dive | active | palette | — |
| `synapse:clear-deep-dive` | deep-dive | active | palette | — |
| `synapse:summarize-current-note` | summarize | active | palette | — |
| `synapse:scan-vault-summarize` | summarize | active | palette, fire-synapse | summarize |
| `synapse:tidy-current-note` | tidy | active | palette | — |
| `synapse:undo-tidy` | tidy | active | palette | — |
| `synapse:rem-current-note` | rem | active | palette | — |
| `synapse:rem-directory` | rem | active | palette, fire-synapse | rem |
| `synapse:check-dependencies` | video | active | palette | — |
| `synapse:tidy-vault` *(synthetic)* | tidy | active | fire-synapse | tidy |

**Why the synthetic `tidy-vault` entry:** tidy is the only Fire Synapse phase with no matching palette command. The pipeline runs `tidy.scanVault()` (vault-wide); the `tidy-current-note` palette command runs `tidy()` on one note — a different operation. Giving the pipeline phase its own entry lets it be controlled independently of the palette command. It is never passed to `registrar.register()`, and the audit ignores it (no `palette` flow).

## Flow integration

- **palette** — `CommandRegistrar.register` gates `addCommand`. All 23 real commands participate.
- **fire-synapse** — `SynapseRunner.fire()` (`src/pipeline/synapse-runner.ts`) ANDs `isPipelineKeyInFlow(phase.key, 'fire-synapse')` into its `settings[phase.key].enabled` filter. Matched via `pipelineKey` (the 6 pipeline entries).
- **startup** — `ElaborationModule.onload()` (`src/elaboration/index.ts`) ANDs `isInFlow('synapse:scan-vault', 'startup')` into both the `scanOnStartup` and `autoScanInterval` conditions.

## Drift detection (audit.ts)

Run once at the end of `SynapsePlugin.onload()`; reused by `audit.test.ts` so CI fails on drift.

- **(a)** an `active` palette entry whose feature loaded but was never registered → "no handler".
- **(b)** a registered id with no `COMMAND_REGISTRY` entry → "missing from registry".

"Feature loaded" is derived from the attempted set (a module's `onload()` is the only caller of `register()` for its commands, and runs iff the feature is enabled). This makes the platform-gated `video` module correct for free.

**Known limitation:** a fully disabled feature (its `onload()` never runs) produces zero attempts and cannot be drift-checked — its handlers never got a chance to register.

## Dependency Graph

```
src/commands/  (depends on nothing else in src/ — never in an import cycle)
  index.ts -> types.ts, registry.ts, registrar.ts, audit.ts
  registrar.ts -> registry.ts (REGISTRY_BY_ID), obsidian (Command type)
  audit.ts -> registry.ts

consumed by:
  main.ts                       -> CommandRegistrar, auditCommands
  elaboration|enrichment|organize|deep-dive|summarize|tidy|rem|video  -> CommandRegistrar (+ elaboration: isInFlow)
  pipeline/synapse-runner.ts    -> isPipelineKeyInFlow
```

`CommandDefinition.pipelineKey` is typed `string` (not `PipelineModuleKey`) so `commands/` never imports `pipeline/` — `pipeline/synapse-runner.ts` imports `commands/`, so a back-import would close a cycle. `registry.test.ts` cross-checks the 6 `pipelineKey`s against `SYNAPSE_PIPELINE` to recover that type safety at test time.

## How to change command behavior

- **Deprecate / disable a command everywhere:** set `status` to `'deprecated'` or `'disabled'`.
- **Remove from one flow only (keep the others):** drop that flow from `flows` (e.g. `['palette']` to keep it in the palette but out of Fire Synapse).
- **Remove a phase from Fire Synapse:** edit the entry carrying that `pipelineKey` (for tidy, the synthetic `tidy-vault` entry).
- After any edit, `npm test` runs the registry + audit tests that guard the invariants.
