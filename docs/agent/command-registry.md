---
last-updated: 2026-09-14
status: implemented
module-path: src/commands/
---

# Command Registry

Developer-facing source of truth and master control for every user-invocable command in Synapse. Sits above user settings as a kill-switch / deprecation / per-flow-removal layer. Modules keep their handlers co-located but register them through a central registrar gated by this registry. Detailed per-file reference: `src/commands/AGENTS.md`.

## Status

Implemented (#215). Extended by #289 (`context`, actions sidebar) and #349 (`icon`, `FEATURE_ICONS`).

## File Structure

```
src/commands/
  types.ts       # CommandStatus, CommandFlow, CommandContext, FeatureKey, CommandDefinition
  registry.ts    # COMMAND_REGISTRY (24 entries) + derived maps + flow helpers
  icons.ts       # FEATURE_ICONS (glyph per FeatureKey) + resolveActionIcon
  actions.ts     # listPaletteActions — sidebar button list derived from the registry
  registrar.ts   # CommandRegistrar — gated register(), attempted/registered tracking
  audit.ts       # auditCommands() — bidirectional drift detection
  index.ts       # public barrel (omits buildPipelineKeyMap)
```

## Types (types.ts)

```ts
type CommandStatus  = 'active' | 'deprecated' | 'disabled';   // only 'active' registers/runs   (types.ts:11)
type CommandFlow    = 'palette' | 'fire-synapse' | 'startup';                                    // (types.ts:14)
type CommandContext = 'note' | 'vault' | 'global';            // runtime env; drives sidebar gating (types.ts:25)
type FeatureKey =
  | 'main' | 'elaboration' | 'enrichment' | 'organize' | 'deep-dive'
  | 'summarize' | 'tidy' | 'rem' | 'video';                                                       // (types.ts:28)

interface CommandDefinition {                                                                    // (types.ts:40)
  id: string;                       // WITHOUT 'synapse:' prefix; Obsidian prepends the manifest id
  name: string;
  feature: FeatureKey;
  status: CommandStatus;
  flows: readonly CommandFlow[];
  context: CommandContext;          // required
  icon?: string;                    // addIcon glyph overriding FEATURE_ICONS[feature]; set on the 5 `main` entries
  pipelineKey?: string;             // string (not PipelineModuleKey) on purpose — see Dependency Graph
  note?: string;
}
```

## Public API

```ts
// registry.ts
const COMMAND_REGISTRY: readonly CommandDefinition[];                                        // :15
const REGISTRY_BY_ID: ReadonlyMap<string, CommandDefinition>;                                // :70
const REGISTRY_BY_PIPELINE_KEY: ReadonlyMap<string, CommandDefinition>;                      // :93; 1:1; throws on dup
function buildPipelineKeyMap(commands: readonly CommandDefinition[]): Map<string, CommandDefinition>;  // :78; not in barrel (tests)
function isInFlow(id: string, flow: CommandFlow): boolean;                                   // :97; exists AND active AND flows.includes(flow)
function isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean;               // :107; fail-open if unmapped

// icons.ts
const FEATURE_ICONS: Record<FeatureKey, string>;              // :26; e.g. main -> 'synapse-main', rem -> 'synapse-rem'
function resolveActionIcon(def: CommandDefinition): string;   // :44; def.icon ?? FEATURE_ICONS[def.feature]

// actions.ts
function listPaletteActions(registered: ReadonlySet<string>): CommandDefinition[];   // :22; registry order, only ids that passed register()

// registrar.ts
class CommandRegistrar {                                                              // :22
  constructor(host: { addCommand: (command: Command) => unknown });
  register(id: string, userEnabled: boolean, spec: Omit<Command, 'id' | 'name'>): void;   // :38; name + icon sourced from the registry
  getAttempted(): ReadonlySet<string>;                                                // :61
  getRegistered(): ReadonlySet<string>;                                               // :66
}

// audit.ts
function auditCommands(attempted: ReadonlySet<string>): string[];   // :27; [] when consistent
```

## Precedence

All ANDed; the registry is authoritative:

```
status (dev) -> flow membership (dev) -> settings.[feature].enabled (user) -> runtime predicate (e.g. hasTranscription)
```

`CommandRegistrar.register` calls `host.addCommand` only when
`entry.status === 'active' && entry.flows.includes('palette') && userEnabled`; an unknown id fails open.
A `deprecated`/`disabled` entry never registers or runs in any flow, regardless of user settings.

## Registry (24 entries)

23 real entries + 1 synthetic pipeline-only entry (`tidy-vault`). 6 ship `disabled` (developer master switch). Source: `registry.ts:15-67`.

| ID | Feature | Status | Flows | Context | Icon | pipelineKey |
|----|---------|--------|-------|---------|------|-------------|
| `synapse:review-proposals` | main | active | palette | global | `synapse` | — |
| `synapse:manage-checkpoints` | main | active | palette | global | `synapse-checkpoints` | — |
| `synapse:transcribe-media` | main | disabled | palette | global | `synapse-transcribe` | — |
| `synapse:transcribe-note-media` | main | active | palette | note | `synapse-transcribe` | — |
| `synapse:fire` | main | active | palette | vault | `synapse-fire` | — |
| `synapse:scan-vault` | elaboration | active | palette, fire-synapse, startup | vault | (feature) | elaboration |
| `synapse:scan-current-note` | elaboration | active | palette | note | (feature) | — |
| `synapse:clear-proposals` | elaboration | disabled | palette | global | (feature) | — |
| `synapse:enrich-current-note` | enrichment | active | palette | note | (feature) | — |
| `synapse:scan-vault-enrichment` | enrichment | active | palette, fire-synapse | vault | (feature) | enrichment |
| `synapse:undo-enrichment` | enrichment | disabled | palette | note | (feature) | — |
| `synapse:organize-current-note` | organize | active | palette | note | (feature) | — |
| `synapse:scan-directory-organize` | organize | active | palette, fire-synapse | vault | (feature) | organize |
| `synapse:undo-organize` | organize | disabled | palette | note | (feature) | — |
| `synapse:deep-dive` | deep-dive | active | palette | note | (feature) | — |
| `synapse:clear-deep-dive` | deep-dive | disabled | palette | global | (feature) | — |
| `synapse:summarize-current-note` | summarize | active | palette | note | (feature) | — |
| `synapse:scan-vault-summarize` | summarize | active | palette, fire-synapse | vault | (feature) | summarize |
| `synapse:tidy-current-note` | tidy | active | palette | note | (feature) | — |
| `synapse:undo-tidy` | tidy | disabled | palette | note | (feature) | — |
| `synapse:rem-current-note` | rem | active | palette | note | (feature) | — |
| `synapse:rem-directory` | rem | active | palette, fire-synapse | vault | (feature) | rem |
| `synapse:check-dependencies` | video | active | palette | global | (feature) | — |
| `synapse:tidy-vault` (synthetic) | tidy | active | fire-synapse | vault | (feature) | tidy |

`(feature)` = inherits `FEATURE_ICONS[feature]`.

`tidy-vault` (`registry.ts:66`): tidy is the only Fire Synapse phase with no matching palette command. The pipeline runs `tidy.scanVault()` (vault-wide); `tidy-current-note` runs `tidy()` on one note. The synthetic entry is never passed to `registrar.register()`; the audit ignores it (no `palette` flow).

## Flow integration

- palette — `CommandRegistrar.register` gates `addCommand`. All 23 real commands participate; the 6 `disabled` ones are attempted (so the audit sees them) but never added.
- fire-synapse — `SynapseRunner.fire()` / `fireOnFile()` (`src/pipeline/synapse-runner.ts:18`, `:74`) AND `isPipelineKeyInFlow(phase.key, 'fire-synapse')` into the `settings[phase.key].enabled` filter. Matched via `pipelineKey` (6 pipeline entries).
- startup — `ElaborationModule.onload()` ANDs `isInFlow('scan-vault', 'startup')` into the `scanOnStartup` and `autoScanInterval` conditions.
- actions sidebar (#289) — `main.ts:232` builds `SynapseActionsView` from `listPaletteActions(registrar.getRegistered())`; `context: 'note'` buttons are disabled when no markdown note is active.

## Drift detection (audit.ts)

Run once at the end of `SynapsePlugin.onload()` (`main.ts:503`); reused by `audit.test.ts` so CI fails on drift.

- (a) an `active` palette entry whose feature loaded (>=1 attempt) but was never registered → "no handler".
- (b) a registered id with no `COMMAND_REGISTRY` entry → "missing from registry".

"Feature loaded" is derived from the attempted set (a module's `onload()` is the only caller of `register()` for its commands, and runs iff the feature is enabled). Known limitation: a fully disabled feature produces zero attempts and cannot be drift-checked.

## Dependency Graph

```
src/commands/  (depends on nothing else in src/ — never in an import cycle)
  index.ts     -> types.ts, registry.ts, icons.ts, actions.ts, registrar.ts, audit.ts
  registrar.ts -> registry.ts (REGISTRY_BY_ID), icons.ts (resolveActionIcon), obsidian (Command type)
  actions.ts   -> registry.ts
  audit.ts     -> registry.ts

consumed by:
  main.ts                       -> CommandRegistrar, auditCommands, listPaletteActions, REGISTRY_BY_ID
  elaboration|enrichment|organize|deep-dive|summarize|tidy|rem|video  -> CommandRegistrar (+ elaboration: isInFlow)
  pipeline/synapse-runner.ts    -> isPipelineKeyInFlow
  views/synapse-actions-view.ts -> FEATURE_ICONS (runtime), CommandDefinition + FeatureKey (types)
  views/proposal-styles.ts      -> FeatureKey (type)
```

`CommandDefinition.pipelineKey` is typed `string` (not `PipelineModuleKey`) so `commands/` never imports `pipeline/` — `pipeline/synapse-runner.ts` imports `commands/`, so a back-import would close a cycle. `registry.test.ts` cross-checks the 6 `pipelineKey`s against `SYNAPSE_PIPELINE`.

## How to change command behavior

- Deprecate / disable a command everywhere: set `status` to `'deprecated'` or `'disabled'`.
- Remove from one flow only: drop that flow from `flows`.
- Remove a phase from Fire Synapse: edit the entry carrying that `pipelineKey` (for tidy, the synthetic `tidy-vault` entry).
- Change a `main` command's glyph: edit its `icon`; change a feature's glyph: edit `FEATURE_ICONS` (must match an `addIcon` registration in `src/brand-icons/brand-icons.ts`).
- After any edit, `npm test` runs the registry + audit tests that guard the invariants.
