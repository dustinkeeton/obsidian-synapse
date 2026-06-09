import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the REM (Link Discovery) settings accordion (#243).
 */
export function renderRemSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const remBody = ctx.featureSection(
		'rem',
		'REM (Link Discovery)',
		() => plugin.settings.rem.enabled,
		(v) => { plugin.settings.rem.enabled = v; },
		'Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions',
	);

	new Setting(remBody)
		.setName('Semantic matching')
		.setDesc('Use AI to find conceptual matches beyond literal title/alias matching')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.rem.semanticMatching)
				.onChange(async (value) => {
					plugin.settings.rem.semanticMatching = value;
					await plugin.saveSettings();
				})
		);

	addEnhancedSlider(
		new Setting(remBody)
			.setName('Confidence threshold')
			.setDesc('Minimum confidence for semantic matches (0-1)'),
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
