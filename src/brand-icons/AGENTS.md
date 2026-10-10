---
last-updated: 2026-10-09
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
// brand-icons.ts:68 — addIcon(name, svg) for every SYNAPSE_ICONS entry
function registerSynapseIcons(): void
```

## Icon Keys

`SYNAPSE_ICONS` keys, in declaration order (`brand-icons.ts:42-60`): 15 entries.

| Key | Line | Referenced by |
|-----|------|---------------|
| `synapse` | 42 | `main.ts:215` ribbon; `views/unified-proposal-view.ts:74` `getIcon`; `commands/registry.ts` (`review-proposals` icon) |
| `synapse-actions` | 45 | `main.ts:217` ribbon; `views/synapse-actions-view.ts:67` `getIcon` |
| `synapse-transcribe` | 47 | `main.ts:216` ribbon; `commands/registry.ts` (`transcribe-media`, `transcribe-note-media`) |
| `synapse-fire` | 48 | `commands/registry.ts` (`fire`) |
| `synapse-checkpoints` | 49 | `commands/registry.ts` (`manage-checkpoints`) |
| `synapse-main` | 51 | `commands/icons.ts` `FEATURE_ICONS.main` |
| `synapse-elaboration` .. `synapse-rem` | 52-58 | `commands/icons.ts` `FEATURE_ICONS` (elaboration, enrichment, organize, deep-dive, summarize, tidy, rem) |
| `synapse-illustrate` | 59 | `commands/icons.ts:35` `FEATURE_ICONS.illustrate`; glyph asset `assets/brand/glyphs/synapse-illustrate.svg` |
| `synapse-video` | 60 | `commands/icons.ts` `FEATURE_ICONS.video` |

The `synapse-illustrate` callout identity (`shared/callouts.ts:21`) shares the name only; its callout icon is `lucide-image` (`styles.css:146-149`), not this glyph.

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
