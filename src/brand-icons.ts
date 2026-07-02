/**
 * Bespoke Synapse icon glyphs, registered with Obsidian's `addIcon` (#349).
 *
 * Each value is SVG *inner content* on the `0 0 100 100` viewBox `addIcon`
 * expects. Bodies are drawn in `currentColor` — the host UI supplies the ink —
 * while the impulse (the one gold gesture per glyph, 2026 Iris+Gold refresh)
 * is `var(--synapse-gold, #FFD23F)`, themed per surface in `styles.css`.
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
 * In-app proposals mark: a NEURON (dendrites, a filled soma, and an axon
 * carrying the impulse), built around the brand's impulse/charge idea (#349
 * review). Mirrors `assets/brand/icon-mono.svg` — body in `currentColor`, the
 * axon spike in the gold var — and INTENTIONALLY diverges from the canonical
 * full-color S-Signal (`icon.svg` etc.). Do not recolor the body; its ink
 * comes from the host UI via `currentColor`.
 */
export const SYNAPSE_ICON_SVG =
	'<path d="M34 46 L25 39 M25 39 L19 31 M19 31 L20 22 M19 31 L11 27 M25 39 L14 45" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="43" cy="50" r="14" fill="currentColor"></circle><path d="M57 50 L65 50 L71 40 L78 60 L84 50 L91 50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path>';

/**
 * name -> inner SVG content for every Synapse-registered glyph. Keys MUST match
 * the names in `src/commands/icons.ts` and the ribbon/view references in
 * `src/main.ts` / `src/views/synapse-actions-view.ts`. One line-icon system
 * (round caps/joins, one stroke weight) speaking the Topology grammar: filled
 * soma = what exists, open ring = what is proposed, line = connection, and the
 * single gold gesture = what Synapse adds (`var(--synapse-gold, #FFD23F)`).
 * `synapse-main` is deliberately impulse-free as the neutral fallback.
 */
export const SYNAPSE_ICONS: Readonly<Record<string, string>> = {
	// In-app proposals identity mark — neuron (proposals ribbon + proposal views).
	synapse: SYNAPSE_ICON_SVG,
	// Launcher (Synapse actions ribbon + sidebar view) — the S-Signal itself at
	// glyph weight (the brain mark is retired; the neuron remains the proposals mark).
	'synapse-actions': '<path d="M70.5 26.2 A16.8 16.8 0 1 0 42.1 43.7" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="70.5" cy="26.2" r="8" fill="currentColor"></circle> <path d="M69.8 57.2 A18.4 18.4 0 0 1 41.6 80.8" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="33.1" cy="71.5" r="9" fill="none" stroke="currentColor" stroke-width="6"></circle> <polyline points="39.2,48.8 46.4,46.4 52.4,34.0 58.4,64.4 63.2,52.8 68.4,53.6" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline>',
	// Per-action override glyphs.
	'synapse-transcribe': '<path d="M14 44 V56" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M24 33 V67" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M34 42 V58" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="40,50 46,42 52,58 56,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="69" cy="50" r="8.5" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-fire': '<circle cx="18" cy="50" r="9" fill="currentColor"></circle> <polyline points="27,50 33,43 39,57 45,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="53" cy="50" r="9" fill="currentColor"></circle> <path d="M62 50 H70" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="80" cy="50" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-checkpoints': '<path d="M72.6 41.8 A24 24 0 1 1 38 29.2" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M42 39 L63 50 L42 61 Z" style="fill:var(--synapse-gold, #FFD23F)"></path>',
	// Per-feature default glyphs (synapse-main is deliberately impulse-free).
	'synapse-main': '<circle cx="32" cy="50" r="11" fill="currentColor"></circle> <path d="M43 50 H60" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="70" cy="50" r="9" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-elaboration': '<circle cx="24" cy="50" r="11" fill="currentColor"></circle> <path d="M33 45 L57 31" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M33 55 L57 69" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="36,50 43,50 48,42 54,58 59,50 62,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="67" cy="27" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle> <circle cx="72" cy="50" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle> <circle cx="67" cy="73" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-enrichment': '<circle cx="36" cy="52" r="12" fill="currentColor"></circle> <path d="M44 44 L60 33" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="68" cy="28" r="7" style="fill:var(--synapse-gold, #FFD23F)"></circle> <path d="M47 55 L69 56" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="78" cy="56" r="7" style="fill:var(--synapse-gold, #FFD23F)"></circle> <path d="M42 62 L54 72" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="61" cy="78" r="7" style="fill:var(--synapse-gold, #FFD23F)"></circle>',
	'synapse-organize': '<circle cx="50" cy="20" r="9" fill="currentColor"></circle> <path d="M44 26 L30 42" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M56 26 L70 42" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="27" cy="49" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle> <circle cx="73" cy="49" r="8" fill="currentColor"></circle> <polyline points="73,57 78,63 68,68 73,74" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="73" cy="82" r="7" fill="none" stroke="currentColor" stroke-width="6"></circle>',
	'synapse-deep-dive': '<circle cx="50" cy="50" r="27" fill="none" stroke="currentColor" stroke-width="7"></circle> <path d="M6 50 H16" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="16,50 24,50 29,42 35,58 40,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="56" cy="50" r="8" fill="currentColor"></circle>',
	'synapse-summarize': '<circle cx="22" cy="28" r="8" fill="currentColor"></circle> <circle cx="18" cy="50" r="8" fill="currentColor"></circle> <circle cx="22" cy="72" r="8" fill="currentColor"></circle> <path d="M29 32 L52 46" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M25 50 H50" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M29 68 L52 54" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="52,50 58,42 64,58 69,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="79" cy="50" r="8.5" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-tidy': '<path d="M6 52 Q13 40 20 52 Q26 62 32 52" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="34,52 40,44 46,60 50,52" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <path d="M52 52 H66" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="77" cy="52" r="8" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-rem': '<circle cx="22" cy="30" r="10" fill="currentColor"></circle> <path d="M30 36 L43 46" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="43,46 49,41 53,55 59,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <path d="M59 50 L68 58" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <circle cx="77" cy="66" r="9" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
	'synapse-video': '<polygon points="16,36 38,50 16,64" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="round"></polygon> <path d="M42 50 H46" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path> <polyline points="46,50 52,42 58,58 62,50" fill="none" style="stroke:var(--synapse-gold, #FFD23F)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></polyline> <circle cx="75" cy="50" r="8.5" fill="none" stroke="currentColor" stroke-width="6.5"></circle>',
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
