---
name: brand-guidelines
description: Brand guidelines for Synapse — brand essence, voice and tone, name treatment, color palette, typography, mark anatomy, and asset usage rules. Source of truth for all user-facing copy and visual assets. Use when writing or reviewing README/docs/UI copy, producing visual assets, or auditing brand consistency.
user-invocable: false
---

# Synapse Brand Guidelines

## Brand essence

**Firing synapses — more connected, higher quality thoughts.**

Synapse is the firing layer of the vault: the instant a stub becomes a real note, a recording becomes linked text, an orphan note jumps the gap and connects. And like a real synapse, nothing fires without crossing a threshold — every change is a proposal, and **the user is the threshold**. Signals sum; the user decides whether the neuron fires.

**Tagline:** *More connections. Brighter thoughts.*
Support line for hero moments only (not the standing tagline): *The spark between your notes.*

## Voice & tone

1. **Charged, not hyped** — energy comes from kinetic verbs (fire, jump, connect, surface); never exclamation points, superlatives, or sparkle-speak.
2. **Precise** — speak in mechanism and exact counts ("Review 3 proposed links", "proximity-weighted scoring"); never "AI magic" or "enhancing your knowledge".
3. **Deferential at the threshold** — every statement about changing the vault is framed as a proposal: *Synapse proposes, you decide*. Undo is as visible as accept.
4. **Neuro- and systems-literate** — real vocabulary (impulse, threshold, edge weight, potentiation) used accurately as working metaphor, grounded in the user's own notes; never decorative jargon or brain-emoji whimsy.
5. **Dry warmth** — short sentences, front-loaded verbs, understated wit in release notes and empty states; never memes, emoji, or anthropomorphizing the AI.

## Name treatment

- In all prose, UI copy, and documentation: **Synapse** — capital S, rest lowercase, one word, set in the body face.
- Outside the Obsidian ecosystem (README intro, directory listing, social), first reference is **Synapse for Obsidian**.
- Lowercase `synapse` is correct only in code, repo names, and the plugin manifest id.
- The wordmark — and only the wordmark — is set all-lowercase "synapse" in Space Grotesk 500 at -0.02em tracking, with one deliberately widened letterspace between "n" and "a": the synaptic cleft. The cleft exists only in the official wordmark lockup; never type it manually in prose.

**Incorrect:** SYNAPSE in running text; SynApse or any internal caps; "Synapse AI" / "SynapseAI" / "Synapse.ai" (never append AI — the deferential safety model is the point, not the AI); "the Synapse"; "Obsidian Synapse" as a product name (the repo slug is exempt); hyphenating or line-breaking the name; full letterspaced treatments (S Y N A P S E).

## Color palette

| Name | Hex | Role |
|------|-----|------|
| Gap Black | `#131019` | Primary brand surface; ink for text on white (18.8:1). Violet-cast near-black that sits natively beside Obsidian's `#1e1e1e`. Never pure `#000`. |
| Dendrite | `#2A2140` | Elevated dark surface — cards, code blocks, panels. On light backgrounds: the fill of dark chips that carry the volt spark. |
| Synapse Violet | `#8b5cf6` | Primary accent on dark surfaces — links, edge strokes, UI accents (4.4:1 on Gap Black; small violet text on dark uses Violet Glow instead). Bridges to Obsidian's accent family. |
| Threshold Violet | `#5b21b6` | Light-surface twin — wordmark fill, headings, links, badges on white (9.0:1, AAA). Never on dark surfaces. |
| Violet Glow | `#A78BFA` | Dark-mode small-text violet — links, icon strokes, emphasis on Gap Black/Dendrite (6.9:1). Gradient endpoint with Synapse Violet for hero art ≥128px only — gradients never enter the mark. |
| Impulse Volt | `#CCFF00` | The firing moment — sole electric accent and the accepted-proposal state (16:1 on Gap Black). Only 1.2:1 on white, so on light backgrounds it appears only inside a Dendrite/Gap Black chip or with a 1.5px Gap Black outline — never as text or thin strokes on white. **One volt element per composition, ever.** |
| Ion White | `#F4F2FB` | Primary text on dark surfaces (17:1 on Gap Black); the brand's light-mode page tint. |

