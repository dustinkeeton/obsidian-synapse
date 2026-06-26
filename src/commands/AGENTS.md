---
last-updated: 2026-06-25
---

# Commands Module

Declarative command registry: the developer-facing source of truth for every user-invocable Synapse command, plus the registrar that gates and wires handlers to Obsidian, an icon-name contract, and a drift auditor. Depends on nothing else in `src/` — never participates in an import cycle.

## Public API

Barrel re-exports from `index.ts` (`index.ts:L14`). Note: `buildPipelineKeyMap` is exported from `registry.ts` but NOT re-exported through the barrel (test-only).

```ts
// types.ts
type CommandStatus = 'active' | 'deprecated' | 'disabled'   // only 'active' registers/runs   (types.ts:L11)
type CommandFlow = 'palette' | 'fire-synapse' | 'startup'                                       // (types.ts:L14)
type CommandContext = 'note' | 'vault' | 'global'           // runtime env; drives sidebar gating (types.ts:L25)
type FeatureKey = 'main' | 'elaboration' | 'enrichment' | 'organize' | 'deep-dive'
               | 'summarize' | 'tidy' | 'rem' | 'video'                                          // (types.ts:L28)

interface CommandDefinition {                                                                   // (types.ts:L40)
  id: string                       // command id WITHOUT plugin prefix, e.g. 'scan-vault' (Obsidian -> 'synapse:scan-vault')
  name: string                     // command-palette display name
  feature: FeatureKey
  status: CommandStatus
  flows: readonly CommandFlow[]
  context: CommandContext          // required: 'note' | 'vault' | 'global'
  icon?: string                    // addIcon glyph name overriding FEATURE_ICONS[feature]; main entries set it
  pipelineKey?: string             // links to a PipelineModuleKey; typed string to avoid pipeline import cycle
  note?: string                    // free-form developer note
}

// registry.ts
const COMMAND_REGISTRY: readonly CommandDefinition[]                                             // (registry.ts:L15)
const REGISTRY_BY_ID: ReadonlyMap<string, CommandDefinition>                                     // (registry.ts:L70)
function buildPipelineKeyMap(commands: readonly CommandDefinition[]): Map<string, CommandDefinition>  // throws on dup pipelineKey (registry.ts:L78)
const REGISTRY_BY_PIPELINE_KEY: ReadonlyMap<string, CommandDefinition>   // 1:1, built via buildPipelineKeyMap (registry.ts:L93)
function isInFlow(id: string, flow: CommandFlow): boolean                // exists && active && in flow (registry.ts:L97)
function isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean  // fail-OPEN on unmapped key (registry.ts:L107)

// icons.ts
const FEATURE_ICONS: Record<FeatureKey, string>     // default glyph name per feature; build fails if a key is missing (icons.ts:L26)
function resolveActionIcon(def: CommandDefinition): string   // def.icon ?? FEATURE_ICONS[def.feature] (icons.ts:L44)

// actions.ts
function listPaletteActions(registered: ReadonlySet<string>): CommandDefinition[]   // registry entries that passed register()'s gate, in registry order (actions.ts:L22)

// registrar.ts
class CommandRegistrar {                                                                         // (registrar.ts:L22)
  constructor(host: { addCommand: (command: Command) => unknown })
  register(id: string, userEnabled: boolean, spec: Omit<Command, 'id' | 'name'>): void   // (registrar.ts:L38)
  getAttempted(): ReadonlySet<string>                                                     // (registrar.ts:L61)
  getRegistered(): ReadonlySet<string>                                                    // (registrar.ts:L66)
}

// audit.ts
function auditCommands(attempted: ReadonlySet<string>): string[]   // drift warnings; empty when consistent (audit.ts:L27)
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `CommandStatus`, `CommandFlow`, `CommandContext`, `FeatureKey`, `CommandDefinition` | Registry type model |
| `registry.ts` | `COMMAND_REGISTRY`, `REGISTRY_BY_ID`, `REGISTRY_BY_PIPELINE_KEY`, `isInFlow`, `isPipelineKeyInFlow`, `buildPipelineKeyMap` | Source-of-truth registry + flow gates |
| `icons.ts` | `FEATURE_ICONS`, `resolveActionIcon` | Icon-name contract; default feature glyph + per-action override resolution (no `addIcon` here) |
| `registrar.ts` | `CommandRegistrar` | Single wiring point to `plugin.addCommand`; gates by status + palette flow + userEnabled |
| `actions.ts` | `listPaletteActions` | Derives the Synapse actions sidebar button list from the registry + `getRegistered()` |
| `audit.ts` | `auditCommands` | Drift detection between registry and wired handlers |
| `index.ts` | re-exports | Barrel (omits `buildPipelineKeyMap`) |
| `registry.test.ts`, `registrar.test.ts`, `actions.test.ts`, `audit.test.ts` | Tests | |

## Registration Gate

```
CommandRegistrar.register(id, userEnabled, spec)              // registrar.ts:L38
  --> records id in `attempted`
  --> entry    = REGISTRY_BY_ID.get(id)
  --> active   = entry ? entry.status === 'active'        : true   (fail-open on unknown id)
  --> inPalette= entry ? entry.flows.includes('palette')  : true
  --> if (active && inPalette && userEnabled):
        name = entry ? entry.name : id                     // label sourced from registry, not the spec
        icon = entry ? resolveActionIcon(entry) : undefined
        host.addCommand({ id, name, ...(icon ? {icon} : {}), ...spec })   // caller-supplied spec.icon still wins
        record id in `registered`
