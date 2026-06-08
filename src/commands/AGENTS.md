---
last-updated: 2026-06-08
---

# Commands Module

Declarative command registry: the developer-facing source of truth for every user-invocable Synapse command, plus the registrar that gates and wires handlers to Obsidian and a drift auditor. Depends on nothing else in `src/` — never participates in an import cycle.

## Public API

Exported from `index.ts`:

```ts
// types.ts
type CommandStatus = 'active' | 'deprecated' | 'disabled'   // only 'active' registers/runs
type CommandFlow = 'palette' | 'fire-synapse' | 'startup'
type FeatureKey = 'main' | 'elaboration' | 'enrichment' | 'organize' | 'deep-dive'
                | 'summarize' | 'tidy' | 'rem' | 'video'
interface CommandDefinition {
  id: string                       // Obsidian command id, e.g. 'synapse:scan-vault'
  name: string                     // palette display name
  feature: FeatureKey
  status: CommandStatus
  flows: readonly CommandFlow[]
  pipelineKey?: string             // links to a PipelineModuleKey; typed string to avoid pipeline import cycle
  note?: string
}

// registry.ts
const COMMAND_REGISTRY: readonly CommandDefinition[]
const REGISTRY_BY_ID: ReadonlyMap<string, CommandDefinition>
const REGISTRY_BY_PIPELINE_KEY: ReadonlyMap<string, CommandDefinition>   // 1:1, throws on dup pipelineKey
function isInFlow(id: string, flow: CommandFlow): boolean                // exists && active && in flow
function isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean  // fail-OPEN on unmapped key

// registrar.ts
class CommandRegistrar {
  constructor(host: { addCommand: (command: Command) => unknown })
  register(id: string, userEnabled: boolean, spec: Omit<Command, 'id'>): void
  getAttempted(): ReadonlySet<string>
  getRegistered(): ReadonlySet<string>
}

// audit.ts
function auditCommands(attempted: ReadonlySet<string>): string[]   // drift warnings; empty when consistent
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `CommandStatus`, `CommandFlow`, `FeatureKey`, `CommandDefinition` | Registry type model |
| `registry.ts` | `COMMAND_REGISTRY`, `REGISTRY_BY_ID`, `REGISTRY_BY_PIPELINE_KEY`, `isInFlow`, `isPipelineKeyInFlow`, `buildPipelineKeyMap` | Source-of-truth registry + flow gates |
| `registrar.ts` | `CommandRegistrar` | Single wiring point to `plugin.addCommand`; gates by status + palette flow + userEnabled |
| `audit.ts` | `auditCommands` | Drift detection between registry and wired handlers |
| `registry.test.ts`, `registrar.test.ts`, `audit.test.ts` | Tests | |
| `index.ts` | re-exports | Barrel |

## Registration Gate

```
CommandRegistrar.register(id, userEnabled, spec)
  --> records id in `attempted`
  --> entry = REGISTRY_BY_ID.get(id)
  --> active   = entry ? entry.status === 'active' : true   (fail-open on unknown id)
  --> inPalette= entry ? entry.flows.includes('palette') : true
  --> if (active && inPalette && userEnabled) plugin.addCommand({id, ...spec}); record in `registered`
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

`auditCommands(attempted)` returns warnings for:
- (a) an `active` palette entry whose feature loaded (>=1 attempt) but was never registered — handler missing.
- (b) a registered id with no `COMMAND_REGISTRY` entry — command in code, missing from registry.

Run once at the end of `main.ts` `onload()` and reused by `registry`/`audit` tests so CI fails on drift.

## Consumers

| Symbol | Used By |
|--------|---------|
| `CommandRegistrar` | `main.ts` + every feature module that registers commands |
| `isPipelineKeyInFlow` | `pipeline/synapse-runner.ts` |
| `isInFlow` | `elaboration/index.ts` (startup flow gating) |
| `auditCommands` | `main.ts` (end of onload) |

## Command Registry (active palette + pipeline)

See root `AGENTS.md` Command Registry for the full table. `status: 'disabled'` entries
(`transcribe-media`, `clear-proposals`, `undo-enrichment`, `undo-organize`, `clear-deep-dive`, `undo-tidy`)
exist in the registry but are gated out of registration. `synapse:tidy-vault` is synthetic
(pipeline-only, `pipelineKey: tidy`, flow `fire-synapse`) and never passed to `register()`.
