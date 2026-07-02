# Accept-flash — motion spec (Iris + Gold)

The transition from **proposed** (`icon.svg`: live spike, open receptor) to **accepted** (`icon-accepted.svg`: bridged cleft, gold seated in a closed receptor). Total **700 ms**, played once on accept, `fill: freeze`.

| Phase | Time (ms) | What moves | Easing |
|---|---|---|---|
| Charge | 0–120 | Spike pumps: stroke 11 → 13 → 11 (amplitude, not scale) | ease-out |
| Jump | 120–260 | Spike collapses tail-first (dash-offset 0 → length); a gold bead (r13) emerges at its head | cubic-bezier(.3, 0, .9, 1) |
| Travel | 260–480 | Bead rides the axon path into the terminal | cubic-bezier(.2, 0, .55, 1) |
| Bridge | 300–420 | Iris bridge draws across the cleft behind the bead (dash-offset 80 → 0) | ease-in-out |
| Land | 480–620 | Bead settles r18 → 15; receptor ring pops stroke 14 → 18 → 14 | ease-out, one overshoot, no bounce |
| Rest | 620–700 | Hold. End state ≡ `icon-accepted.svg` | — |

Bead path (256 grid): `M174 133 L177.4 141.9 A46 46 0 0 1 107 200.9 L85.7 177.8`

## Rules

- **One gold element at all times.** The spike morphs into the bead — they never coexist for more than one frame.
- **No glow, no blur, no shadow.** Energy is geometry: amplitude, overshoot, squash.
- Motion only on dash-offset, transform, and motion-path (compositor-friendly).
- Never longer than 700 ms — longer reads as ceremony, not confirmation.
- `prefers-reduced-motion`: replace with a 120 ms crossfade from open to accepted. No travel.

## Implementations

- **SMIL reference**: `accept-flash.svg` (looping demo: 600 ms open hold → flash → 1.1 s accepted hold → reset; production plays once and freezes).
- **Obsidian (CSS)**: bead as an element with `offset-path` set to the bead path; spike collapse via `stroke-dashoffset` transition; gate with `matchMedia('(prefers-reduced-motion: reduce)')`.
- End state must compose identically to `icon-accepted.svg` — the flash is a transition between the two shipped marks, never a third look.
