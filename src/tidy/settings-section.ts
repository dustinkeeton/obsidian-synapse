import type { SettingsSectionContext } from '../shared';

/**
 * Render the Note Tidy settings accordion (#243). Tidy has no configurable
 * options — just an empty-note placeholder in the body.
 */
export function renderTidySettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const tidyBody = ctx.featureSection(
		'tidy',
		'Note Tidy',
		() => plugin.settings.tidy.enabled,
		(v) => { plugin.settings.tidy.enabled = v; },
		'Spelling correction and markdown formatting (no content changes)',
	);

	tidyBody.createDiv({
		cls: 'setting-item-description synapse-accordion-empty-note',
		text: 'Tidy applies spelling correction and markdown formatting without changing content. No additional options.',
	});
}
