---
last-updated: 2026-09-14
---

# Brand Icons Module

Registers the Synapse SVG icon set with Obsidian (`addIcon`): the S-Signal identity mark plus per-feature glyphs. Must run before any ribbon / `setIcon` / view use (`main.ts` calls it first in `onload`). Glyph bodies are byte-synced with `assets/brand/glyphs/*.svg`; `brand-icons.test.ts` reads those files and fails on drift.

## Public API

Exported from `index.ts`:

```ts
// brand-icons.ts:28 — S-Signal mark body (currentColor + one gold `var(--synapse-gold, #FFD23F)` gesture)
const SYNAPSE_ICON_SVG: string
// brand-icons.ts:40 — icon name -> SVG body; every key is registered
const SYNAPSE_ICONS: Readonly<Record<string, string>>
// brand-icons.ts:67
function registerSynapseIcons(): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `SYNAPSE_ICON_SVG`, `SYNAPSE_ICONS`, `registerSynapseIcons` | Barrel |
| `brand-icons.ts` | same | Icon bodies + registration loop |
| `brand-icons.test.ts` | Tests | Asset sync (`assets/brand/`), color rule, `FEATURE_ICONS` / `COMMAND_REGISTRY` icon names resolve |

## Dependencies

| Import | From | File |
|--------|------|------|
| `addIcon` | `obsidian` | `brand-icons.ts:18` |

Consumers: `main.ts` (`registerSynapseIcons`). Icon NAMES are referenced by `commands/icons.ts` (`FEATURE_ICONS`), `commands/registry.ts`, and `views/synapse-actions-view.ts`; those modules do not import this one.
