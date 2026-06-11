# Synapse brand assets

Canonical visual assets for Synapse. The full brand guidelines — palette, typography, voice/tone, name treatment, and mark usage rules — live in [`.claude/skills/brand-guidelines/SKILL.md`](../../.claude/skills/brand-guidelines/SKILL.md); read that before using or modifying anything here.

## Inventory

| Asset | Description | Use for |
|-------|-------------|---------|
| `icon.svg` | "The S-Signal" mark — 256×256 viewBox, transparent background, flat palette colors only | Plugin icon contexts, avatars, favicons, anywhere square |
| `banner.svg` | README hero — 1280×320, self-contained dark background, mark + wordmark + tagline | Top of README; safe on both GitHub light and dark themes |

## The mark in one sentence

An "S" traced by a neural impulse: two violet synaptic arcs broken by a charged cleft, one Impulse Volt spark (`#CCFF00`) firing left-to-right across the gap, from a filled source ball toward an open receptor ring that closes only on accept.

## Hard rules

- Use only palette colors (see guidelines). Never recolor the mark or detach the spark.
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

- ≤24px optical-size icon variant (larger cleft + spark)
- Monochrome `currentColor` variant for the Obsidian ribbon
- Accept-state variant (receptor ring closed) for UI states and animation
