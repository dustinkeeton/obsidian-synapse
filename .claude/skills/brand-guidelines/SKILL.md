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
- `icon-mono.svg` — single-color **`currentColor`** silhouette of the S-Signal for surfaces that strip color: the Obsidian ribbon and UI (registered as the `synapse` icon via `addIcon` in `src/main.ts`), and any monochrome context. Authored on a `0 0 100 100` viewBox (Obsidian's `addIcon` convention) so the asset body doubles as the registered icon string. **Never assign it palette colors** — its color comes from the host UI via `currentColor`; and never use it where full color is available (use `icon.svg` / `icon-small.svg` there). This is the one variant where the cleft is *tightened*, not widened: in monochrome the spark bead bridges the cleft and completes the S spine, so the one-color silhouette stays whole down to 16px. It keeps the weighted asymmetry (filled source ball, plain open receptor terminal) but the spark is no longer a distinct accent — by design, it becomes the connective tissue of the spine.
- `icon-accepted.svg` — **accept-state** cut of the canonical mark (256×256, palette colors, transparent, flat). It is `icon.svg` resolved to the *fired/accepted* state: the charged cleft is bridged in Synapse Violet (the gap has been jumped — the connection is made) and the single Impulse Volt spark has **landed in the receptor**, which is now **closed/filled** rather than an open ring. Use it only to depict the **accepted** outcome of a proposal — accept-button confirmation, an accepted-link badge, the end frame of the accept-flash (below). It is **not** an everyday app icon: where you'd show the neutral mark, use `icon.svg`. The two are a deliberate state *pair* (open/proposed ↔ accepted/closed); never use the accepted cut as the default identity. Still one volt element — the landed bead — carrying its Gap Black chip so it survives on white. Sized like the canonical mark: use **above ~24px** (it has no dedicated small cut; the spark merges into the spine below that, same as `icon.svg`).
- `banner.svg` — README hero, self-contained dark background; safe on both GitHub themes. Do not place text over it or crop it.
- **Size cutover:** at ~24px and below, use `icon-small.svg`; above ~24px, use canonical `icon.svg`. The cut exists because the canonical spark merges into the spine below ~24px while the small cut keeps one visible lime point in the gap.
- Clear space around the mark: at least the diameter of the open receptor ring.
- On white at small sizes the spark reads as a dark dot — acceptable; never remove the chip outline to "fix" it. (`icon-small.svg` thins, but never removes, that chip.)

## Accept-flash motion spec (open → closed)

The brand's center of gravity is the accept moment, so it gets one sanctioned animation: the **accept-flash**, which morphs the open/proposed mark (`icon.svg`) into the accepted/closed mark (`icon-accepted.svg`). Intended for an accept confirmation in the proposal review UI (e.g. the proposal sidebar). **This is a spec only** — it is not wired into any `src/views/` code; wiring it into UI is a separate decision. Build it from these constraints, not from instinct:

- **Total ~400 ms**, three phases. All motion is conveyed by **position, the receptor fill, and one brief scale tick** — never by blur, glow, drop shadow, or gradient (the flat-only rule holds at every frame).
- **Phase A — Travel & bridge (0–220 ms, `cubic-bezier(0.4, 0, 0.2, 1)`).** The single lime element (the cleft comet) translates along the spine from the cleft (~127,125 in the 256 viewBox) down-left to the receptor center (85.7,177.8), and as it decelerates its directional teardrop **retracts into a round bead** (motion taper → at rest). One element reshaping — not a swap. In parallel the violet cleft bridge (the `Q` waist of `icon-accepted.svg`) **wipes in left-to-right** (firing direction; via `stroke-dashoffset`), so by 220 ms the gap is jumped and the connection is solid violet.
- **Phase B — Seat & fill (220–340 ms, `cubic-bezier(0, 0, 0.2, 1)`).** The bead reaches the receptor and **seats**: it grows to its final `r=15` and the open violet ring reads **closed/filled**. The bead's Gap Black chip (`#131019` outline) is present from the instant it seats, so the lime survives if the surface is light.
- **Phase C — Accept tick (340–400 ms, ease-out).** One brief settle pulse on the landed bead: **scale 1.0 → 1.08 → 1.0**. That is the entire highlight — no color shift brighter than Impulse Volt, no halo, no glow. End frame is `icon-accepted.svg` exactly.
- **One-volt-rule compliance (explicit).** There is exactly **one** Impulse Volt element at every frame: the cleft spark and the receptor bead are *the same continuous element* that travels and reshapes. The bridge and ring are always Synapse Violet, never lime. No spark trail, particle shower, or secondary glint at any frame.
- **Undo is as visible as accept** (voice rule 3): the un-accept plays the same timeline **reversed at the same duration** (never faster) — the bead un-seats, re-tapers into the comet, travels back into the cleft, and the violet bridge wipes back out, restoring `icon.svg`.
- **Reduced motion:** honor `prefers-reduced-motion` with an instant hard swap `icon.svg` → `icon-accepted.svg` (no tween). A cross-fade would momentarily show two lime shapes, breaking the one-volt rule — so cut, don't dissolve.

## Known gaps (future work)

- Run a confusion screen against existing S-arc marks (e.g. legacy Skype, Sketch-class letterforms) before community-directory launch.
