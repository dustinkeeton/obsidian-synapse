import type { ProposalKind } from './types';
import type { FeatureKey } from '../commands';

/**
 * Semantic color tokens — the TypeScript half of the single source of truth
 * for action-type colors (#342).
 *
 * The CSS custom properties themselves are declared once in `styles.css` (the
 * `.theme-light, .theme-dark` block). CSS tokens are invisible to the
 * compiler, so THIS map is where the exhaustiveness guard lives: typing it as
 * `Record<ProposalKind, string>` makes the build FAIL if a proposal kind ever
 * loses its `--synapse-color-*` token — mirroring the union guard in
 * {@link ./types}. Keep the values in lockstep with styles.css.
 */
export const SYNAPSE_COLOR_TOKENS: Record<ProposalKind, string> = {
	elaboration: '--synapse-color-elaboration',
	enrichment: '--synapse-color-enrichment',
	organize: '--synapse-color-organize',
	'deep-dive': '--synapse-color-deep-dive',
	title: '--synapse-color-title',
	rem: '--synapse-color-rem',
};

/**
 * Feature-level color tokens — a superset of {@link SYNAPSE_COLOR_TOKENS}.
 *
 * The actions sidebar groups by {@link FeatureKey} (not proposal kind), so it
 * needs tokens for the feature-only types (`main`, `summarize`, `tidy`,
 * `video`) and omits the proposal-only `title`. `Record<FeatureKey, string>`
 * guards sidebar coverage the same way the proposal map guards card/badge
 * coverage. Shared values (e.g. `tidy` reusing organize's hue) are intentional
 * and stay independently editable in styles.css.
 */
export const FEATURE_COLOR_TOKENS: Record<FeatureKey, string> = {
	main: '--synapse-color-main',
	elaboration: '--synapse-color-elaboration',
	enrichment: '--synapse-color-enrichment',
	organize: '--synapse-color-organize',
	'deep-dive': '--synapse-color-deep-dive',
	summarize: '--synapse-color-summarize',
	tidy: '--synapse-color-tidy',
	rem: '--synapse-color-rem',
	video: '--synapse-color-video',
};

/** BEM-style modifier class for a proposal card of the given kind. */
export function cardClass(kind: ProposalKind): string {
	return `synapse-card--${kind}`;
}

/** BEM-style modifier class for a proposal badge of the given kind. */
export function badgeClass(kind: ProposalKind): string {
	return `synapse-badge--${kind}`;
}

/** BEM-style modifier class for a review-pane label of the given kind. */
export function reviewPaneLabelClass(kind: ProposalKind): string {
	return `synapse-review-pane-label--${kind}`;
}

/** BEM-style modifier class for an actions-sidebar group of the given feature. */
export function actionsGroupClass(feature: FeatureKey): string {
	return `synapse-actions-group--${feature}`;
}
