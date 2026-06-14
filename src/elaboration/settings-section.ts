import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Note Elaboration settings accordion (#243). Pure renderer over the
 * shared {@link SettingsSectionContext}; owns no state.
 */
export function renderElaborationSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const elaborationBody = ctx.featureSection(
		'elaboration',
		'Note elaboration',
		() => plugin.settings.elaboration.enabled,
		(v) => { plugin.settings.elaboration.enabled = v; },
		'Enable stub note detection and proposal generation',
	);

	new Setting(elaborationBody)
		.setName('Minimum word threshold')
		.setDesc('Notes with fewer words than this are considered stubs')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.elaboration.detection.minWordThreshold))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.elaboration.detection.minWordThreshold = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(elaborationBody)
		.setName('Detect TODO markers')
		.setDesc('Flag notes containing TODO, TBD, FIXME, PLACEHOLDER')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.elaboration.detection.detectTodoMarkers)
				.onChange(async (value) => {
					plugin.settings.elaboration.detection.detectTodoMarkers = value;
					await plugin.saveSettings();
				})
		);

	new Setting(elaborationBody)
		.setName('Detect empty sections')
		.setDesc('Flag notes with headings but no content beneath them')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.elaboration.detection.detectEmptySections)
				.onChange(async (value) => {
					plugin.settings.elaboration.detection.detectEmptySections = value;
					await plugin.saveSettings();
				})
		);
}