```

Precedence (all ANDed, registry authoritative):
`status (dev) -> flow membership (dev) -> settings.[feature].enabled (user) -> runtime predicate`

## Flow Codes

| Flow | Meaning |
|------|---------|
| `palette` | Listed in the Obsidian command palette |
| `fire-synapse` | Runs as a Fire Synapse pipeline phase (gated via `isPipelineKeyInFlow`) |
| `startup` | Eligible to run on plugin startup |

## Drift Audit

`auditCommands(attempted)` (`audit.ts:L27`) returns warnings for:
- (a) an `active` palette entry whose feature loaded (>=1 attempt) but was never registered — handler missing.
- (b) a registered id with no `COMMAND_REGISTRY` entry — command in code, missing from registry.

A fully disabled feature (onload never runs) produces zero attempts and so cannot be drift-checked. Run once at the end of `main.ts` `onload()` and reused by `registry`/`audit` tests so CI fails on drift.

## Command Registry

24 entries: 23 real (registered via `register()`) + 1 synthetic pipeline-only (`tidy-vault`, never registered). 6 ship `status: 'disabled'` as a developer master switch and are gated out of registration. Source: `registry.ts:L15`. All palette entries omit an explicit `icon` and inherit `FEATURE_ICONS[feature]` except the 5 `main` entries (icons: `review-proposals`=synapse, `manage-checkpoints`=synapse-checkpoints, `transcribe-media`=synapse-transcribe, `transcribe-note-media`=synapse-transcribe, `fire`=synapse-fire).

| id | name | feature | status | flows | context | pipelineKey |
|----|------|---------|--------|-------|---------|-------------|
| `review-proposals` | Open proposal review sidebar | main | active | palette | global | — |
| `manage-checkpoints` | Manage interrupted operations | main | active | palette | global | — |
| `transcribe-media` | Transcribe media | main | disabled | palette | global | — |
| `transcribe-note-media` | Transcribe current note | main | active | palette | note | — |
| `fire` | Run all features on a folder | main | active | palette | vault | — |
| `scan-vault` | Scan folder for stub notes | elaboration | active | palette, fire-synapse, startup | vault | elaboration |
| `scan-current-note` | Elaborate current note | elaboration | active | palette | note | — |
| `clear-proposals` | Clear all pending proposals | elaboration | disabled | palette | global | — |
| `enrich-current-note` | Enrich current note | enrichment | active | palette | note | — |
| `scan-vault-enrichment` | Scan folder for enrichment | enrichment | active | palette, fire-synapse | vault | enrichment |
| `undo-enrichment` | Undo last enrichment on current note | enrichment | disabled | palette | note | — |
| `organize-current-note` | Organize current note | organize | active | palette | note | — |
| `scan-directory-organize` | Scan folder for organization | organize | active | palette, fire-synapse | vault | organize |
| `undo-organize` | Undo last organize on current note | organize | disabled | palette | note | — |
| `deep-dive` | Deep dive current note | deep-dive | active | palette | note | — |
| `clear-deep-dive` | Clear deep dive proposals | deep-dive | disabled | palette | global | — |
| `summarize-current-note` | Summarize current note | summarize | active | palette | note | — |
| `scan-vault-summarize` | Scan folder for notes to summarize | summarize | active | palette, fire-synapse | vault | summarize |
| `tidy-current-note` | Tidy current note | tidy | active | palette | note | — |
| `undo-tidy` | Undo last tidy on current note | tidy | disabled | palette | note | — |
| `rem-current-note` | REM: discover links in current note | rem | active | palette | note | — |
| `rem-directory` | Scan folder for links | rem | active | palette, fire-synapse | vault | rem |
| `check-dependencies` | Check external tool availability | video | active | palette | global | — |
| `tidy-vault` | Scan folder for notes to tidy | tidy | active | fire-synapse | vault | tidy |

`tidy-vault` is synthetic: pipeline-only, never passed to `register()`. The pipeline runs `tidy.scanVault()` (vault-wide) under `pipelineKey: 'tidy'`, distinct from the `tidy-current-note` palette command which runs `tidy()` on one note. See `registry.ts:L60`.

## Consumers

| Symbol | Used By |
|--------|---------|
| `CommandRegistrar` | `main.ts` + every feature module that registers commands |
| `isPipelineKeyInFlow` | `pipeline/synapse-runner.ts` |
| `isInFlow` | `elaboration/index.ts` (startup flow gating) |
| `auditCommands` | `main.ts` (end of onload) |
| `listPaletteActions` | `main.ts` (Synapse actions sidebar factory) -> `views/synapse-actions-view.ts` |
| `resolveActionIcon` / `FEATURE_ICONS` | `registrar.ts` (palette command icons); Synapse actions sidebar |
| `context` field | `views/synapse-actions-view.ts` (disables `note` buttons when no markdown note is active); `main.runCommand` re-activates the note leaf for `context: 'note'` commands |
