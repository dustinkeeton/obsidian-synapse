/**
 * Icon NAMES for the command system — the contract between the command registry
 * and the registered SVG glyphs.
 *
 * The glyph bodies themselves are registered via `addIcon` in
 * `src/brand-icons.ts` (and mirror the mono assets in `assets/brand/`). This
 * module only holds the names so it keeps the commands module's
 * zero-`src`-dependency property (it imports nothing outside `./types`),
 * mirroring how `FEATURE_COLOR_TOKENS` names CSS tokens in the view layer
 * (`src/views/proposal-styles.ts`).
 */

import type { CommandDefinition, FeatureKey } from './types';

/**
 * Registered glyph name per feature — the default an action inherits when it
 * doesn't declare its own {@link CommandDefinition.icon}. Feature glyphs are the
 * bespoke per-feature line marks (#349); a feature's note/vault actions share
 * one glyph, distinguished by the button label and feature-color tint.
 *
 * Typed `Record<FeatureKey, string>` so the build FAILS if a feature ever loses
 * its glyph — the same exhaustiveness guard `FEATURE_COLOR_TOKENS` provides for
 * colors. Keep the names in lockstep with the `addIcon` registrations in
 * `src/brand-icons.ts`.
 */
export const FEATURE_ICONS: Record<FeatureKey, string> = {
	main: 'synapse-main',
	elaboration: 'synapse-elaboration',
	enrichment: 'synapse-enrichment',
	organize: 'synapse-organize',
	'deep-dive': 'synapse-deep-dive',
	summarize: 'synapse-summarize',
	tidy: 'synapse-tidy',
	rem: 'synapse-rem',
	video: 'synapse-video',
};

/**
 * The glyph an action renders with: its explicit `icon` override when set (used
 * for the heterogeneous General/`main` actions, which bundle dissimilar
 * operations), otherwise its feature's default glyph. Consumed by the registrar
 * (palette command icons) and the Synapse actions sidebar.
 */
export function resolveActionIcon(def: CommandDefinition): string {
	return def.icon ?? FEATURE_ICONS[def.feature];
}
