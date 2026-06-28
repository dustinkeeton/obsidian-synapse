import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';
import { TitleDuplicateStrategy } from './types';

/**
 * Render the Title settings accordion (#408).
 *
 * The feature header toggle binds `settings.title.enabled` (like every other
 * section). The "Duplicate handling" dropdown sets the DEFAULT resolution used
 * by auto-accept when a proposed title collides with an existing note; the
 * proposal card always offers both choices regardless of this default.
 */
export function renderTitleSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const titleBody = ctx.featureSection(
		'title',
		'Title',
		() => plugin.settings.title.enabled,
		(v) => { plugin.settings.title.enabled = v; },
		'Propose better titles for untitled notes and notes whose title no longer matches their content',
	);

	new Setting(titleBody)
		.setName('Duplicate handling')
		.setDesc('Default action when a proposed title matches an existing note in the same folder (used by auto-accept). The proposal card always lets you choose per-proposal.')
		.addDropdown((dd) =>
			dd
				.addOptions({
					iterate: 'Add suffix',
					merge: 'Merge into existing note',
				})
				.setValue(plugin.settings.title.duplicateHandling)
				.onChange(async (value) => {
					plugin.settings.title.duplicateHandling = value as TitleDuplicateStrategy;
					await plugin.saveSettings();
				})
		);
}