## Typography

- **Wordmark:** Space Grotesk 500, all-lowercase, -0.02em tracking (plus the engineered n–a cleft). SVG-safe stack: `'Space Grotesk', 'Helvetica Neue', Arial, sans-serif`.
- **Body:** Inter 400/500/600 — visually continuous with Obsidian's default UI font. Stack: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. Avoid 700+ except in the tagline.
- **Mono:** JetBrains Mono for code, hotkeys, file paths, frontmatter. Stack: `'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`.

## The mark: "The S-Signal"

The mark is the path of a single impulse. Two Synapse Violet arc segments — the pre- and post-synaptic paths — are interrupted by a charged cleft, with one Impulse Volt spark (teardrop comet, traveling left-to-right) mid-jump across the gap. The geometry happens to trace an "S" (monogram utility at small sizes), but the letter emerges from synapse anatomy, not a font glyph:

- **Filled ball** (top terminal) — the source note.
- **Open, unfilled ring** (bottom terminal) — the proposed connection, not yet accepted. The receptor closes only on "accept" (state/animation variants): the proposal-approval safety model drawn as geometry.
- **Volt spark in the cleft** — the firing moment, carried in its Gap Black chip so it survives white backgrounds.

### Mark principles

1. **Depict the cleft, not the cell** — never a whole brain, neuron silhouette, network globe, or generic node-and-edge graph. Banned: circuit traces, hexagons, chips-on-brains, chat bubbles, four-point sparkle glyphs, lightning-bolt-in-a-circle.
2. **One spark only** — a single Impulse Volt element; no particle fields, scattered sparkles, or radiating lines. One bright element per layout, including marketing.
3. **Directionality encodes the product** — the impulse travels left-to-right toward the open receptor. Motion is implied by offset, taper, and asymmetry — never blur or glow.
4. **Weighted asymmetry on a strict grid** — the two terminals differ in size and form, like real weighted connections. Stroke weight never below 1.5px at a 24px artboard.
5. **Survives 16px monochrome** — must read as a single-color `currentColor` silhouette at 16×16 (Obsidian ribbon icons strip color). Reduce detail at small sizes rather than thinning strokes.
6. **Dark-first, both-proof, flat-only** — designed on Gap Black, verified on white. The canonical mark is flat fills and strokes; the one permitted violet→glow gradient lives only in marketing art ≥128px.

## Assets & usage

Canonical assets live in `assets/brand/` (see its README for inventory and regeneration). Quick rules:

- `icon.svg` — the canonical mark, transparent background, works on dark and white. Use for plugin icon contexts, avatars, favicons, and any render **above ~24px**. Do not recolor, rotate, add glow, or detach the spark.
- `icon-small.svg` — optical-size cut of the S-Signal for renders **at or below ~24px** (16px favicons, 16–24px list/UI icons). Same palette and silhouette, but the cleft is widened, the volt bead enlarged with a thinned Gap Black chip so the lime survives on white, and the receptor is a plain open terminal (the ring detail closes up at small sizes, so it is dropped). Do not use it above ~24px — its sacrificed letterform polish only pays off small.
- `banner.svg` — README hero, self-contained dark background; safe on both GitHub themes. Do not place text over it or crop it.
- **Size cutover:** at ~24px and below, use `icon-small.svg`; above ~24px, use canonical `icon.svg`. The cut exists because the canonical spark merges into the spine below ~24px while the small cut keeps one visible lime point in the gap.
- Clear space around the mark: at least the diameter of the open receptor ring.
- On white at small sizes the spark reads as a dark dot — acceptable; never remove the chip outline to "fix" it. (`icon-small.svg` thins, but never removes, that chip.)

## Known gaps (future work)

- A monochrome `currentColor` ribbon-icon variant for Obsidian's UI.
- Accept-state variant (receptor ring closes) for animations and UI states.
- Run a confusion screen against existing S-arc marks (e.g. legacy Skype, Sketch-class letterforms) before community-directory launch.
