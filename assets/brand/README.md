# Synapse brand kit — Iris + Gold (2026 refresh)

Drop-in replacement for `assets/brand/`. The S is now **fired**: an action-potential spike in gold slashes the synaptic cleft of the iris S. One system, two tiers.

## Palette

| Role | Value | Use |
|------|-------|-----|
| Iris | `#5A3EF0` | Brand body (arcs, soma, receptor), UI accents |
| Gold | `#FFD23F` | The impulse — the only color Synapse insists on everywhere |
| Gold (light surfaces) | `#E8B419` | Same hue, deepened for contrast on white |
| Ground | `#0A0718` | Brand dark; also the spike's chip on light backgrounds |
| Ion | `#F3F0FF` | Text on dark |
| Lilac | `#B7A8FF` | Secondary text on dark |
| App body | `currentColor` | In-app marks/glyphs inherit the theme's ink |

**Volt lime (`#CCFF00`) is retired.** The old violet `#8b5cf6` is superseded by Iris.

## Two tiers

- **Identity tier** (README, social, store, avatars): full-color marks — `icon.svg`, `icon-small.svg` (≤24px), `icon-accepted.svg`, `banner.svg` / `banner-animated.svg`, `social-preview.svg`.
- **Theme tier** (ribbon, sidebars, commands): `icon-mono.svg` + `glyphs/` — body is `currentColor`, impulse is `var(--synapse-gold, #FFD23F)`. Define in `styles.css`:

```css
body { --synapse-gold: #FFD23F; }
.theme-light { --synapse-gold: #E8B419; }
```

## The glyph grammar (Topology)

Soma (filled) = what exists · ring (open) = what's proposed · line = connection · **gold = what Synapse adds** (the act, or on Enrich, the added metadata). Verb → shape: expand=fan · attach=gold leaves · condense=merge · file=tree · run-all=cascade · examine=dive · format=wave→line · link=bridge.

Exceptions: `synapse-main` is deliberately impulse-free (neutral fallback). `synapse-actions` is the S itself at glyph weight — the brain is retired; the neuron (`icon-mono`) remains the proposals mark.

## Hard rules

- One gold gesture per composition (Enrich's leaf set counts as one gesture).
- On white, the identity spike keeps its Ground chip; never remove it.
- Flat only — no glows, blurs, shadows; gradients allowed on backgrounds, never in the mark.
- Use `icon-small.svg` at or below ~24px; the canonical spike merges below that.
- Keep `glyphs/` byte-synced with `registerSynapseIcons()` in `src/brand-icons.ts`.

## Notes

- `banner-animated.svg` loops the spike draw-on (SMIL — plays in GitHub READMEs).
- `accept-flash.svg` + `accept-flash.md` — the proposed→accepted motion: 700ms, spike morphs into a bead that lands in the receptor while the cleft bridges. Spec only; not wired into UI.
- Rasterize `social-preview.svg` to PNG (≤1MB) before uploading to repo settings, e.g. `qlmanage -t -s 1280 -o /tmp kit/social-preview.svg`.
