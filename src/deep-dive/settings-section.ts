import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Deep Dive settings accordion (#243).
 *
 * NOTE: the accordion key is `deepDive` (camelCase) even though the feature
 * directory is `deep-dive` — it must match the `settings.deepDive` group and
 * the existing persisted `ui.collapsedSections['deepDive']` key. Do not change.
 */
export function renderDeepDiveSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const deepDiveBody = ctx.featureSection(
		'deepDive',
		'Deep Dive',
		() => plugin.settings.deepDive.enabled,
		(v) => { plugin.settings.deepDive.enabled = v; },
		'Recursively explore a note into a tree of interlinked child notes',
	);

	addEnhancedSlider(
		new Setting(deepDiveBody)
			.setName('Max depth')
			.setDesc('Maximum levels of recursion (1-5)'),
		{
			min: 1,
			max: 5,
			step: 1,
			value: plugin.settings.deepDive.maxDepth,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.deepDive.maxDepth = value;
				await plugin.saveSettings();
			},
		},
	);

	addEnhancedSlider(
		new Setting(deepDiveBody)
			.setName('Quality threshold')
			.setDesc('Minimum quality score to continue recursing (0.1-0.9)'),
		{
			min: 0.1,
			max: 0.9,
			step: 0.05,
			value: plugin.settings.deepDive.qualityThreshold,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.deepDive.qualityThreshold = value;
				await plugin.saveSettings();
			},
		},
	);

	addEnhancedSlider(
		new Setting(deepDiveBody)
			.setName('Max notes per run')
			.setDesc('Maximum number of notes to generate in a single deep dive (10-100)'),
		{
			min: 10,
			max: 100,
			step: 5,
			value: plugin.settings.deepDive.maxNotesPerRun,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.deepDive.maxNotesPerRun = value;
				await plugin.saveSettings();
			},
		},
	);

	new Setting(deepDiveBody)
		.setName('Note output folder')
		.setDesc('Where to create new notes. Uses a subfolder per root note. (empty = same folder as source)')
		.addText((text) =>
			text
				.setPlaceholder('Deep Dives')
				.setValue(plugin.settings.deepDive.noteOutputFolder)
				.onChange(async (value) => {
					plugin.settings.deepDive.noteOutputFolder = value;
					await plugin.saveSettings();
				})
		);

	new Setting(deepDiveBody)
		.setName('Folder nesting mode')
		.setDesc('How child notes are placed: nested under parent topic folders, flat in a single folder, or AI-organized by content semantics')
		.addDropdown((dd) =>
			dd
				.addOptions({
					nested: 'Nested (subfolder per parent topic)',
					flat: 'Flat (all in root subfolder)',
					'auto-organize': 'Auto-organize (AI-based placement)',
				})
				.setValue(plugin.settings.deepDive.nestingMode || 'nested')
				.onChange(async (value) => {
					plugin.settings.deepDive.nestingMode =
						value as 'nested' | 'flat' | 'auto-organize';
					await plugin.saveSettings();
				})
		);

	new Setting(deepDiveBody)
		.setName('Auto-enrich on accept')
		.setDesc('Automatically trigger enrichment when a deep dive note is accepted')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.deepDive.autoEnrichOnAccept)
				.onChange(async (value) => {
					plugin.settings.deepDive.autoEnrichOnAccept = value;
					await plugin.saveSettings();
				})
		);

	new Setting(deepDiveBody)
		.setName('Auto-organize on accept')
		.setDesc('Automatically trigger organize when a deep dive note is accepted')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.deepDive.autoOrganizeOnAccept)
				.onChange(async (value) => {
					plugin.settings.deepDive.autoOrganizeOnAccept = value;
					await plugin.saveSettings();
				})
		);

	new Setting(deepDiveBody)
		.setName('Excluded folders')
		.setDesc('Comma-separated list of folders to skip for deep dive')
		.addText((text) =>
			text
				.setValue(plugin.settings.deepDive.excludeFolders.join(', '))
				.onChange(async (value) => {
					plugin.settings.deepDive.excludeFolders =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(deepDiveBody)
		.setName('Excluded tags')
		.setDesc('Notes with these tags will skip deep dive')
		.addText((text) =>
			text
				.setValue(plugin.settings.deepDive.excludeTags.join(', '))
				.onChange(async (value) => {
					plugin.settings.deepDive.excludeTags =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);
}
