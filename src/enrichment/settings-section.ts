import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';
import type { EnrichmentWeightSettings } from '../settings';

/**
 * Render the Note Enrichment settings accordion (#243). Includes the Proximity
 * Weights and Tag Vocabulary sub-sections.
 */
export function renderEnrichmentSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const enrichmentBody = ctx.featureSection(
		'enrichment',
		'Note Enrichment',
		() => plugin.settings.enrichment.enabled,
		(v) => { plugin.settings.enrichment.enabled = v; },
		'Add tags, links, references, and metadata to notes',
	);

	new Setting(enrichmentBody)
		.setName('Auto-enrich')
		.setDesc('Automatically generate enrichment proposals after elaboration or transcription')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.enrichment.autoEnrich)
				.onChange(async (value) => {
					plugin.settings.enrichment.autoEnrich = value;
					await plugin.saveSettings();
				})
		);

	new Setting(enrichmentBody)
		.setName('Max metadata tags')
		.setDesc('Maximum number of metadata tags (status, type, source) to suggest per note')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.enrichment.maxTags))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.enrichment.maxTags = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(enrichmentBody)
		.setName('Max topic links')
		.setDesc('Maximum number of AI-extracted topic links to suggest')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.enrichment.maxTopicLinks))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.enrichment.maxTopicLinks = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(enrichmentBody)
		.setName('Suggest new notes')
		.setDesc('Suggest links to notes that don\'t exist yet (Obsidian grayed-out links)')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.enrichment.suggestNewNotes)
				.onChange(async (value) => {
					plugin.settings.enrichment.suggestNewNotes = value;
					await plugin.saveSettings();
				})
		);

	new Setting(enrichmentBody)
		.setName('Max internal links')
		.setDesc('Maximum number of related note links to suggest')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.enrichment.maxInternalLinks))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.enrichment.maxInternalLinks = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(enrichmentBody)
		.setName('Max external references')
		.setDesc('Maximum external links to suggest (stingy — keep this low)')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.enrichment.maxExternalLinks))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0) {
						plugin.settings.enrichment.maxExternalLinks = num;
						await plugin.saveSettings();
					}
				})
		);

	addEnhancedSlider(
		new Setting(enrichmentBody)
			.setName('Internal link threshold')
			.setDesc('Minimum relevance score for internal links (0-1, lower = more liberal)'),
		{
			min: 0,
			max: 1,
			step: 0.05,
			value: plugin.settings.enrichment.internalLinkThreshold,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.enrichment.internalLinkThreshold = value;
				await plugin.saveSettings();
			},
		},
	);

	// Weight settings (sub-section within enrichment)
	new Setting(enrichmentBody).setHeading().setName('Proximity Weights');

	type WeightKey = keyof EnrichmentWeightSettings;
	const weightFields: Array<{ key: WeightKey; name: string; desc: string }> = [
		{ key: 'sameFolder', name: 'Same folder', desc: 'Weight for files in the same folder' },
		{ key: 'siblingFolder', name: 'Sibling folder', desc: 'Weight for files in sibling folders' },
		{ key: 'cousinFolder', name: 'Cousin folder', desc: 'Weight for files two levels apart' },
		{ key: 'distantFolder', name: 'Distant folder', desc: 'Weight for files in distant folders' },
		{ key: 'decayPerLevel', name: 'Decay per level', desc: 'Weight reduction per additional folder hop' },
		{ key: 'minWeight', name: 'Minimum weight', desc: 'Floor weight — distant files are never invisible' },
	];

	for (const field of weightFields) {
		const key = field.key;
		addEnhancedSlider(
			new Setting(enrichmentBody)
				.setName(field.name)
				.setDesc(field.desc),
			{
				min: 0,
				max: 1,
				step: 0.05,
				value: plugin.settings.enrichment.weights[key],
				showTicks: true,
				onChange: async (value) => {
					plugin.settings.enrichment.weights[key] = value;
					await plugin.saveSettings();
				},
			},
		);
	}

	// Tag Vocabulary (sub-section within enrichment)
	new Setting(enrichmentBody).setHeading().setName('Tag Vocabulary').setDesc('Define metadata tag categories. Tags classify notes (status, type, source) — topics become [[links]] instead.');

	for (let i = 0; i < plugin.settings.enrichment.tagVocabulary.length; i++) {
		const entry = plugin.settings.enrichment.tagVocabulary[i];

		new Setting(enrichmentBody)
			.setName(entry.category)
			.setDesc(entry.description)
			.addText((text) =>
				text
					.setValue(entry.tags.join(', '))
					.setPlaceholder('tag1, tag2, tag3')
					.onChange(async (value) => {
						plugin.settings.enrichment.tagVocabulary[i].tags =
							value.split(',').map(s => s.trim()).filter(Boolean);
						await plugin.saveSettings();
					})
			);
	}

	new Setting(enrichmentBody)
		.setName('Excluded folders')
		.setDesc('Comma-separated list of folders to skip for enrichment')
		.addText((text) =>
			text
				.setValue(plugin.settings.enrichment.excludeFolders.join(', '))
				.onChange(async (value) => {
					plugin.settings.enrichment.excludeFolders =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(enrichmentBody)
		.setName('Excluded tags')
		.setDesc('Notes with these tags will skip enrichment')
		.addText((text) =>
			text
				.setValue(plugin.settings.enrichment.excludeTags.join(', '))
				.onChange(async (value) => {
					plugin.settings.enrichment.excludeTags =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);
}
