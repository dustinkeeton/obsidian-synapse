# Synapse brand assets

Canonical visual assets for Synapse. The full brand guidelines — palette, typography, voice/tone, name treatment, and mark usage rules — live in [`.claude/skills/brand-guidelines/SKILL.md`](../../.claude/skills/brand-guidelines/SKILL.md); read that before using or modifying anything here.

## Inventory

| Asset | Description | Use for |
|-------|-------------|---------|
| `icon.svg` | "The S-Signal" mark — 256×256 viewBox, transparent background, flat palette colors only | Plugin icon contexts, avatars, favicons, anywhere square **above ~24px** |
| `icon-small.svg` | Optical-size cut of the S-Signal — 256×256 viewBox, transparent, flat palette only. Widened cleft, enlarged volt bead on a thinned Gap Black chip, plain open receptor terminal (ring dropped) | Renders **at or below ~24px**: 16px favicons, 16–24px list/UI icons |
| `icon-mono.svg` | Single-color `currentColor` silhouette of the S-Signal — **`0 0 100 100` viewBox**, transparent, no palette colors. Tightened cleft; the spark bead bridges the cleft so the one-color spine stays whole at 16px. The `synapse` body in `registerSynapseIcons()` (`src/brand-icons.ts`) is kept byte-synced with this file's inner content | Color-stripping surfaces: Obsidian ribbon/UI (registered as the `synapse` icon), and any monochrome context |
| `glyphs/*.svg` | The Synapse **UI glyph set** — 13 mono `currentColor` icons on **`0 0 100 100` viewBox**, flat, no palette colors. Feature/action glyphs for the Synapse Actions sidebar and commands (see [Glyph set](#glyph-set-glyphs) below) | Registered via `registerSynapseIcons()` in `src/brand-icons.ts`; rendered by the host UI and feature-tinted in the Synapse Actions sidebar |
| `icon-accepted.svg` | **Accept-state** cut of the S-Signal — 256×256, transparent, flat palette only. The cleft is bridged in violet (gap jumped) and the single Impulse Volt spark has **landed in the receptor**, now closed/filled instead of an open ring | The **accepted** outcome of a proposal: accept-button confirmation, accepted-link badges, the end frame of the accept-flash. Pairs with `icon.svg` (open) — not the default identity. Use **above ~24px** |
| `banner.svg` | README hero — 1280×320, self-contained dark background, mark + wordmark + tagline | Top of README; safe on both GitHub light and dark themes |
| `social-preview.svg` / `social-preview.png` | GitHub social preview (og:image) — 1280×640 full-bleed dark, hero-scale mark + wordmark + "for Obsidian" + standing tagline; PNG is the uploadable render (<1 MB) | Repo Settings → Social preview; link unfurls (Slack/Discord/X). Critical ink stays ≥64px from edges (client crops/rounding). Not for the README (that is `banner.svg`); don't crop or overlay text |

### Size cutover: canonical vs small cut

Use **`icon.svg`** above ~24px and **`icon-small.svg`** at ~24px and below. Below ~24px the canonical spark — the firing moment that carries the whole brand story — merges into the S spine and disappears. `icon-small.svg` deliberately sacrifices letterform polish (wider cleft, fatter bead, plainer receptor) to keep one clearly visible lime point in the gap down to 16px. Above ~24px that trade is unnecessary and the canonical mark's full directional comet and open receptor ring read cleanly — use it there.

Both color variants are for surfaces that **keep** color. For surfaces that strip it, use `icon-mono.svg` (below).

### Monochrome variant (`icon-mono.svg`)

Obsidian's ribbon and UI render icons as a single `currentColor` silhouette — gradients and palette colors are discarded. `icon-mono.svg` is the S-Signal built for exactly that: every stroke and fill is `currentColor`, so the host UI's text color drives it (Ion White on dark, Gap Black on white — verified on both). Where the colored cuts *widen* the cleft to keep the lime spark distinct, the mono cut *tightens* it: in one color the spark bead bridges the cleft and completes the S spine, so the silhouette stays whole down to 16px.

It is authored on a **`0 0 100 100`** viewBox (not the family's 256) because that is Obsidian's `addIcon` convention — the inner content of this file is the literal string registered as the `synapse` icon by `registerSynapseIcons()` in `src/brand-icons.ts`. **Keep the two in sync:** if you edit the asset, update the registered `synapse` body (and vice-versa). Use it only on color-stripping or monochrome surfaces; anywhere color survives, use `icon.svg` / `icon-small.svg`.

### Glyph set (`glyphs/`)

The `glyphs/` folder holds the **Synapse UI glyph set**: 13 monochrome `currentColor` icons, one per feature/action, authored on the same **`0 0 100 100`** viewBox as `icon-mono.svg`. Their inner content is registered via **`registerSynapseIcons()` in `src/brand-icons.ts`** (alongside the `synapse` body, which stays byte-synced with `icon-mono.svg`). The host UI supplies the color, and the **Synapse Actions sidebar tints each glyph per feature** (elaboration→blue, enrichment→green, organize→orange, deep-dive→purple, rem→pink, summarize→red, tidy→orange, video→yellow, main→muted). Never bake palette colors in — they are `currentColor` only.

| Glyph | Subject |
|-------|---------|
| `synapse-elaboration` | Stub note + lines growing outward (expand a stub into a full note) |
| `synapse-enrichment` | Note + short connector stubs ending in open terminals (attach metadata) |
| `synapse-organize` | A note filed into a folder |
| `synapse-deep-dive` | Note + magnifier penetrating the page (examine one note in depth) |
| `synapse-summarize` | Lines condensing inward into a note (mirror of elaboration) |
| `synapse-tidy` | A note whose ragged lines resolve to flush-aligned (normalize/align) |
| `synapse-rem` | Two notes (filled source + outlined relation) joined by one link |
| `synapse-video` | Media panel + play triangle (external media/tooling) |
| `synapse-main` | A plain note — neutral fallback, deliberately low-energy |
| `synapse-transcribe` | Audio waveform + note (sound → linked text; also the Transcribe ribbon) |
| `synapse-fire` | A folder with one bold arrow sweeping through it (run all features over a directory) |
| `synapse-checkpoints` | Resume triangle + a broken ring (manage/resume interrupted runs) |
| `synapse-actions` | A panel with an arrow emerging (open the Synapse actions panel/launcher) |

These are line/silhouette glyphs that share one system: a ~76×76 live area, a single stroke weight (~8 at the artboard), round caps and joins throughout, one consistent rounded-rect radius for panels/folders, and **one canonical note shape** (a rounded portrait page) used identically wherever a note appears. Solid fill marks the single *subject* of each action; everything else is outlined. **The spark, cleft, and S-spine are reserved for `synapse` (the `icon-mono.svg` body) and appear in none of these glyphs.**

### Accept-state variant (`icon-accepted.svg`)

The canonical mark encodes the proposal-approval safety model as geometry: the impulse jumps toward an **open, unfilled receptor ring** — a proposed connection, not yet accepted. `icon-accepted.svg` is that mark resolved to the moment of **accept**: the charged cleft is bridged in Synapse Violet (the gap has been jumped — the connection is made) and the single Impulse Volt spark has **landed in the receptor**, which is now **closed/filled** instead of an open ring. The spark sheds its directional comet taper and settles into a round bead at rest, seated in the receptor with its Gap Black chip intact so the lime survives on white.

It is still **one volt element** — the landed bead is the only lime in the composition. Use it only to show the **accepted** outcome (accept-button confirmation, accepted-link badge, the end frame of the accept-flash); it is a state *pair* with `icon.svg` (open/proposed), **not** a replacement default identity. Size it like the canonical mark — **above ~24px**; it has no dedicated small cut.

The **open → closed motion spec** (the accept-flash) lives in the brand guidelines under *Accept-flash motion spec*: timing, what the single volt element does frame-to-frame, how the receptor fills, the explicit one-volt-rule compliance, and the no-glow/no-blur rule. It is spec only — not wired into any UI.

## The mark in one sentence

An "S" traced by a neural impulse: two violet synaptic arcs broken by a charged cleft, one Impulse Volt spark (`#CCFF00`) firing left-to-right across the gap, from a filled source ball toward an open receptor ring that closes only on accept.

## Hard rules

- Use only palette colors (see guidelines). Never recolor the mark or detach the spark. **Exception:** `icon-mono.svg` and everything in `glyphs/` are intentionally single-color `currentColor` — no palette colors, no lime accent, no Gap Black chip. They are the color-agnostic variants; the rules below about the volt spark and its chip do not apply to them.
- **One spark, one owner.** The spark / cleft / S-spine belongs to `synapse` (`icon-mono.svg`) alone. No `glyphs/` icon may contain a spark, lime, cleft, or an "S" silhouette.
- **One volt element per composition** — the spark is the only bright accent, ever.
- On white backgrounds the spark keeps its Gap Black outline/chip; never remove it.
- The mark is flat — no glows, blurs, drop shadows, or gradients in the mark itself.
- Don't place text over the banner or crop it.

## Verifying changes

Assets are hand-written SVG. After any edit, render and inspect before committing (macOS, no dependencies):

```sh
qlmanage -t -s 1024 -o /tmp <asset>.svg   # writes /tmp/<asset>.svg.png — open and check
```

Check dark (`#131019`) and white backgrounds, plus a ~48px copy for small-size legibility. For the `glyphs/` set, **16px is the design size** — render each glyph at ~16px *and* ~48px on both backgrounds and confirm crisp single-color legibility; reduce detail (never thin strokes below ~6.25 at the 100 artboard) if a glyph muddies at 16px. The `designer` agent (`.claude/agents/designer.md`) does this loop automatically.

## Wanted (not yet produced)

- _Nothing currently open. The UI glyph set (`glyphs/`), the accept-state variant (`icon-accepted.svg`), and the accept-flash motion spec are done; see above._
