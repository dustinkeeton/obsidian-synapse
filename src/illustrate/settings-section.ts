import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';
import { LICENSE_NAMES } from './license';
import type { MediaProviderId } from './types';

export const ILLUSTRATE_FEATURE_TOOLTIP =
	'Propose real photos, diagrams, and charts for notes, sourced from licensed image repositories and built from the note itself';

const PROVIDER_ROWS: Array<{ id: MediaProviderId; name: string; desc: string }> = [
	{ id: 'wikimedia', name: 'Wikimedia Commons', desc: 'Search Wikimedia Commons for licensed reference photos (no API key).' },
	{ id: 'openverse', name: 'Openverse', desc: 'Search Openverse (CC-licensed aggregator, no API key; capped per run to respect its rate limits).' },
];

/** Render the Illustrate settings accordion; license chips use raw DOM so the obsidian mock can exercise them. */
export function renderIllustrateSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const body = ctx.featureSection(
		'illustrate',
		'Illustrate',
		() => plugin.settings.illustrate.enabled,
		(v) => { plugin.settings.illustrate.enabled = v; },
		ILLUSTRATE_FEATURE_TOOLTIP,
	);

	for (const row of PROVIDER_ROWS) {
		new Setting(body)
			.setName(row.name)
			.setDesc(row.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(plugin.settings.illustrate.providers[row.id])
					.onChange(async (value) => {
						plugin.settings.illustrate.providers[row.id] = value;
						await plugin.saveSettings();
					})
			);
	}

	new Setting(body)
		.setName('Max visuals per note')
		.setDesc('Upper bound on proposed visuals for a single note')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.illustrate.maxItemsPerNote))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.illustrate.maxItemsPerNote = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(body)
		.setName('Download photos into the vault')
		.setDesc('Store accepted photos in the attachment folder and embed the local file; off embeds the remote URL instead')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.illustrate.preferDownload)
				.onChange(async (value) => {
					plugin.settings.illustrate.preferDownload = value;
					await plugin.saveSettings();
				})
		);

	const licenseSetting = new Setting(body)
		.setName('Allowed licenses')
		.setDesc('Only photos under a checked license are proposed. Non-commercial and no-derivatives licenses are off by default.');
	const chips = licenseSetting.settingEl.createDiv({ cls: 'synapse-illustrate-licenses' });
	for (const name of LICENSE_NAMES) {
		const label = chips.createEl('label', { cls: ['synapse-checklist-row', 'synapse-illustrate-license'] });
		const checkbox = label.createEl('input', { type: 'checkbox', attr: { 'data-license': name } });
		checkbox.checked = plugin.settings.illustrate.licenseFilter.includes(name);
		checkbox.addEventListener('change', () => {
			const current = new Set(plugin.settings.illustrate.licenseFilter);
			if (checkbox.checked) current.add(name); else current.delete(name);
			plugin.settings.illustrate.licenseFilter = LICENSE_NAMES.filter((entry) => current.has(entry));
			void plugin.saveSettings();
		});
		label.createEl('span', { text: name });
	}

	new Setting(body)
		.setName('Excluded tags')
		.setDesc('Notes with these tags are never illustrated')
		.addText((text) =>
			text
				.setValue(plugin.settings.illustrate.excludeTags.join(', '))
				.onChange(async (value) => {
					plugin.settings.illustrate.excludeTags = value.split(',').map((s) => s.trim()).filter(Boolean);
					await plugin.saveSettings();
				})
		);
}
