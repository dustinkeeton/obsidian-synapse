/**
 * Bespoke Synapse icon glyphs, registered with Obsidian's `addIcon` (#349).
 *
 * Each value is SVG *inner content* on the `0 0 100 100` viewBox `addIcon`
 * expects, drawn in `currentColor` — the host UI supplies the color (ribbon/
 * palette render mono; the Synapse actions sidebar tints per feature via CSS).
 *
 * The glyph NAMES are the contract in `src/commands/icons.ts` (`FEATURE_ICONS`
 * + the per-action `icon` overrides in the registry); keep this map in lockstep
 * with those names. The bodies are the normalized inner content of the authored
 * assets in `assets/brand/` (the `synapse` mark mirrors
 * `assets/brand/icon-mono.svg`; every other glyph mirrors
 * `assets/brand/glyphs/<name>.svg`). `brand-icons.test.ts` reads those files and
 * fails if a body drifts out of sync, so edit the asset and this map together.
 */

import { addIcon } from 'obsidian';

/**
 * Monochrome `currentColor` in-app proposals mark: a NEURON (dendrites, a filled
 * soma, and an axon carrying one round-capped impulse), built around the brand's
 * impulse/charge idea (#349 review). Mirrors `assets/brand/icon-mono.svg` and
 * INTENTIONALLY diverges from the canonical full-color S-Signal (`icon.svg` etc.),
 * which is unchanged. Do not recolor; the color comes from the host UI via
 * `currentColor`.
 */
export const SYNAPSE_ICON_SVG =
	'<path d="M34 46 L25 39 M25 39 L19 31 M19 31 L20 22 M19 31 L11 27 M25 39 L14 45" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/> ' +
	'<circle cx="43" cy="50" r="14" fill="currentColor"/> ' +
	'<path d="M57 50 L65 50 L71 40 L78 60 L84 50 L91 50" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * name -> inner SVG content for every Synapse-registered glyph. Keys MUST match
 * the names in `src/commands/icons.ts` and the ribbon/view references in
 * `src/main.ts` / `src/views/synapse-actions-view.ts`. The per-feature and
 * per-action glyphs share one line-icon system (round caps/joins, one stroke
 * weight, a canonical note shape, filled = the action's subject). The two in-app
 * identity marks `synapse` (neuron) and `synapse-actions` (brain) each carry a
 * round-capped impulse and intentionally diverge from the canonical S-Signal;
 * the remaining glyphs stay impulse-free.
 */
export const SYNAPSE_ICONS: Readonly<Record<string, string>> = {
	// In-app proposals identity mark — neuron (proposals ribbon + proposal views).
	synapse: SYNAPSE_ICON_SVG,
	// Launcher (Synapse actions ribbon + sidebar view = brain) + per-action overrides.
	'synapse-actions': '<g transform="translate(-1 -7.5) scale(1.08)"> <path d="M24 70 a16 14 0 0 1 -2 -26 a13 13 0 0 1 6 -16 a14 13 0 0 1 18 -2 a14 13 0 0 1 18 2 a13 13 0 0 1 6 16 a16 14 0 0 1 -2 26 a16 16 0 0 1 -22 4 a16 16 0 0 1 -22 -4 Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/> <path d="M50 25 V37 M50 63 V76" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/> <path d="M30 51 L43 51 L49 42 L56 59 L62 51 L70 51" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/> </g>',
	'synapse-transcribe': '<path d="M13 44 V56" stroke="currentColor" stroke-width="7.5" stroke-linecap="round"/> <path d="M24 32 V68" stroke="currentColor" stroke-width="7.5" stroke-linecap="round"/> <path d="M35 40 V60" stroke="currentColor" stroke-width="7.5" stroke-linecap="round"/> <rect x="50" y="22" width="37" height="56" rx="8" fill="currentColor"/>',
	'synapse-fire': '<path d="M14 78 a6 6 0 0 1 -6 -6 V34 a6 6 0 0 1 6 -6 H32 l7 8 H82 a6 6 0 0 1 6 6 V72 a6 6 0 0 1 -6 6 Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M20 54 H78 M66 42 L80 54 L66 66" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
	'synapse-checkpoints': '<path d="M50 22 A28 28 0 1 1 26 36" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <path d="M42 40 L60 50 L42 60 Z" fill="currentColor" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>',
	// Per-feature default glyphs.
	'synapse-main': '<rect x="29" y="20" width="42" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M40 39 H60" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M40 50 H60" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M40 61 H53" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
	'synapse-elaboration': '<rect x="16" y="28" width="28" height="44" rx="7" fill="currentColor"/> <path d="M58 38 H70" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <path d="M58 50 H80" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <path d="M58 62 H88" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>',
	'synapse-enrichment': '<rect x="13" y="24" width="38" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M23 38 H41" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/> <path d="M23 50 H41" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/> <path d="M23 62 H35" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/> <path d="M51 42 H64" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <circle cx="77" cy="42" r="9" fill="none" stroke="currentColor" stroke-width="7"/> <path d="M51 62 H64" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <circle cx="77" cy="62" r="9" fill="none" stroke="currentColor" stroke-width="7"/>',
	'synapse-organize': '<path d="M41 56 V20 a5 5 0 0 1 5 -5 H64 a5 5 0 0 1 5 5 V56" fill="currentColor"/> <path d="M14 84 a6 6 0 0 1 -6 -6 V40 a6 6 0 0 1 6 -6 H32 l7 8 H84 a6 6 0 0 1 6 6 V78 a6 6 0 0 1 -6 6 Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>',
	'synapse-deep-dive': '<rect x="20" y="18" width="44" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M31 34 H53" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M31 45 H47" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <circle cx="59" cy="59" r="15" fill="none" stroke="currentColor" stroke-width="8"/> <path d="M70 70 L83 83" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>',
	'synapse-summarize': '<path d="M12 38 H42" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <path d="M12 50 H34" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <path d="M12 62 H24" stroke="currentColor" stroke-width="8" stroke-linecap="round"/> <rect x="56" y="28" width="28" height="44" rx="7" fill="currentColor"/>',
	'synapse-tidy': '<rect x="29" y="20" width="42" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M52 32 H62" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M42 43 H56" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M38 58 H62" stroke="currentColor" stroke-width="7" stroke-linecap="round"/> <path d="M38 68 H62" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
	'synapse-rem': '<rect x="13" y="12" width="30" height="42" rx="7" fill="currentColor"/> <rect x="57" y="46" width="30" height="42" rx="7" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M40 48 L60 60" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>',
	'synapse-video': '<rect x="12" y="22" width="76" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/> <path d="M42 38 L62 50 L42 62 Z" fill="currentColor" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>',
};

/**
 * Register every Synapse glyph as a custom Obsidian icon. Must run in
 * `onload()` BEFORE any `addRibbonIcon`/`setIcon`/view `getIcon` that references
 * these names.
 */
export function registerSynapseIcons(): void {
	for (const [name, svg] of Object.entries(SYNAPSE_ICONS)) {
		addIcon(name, svg);
	}
}
