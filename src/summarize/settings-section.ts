import { Setting } from 'obsidian';
import { addEnhancedSlider } from '../shared';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Summarize settings accordion (#243).
 */
export function renderSummarizeSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const summarizeBody = ctx.featureSection(
		'summarize',
		'Summarize',
		() => plugin.settings.summarize.enabled,
		(v) => { plugin.settings.summarize.enabled = v; },
		'Summarize URLs and transcriptions in notes',
	);

	new Setting(summarizeBody)
		.setName('Summary style')
		.setDesc('Format for generated summaries')
		.addDropdown((dd) =>
			dd
				.addOptions({
					bullets: 'Bullet Points',
					paragraph: 'Paragraph',
					'key-points': 'Key Points',
				})
				.setValue(plugin.settings.summarize.summaryStyle)
				.onChange(async (value) => {
					plugin.settings.summarize.summaryStyle =
						value as 'bullets' | 'paragraph' | 'key-points';
					await plugin.saveSettings();
				})
		);

	new Setting(summarizeBody)
		.setName('Auto-detect content templates')
		.setDesc('Automatically detect content type (e.g. recipes) and use a specialized summary format')
		.addToggle(toggle => toggle
			.setValue(plugin.settings.summarize.autoDetectTemplates)
			.onChange(async (value) => {
				plugin.settings.summarize.autoDetectTemplates = value;
				await plugin.saveSettings();
			}));

	addEnhancedSlider(
		new Setting(summarizeBody)
			.setName('Max content length')
			.setDesc('Maximum characters of content to send to AI for summarization'),
		{
			min: 1000,
			max: 10000,
			step: 500,
			value: plugin.settings.summarize.maxContentLength,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.summarize.maxContentLength = value;
				await plugin.saveSettings();
			},
		},
	);

	new Setting(summarizeBody)
		.setName('Custom prompt')
		.setDesc('Override the default summarization prompt (leave empty for default)')
		.addTextArea((text) =>
			text
				.setPlaceholder('Custom summarization instructions...')
				.setValue(plugin.settings.summarize.customPrompt)
				.onChange(async (value) => {
					plugin.settings.summarize.customPrompt = value;
					await plugin.saveSettings();
				})
		);

	new Setting(summarizeBody)
		.setName('Excluded folders')
		.setDesc('Comma-separated list of folders to skip for summarization')
		.addText((text) =>
			text
				.setValue(plugin.settings.summarize.excludeFolders.join(', '))
				.onChange(async (value) => {
					plugin.settings.summarize.excludeFolders =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(summarizeBody)
		.setName('Excluded tags')
		.setDesc('Notes with these tags will skip summarization')
		.addText((text) =>
			text
				.setValue(plugin.settings.summarize.excludeTags.join(', '))
				.onChange(async (value) => {
					plugin.settings.summarize.excludeTags =
						value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);

	new Setting(summarizeBody)
		.setName('Auto-organize after summarize')
		.setDesc('Automatically organize the current note after summarization completes (single-note only, not vault-wide)')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.summarize.autoOrganizeOnSummarize)
				.onChange(async (value) => {
					plugin.settings.summarize.autoOrganizeOnSummarize = value;
					await plugin.saveSettings();
				})
		);
}
