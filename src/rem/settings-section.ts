import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';

export const REM_THRESHOLD_DESC =
	'Minimum relevance (0-1) a semantic link needs before it is proposed. With System 1 decisions on, relevance is the probability that the linked note is strongly related to this note; otherwise it is the AI model\'s own rating. Literal title matches are not gated.';

/**
 * Render the REM (Link Discovery) settings accordion (#243).
 */
export function renderRemSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const remBody = ctx.featureSection(
		'rem',
		'REM (link discovery)',
		() => plugin.settings.rem.enabled,
		(v) => { plugin.settings.rem.enabled = v; },
		'Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions. Link suggestions are ranked by AI content relevance, not just literal title matches.',
	);

	addEnhancedSlider(
		new Setting(remBody)
			.setName('Confidence threshold')
			.setDesc(REM_THRESHOLD_DESC),
		{
			min: 0,
			max: 1,
			step: 0.05,
			value: plugin.settings.rem.confidenceThreshold,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.rem.confidenceThreshold = value;
				await plugin.saveSettings();
			},
		},
	);

	new Setting(remBody)
		.setName('Max links per note')
		.setDesc('Maximum number of link candidates to suggest per scanned note')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.rem.maxLinksPerNote))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.rem.maxLinksPerNote = num;
						await plugin.saveSettings();
					}
				})
		);
}
