import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Note Organize settings accordion (#243).
 */
export function renderOrganizeSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const organizeBody = ctx.featureSection(
		'organize',
		'Note Organize',
		() => plugin.settings.organize.enabled,
		(v) => { plugin.settings.organize.enabled = v; },
		'AI-powered semantic directory structuring for notes',
	);

	addEnhancedSlider(
		new Setting(organizeBody)
			.setName('New folder confidence threshold')
			.setDesc('Minimum topic confidence to propose a new folder (0.5-1.0). Higher = fewer new folders.'),
		{
			min: 0.5,
			max: 1.0,
			step: 0.05,
			value: plugin.settings.organize.organizeConfidenceThreshold,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.organize.organizeConfidenceThreshold = value;
				await plugin.saveSettings();
			},
		},
	);

	new Setting(organizeBody)
		.setName('Excluded folders')
		.setDesc('Comma-separated list of folders to skip for organization')
		.addText((text) =>
			text
				.setValue(plugin.settings.organize.excludeFolders.join(', '))
				.onChange(async (value) => {
					plugin.settings.organize.excludeFolders =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(organizeBody)
		.setName('Excluded tags')
		.setDesc('Notes with these tags will skip organization')
		.addText((text) =>
			text
				.setValue(plugin.settings.organize.excludeTags.join(', '))
				.onChange(async (value) => {
					plugin.settings.organize.excludeTags =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);
}
