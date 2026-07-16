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

- `banner-animated.svg` loops the spike draw-on (SMIL — plays in GitHub READMEs). The README hero embeds this file.
- `accept-flash.svg` + `accept-flash.md` — the proposed→accepted motion: 700ms, spike morphs into a bead that lands in the receptor while the cleft bridges. Spec only; not wired into UI.
- Rasterize `social-preview.svg` to PNG (≤1MB) before uploading to repo settings, e.g. `qlmanage -t -s 1280 -o /tmp kit/social-preview.svg`.

## Banner wordmark is outlined, not live text (issue #292)

The wordmark (`synapse`) and tagline in `banner.svg` and `banner-animated.svg` ship as **outlined vector `<path>`s**, not live `<text>`. GitHub serves README images through a sandboxed `<img>`/camo context that can't load webfonts, so live `<text>` in Space Grotesk / Inter fell back to Helvetica/Arial for nearly every visitor — a name-treatment violation on the most visible surface. Outlining removes the font dependency entirely (both fonts are OFL, so outlining is permitted) and keeps the hero crisp at any DPI.

**Consequence:** the wordmark/tagline copy is no longer editable in the SVG. To change the text, regenerate from the recipe below.

**Regeneration recipe** (macOS, produces a font-correct outline identical to the live-text render):

1. Install the exact weights: **Space Grotesk Medium (500)** and **Inter Medium (500)** (Google Fonts / official OFL repos).
2. Lay out each string with HarfBuzz shaping (kerning on) + CSS `letter-spacing`, then convert each glyph to a path with fontTools (`SVGPathPen` through a `TransformPen` that scales `font-size/upem` and flips Y to SVG's y-down), rounding coordinates to 1 decimal. This matches WebKit's live-text layout exactly.
   - Wordmark: `synapse`, Space Grotesk Medium, `font-size` 88, start `x=336`, baseline `y=168`, `letter-spacing=-1.76` (−0.02em), fill `#F3F0FF`.
   - Tagline: `More connections. Brighter thoughts.`, Inter Medium, `font-size` 26, start `x=340`, baseline `y=220`, `letter-spacing=0`, fill `#B7A8FF`.
3. Replace only the two `<text>` elements — the mark, motif, gradient, and SMIL `<animate>` nodes stay untouched.

**Verification:** render a CONTROL of the pre-outline SVG with the fonts installed (`qlmanage -t -s 1280`) and pixel-diff it against the outlined output — full-size geometry must match (residual is edge antialiasing only). Confirm the outlined files contain **no** `<text>` and **no** `font-family` (grep), and check both GitHub light and dark themes (the banner carries its own rounded dark panel, so it reads on either).

> **Standing rule:** any `<text>`-bearing SVG shipped where we don't control installed fonts gets outlined or rasterized first (`social-preview.png` already follows this; `social-preview.svg` still holds live `<text>` and is only shipped as the PNG).
