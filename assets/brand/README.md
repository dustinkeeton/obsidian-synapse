# Synapse brand assets

Canonical visual assets for Synapse. The full brand guidelines — palette, typography, voice/tone, name treatment, and mark usage rules — live in [`.claude/skills/brand-guidelines/SKILL.md`](../../.claude/skills/brand-guidelines/SKILL.md); read that before using or modifying anything here.

## Inventory

| Asset | Description | Use for |
|-------|-------------|---------|
| `icon.svg` | "The S-Signal" mark — 256×256 viewBox, transparent background, flat palette colors only | Plugin icon contexts, avatars, favicons, anywhere square **above ~24px** |
| `icon-small.svg` | Optical-size cut of the S-Signal — 256×256 viewBox, transparent, flat palette only. Widened cleft, enlarged volt bead on a thinned Gap Black chip, plain open receptor terminal (ring dropped) | Renders **at or below ~24px**: 16px favicons, 16–24px list/UI icons |
| `icon-mono.svg` | Single-color `currentColor` silhouette of the S-Signal — **`0 0 100 100` viewBox**, transparent, no palette colors. Tightened cleft; the spark bead bridges the cleft so the one-color spine stays whole at 16px | Color-stripping surfaces: Obsidian ribbon/UI (registered as the `synapse` icon), and any monochrome context |
| `banner.svg` | README hero — 1280×320, self-contained dark background, mark + wordmark + tagline | Top of README; safe on both GitHub light and dark themes |

### Size cutover: canonical vs small cut

Use **`icon.svg`** above ~24px and **`icon-small.svg`** at ~24px and below. Below ~24px the canonical spark — the firing moment that carries the whole brand story — merges into the S spine and disappears. `icon-small.svg` deliberately sacrifices letterform polish (wider cleft, fatter bead, plainer receptor) to keep one clearly visible lime point in the gap down to 16px. Above ~24px that trade is unnecessary and the canonical mark's full directional comet and open receptor ring read cleanly — use it there.

Both color variants are for surfaces that **keep** color. For surfaces that strip it, use `icon-mono.svg` (below).

### Monochrome variant (`icon-mono.svg`)

Obsidian's ribbon and UI render icons as a single `currentColor` silhouette — gradients and palette colors are discarded. `icon-mono.svg` is the S-Signal built for exactly that: every stroke and fill is `currentColor`, so the host UI's text color drives it (Ion White on dark, Gap Black on white — verified on both). Where the colored cuts *widen* the cleft to keep the lime spark distinct, the mono cut *tightens* it: in one color the spark bead bridges the cleft and completes the S spine, so the silhouette stays whole down to 16px.

It is authored on a **`0 0 100 100`** viewBox (not the family's 256) because that is Obsidian's `addIcon` convention — the body of this file is the literal string registered as the `synapse` icon in `src/main.ts` (`SYNAPSE_ICON_SVG`). **Keep the two in sync:** if you edit the asset, update the constant (and vice-versa). Use it only on color-stripping or monochrome surfaces; anywhere color survives, use `icon.svg` / `icon-small.svg`.

## The mark in one sentence

An "S" traced by a neural impulse: two violet synaptic arcs broken by a charged cleft, one Impulse Volt spark (`#CCFF00`) firing left-to-right across the gap, from a filled source ball toward an open receptor ring that closes only on accept.

## Hard rules

- Use only palette colors (see guidelines). Never recolor the mark or detach the spark. **Exception:** `icon-mono.svg` is intentionally single-color `currentColor` — no palette colors, no lime accent, no Gap Black chip. It is the only color-agnostic variant; the rules below about the volt spark and its chip do not apply to it.
- **One volt element per composition** — the spark is the only bright accent, ever.
- On white backgrounds the spark keeps its Gap Black outline/chip; never remove it.
- The mark is flat — no glows, blurs, drop shadows, or gradients in the mark itself.
- Don't place text over the banner or crop it.

## Verifying changes

Assets are hand-written SVG. After any edit, render and inspect before committing (macOS, no dependencies):

```sh
qlmanage -t -s 1024 -o /tmp <asset>.svg   # writes /tmp/<asset>.svg.png — open and check
```

Check dark (`#131019`) and white backgrounds, plus a ~48px copy for small-size legibility. The `designer` agent (`.claude/agents/designer.md`) does this loop automatically.

## Wanted (not yet produced)

- Accept-state variant (receptor ring closed) for UI states and animation
