import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';
import { LICENSE_NAMES, SOURCE_PAGE_LICENSE } from './license';
import type { RepositoryProviderId, IllustrateRunAfterKey } from './types';

export const ILLUSTRATE_FEATURE_TOOLTIP =
	'Propose real photos for notes, sourced from licensed image repositories; optionally Mermaid diagrams and charts built from the note itself';

const EMPTY_CONFIG_HELP =
	'Nothing to propose: turn on at least one photo repository or Mermaid diagrams and charts, or runs will produce no visuals.';

const PROVIDER_ROWS: Array<{ id: RepositoryProviderId; name: string; desc: string }> = [
	{ id: 'wikimedia', name: 'Wikimedia Commons', desc: 'Search Wikimedia Commons for licensed reference photos (no API key).' },
	{ id: 'openverse', name: 'Openverse', desc: 'Search Openverse (CC-licensed aggregator, no API key; capped per run to respect its rate limits).' },
];

const RUN_AFTER_ROWS: Array<{ key: IllustrateRunAfterKey; name: string }> = [
	{ key: 'elaboration', name: 'Elaboration accepted' },
	{ key: 'transcription', name: 'Transcription or OCR added' },
	{ key: 'summarize', name: 'Summary added' },
	{ key: 'enrichment', name: 'Enrichment accepted' },
	{ key: 'deepDive', name: 'Deep dive note accepted' },
];

/** Render the Illustrate settings accordion; license and run-after chips use raw DOM so the obsidian mock can exercise them. */
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
						refreshEmptyConfig();
						await plugin.saveSettings();
					})
			);
	}

	new Setting(body)
		.setName('Propose Mermaid diagrams and charts')
		.setDesc('Also propose Mermaid blocks: diagrams are AI-written Mermaid source; charts use only numbers already in the note. Off proposes photos only.')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.illustrate.mermaid)
				.onChange(async (value) => {
					plugin.settings.illustrate.mermaid = value;
					refreshEmptyConfig();
					await plugin.saveSettings();
				})
		);
	const emptyConfig = body.createDiv({ cls: 'synapse-illustrate-empty-config', text: EMPTY_CONFIG_HELP });
	function refreshEmptyConfig(): void {
		const { mermaid, providers } = plugin.settings.illustrate;
		emptyConfig.toggleClass('is-hidden', mermaid || providers.wikimedia || providers.openverse);
	}
	refreshEmptyConfig();

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
	licenseSetting.settingEl.addClass('synapse-setting--has-helper');
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

	const runAfterSetting = new Setting(body)
		.setName('Run after other actions')
		.setDesc(`Also propose visuals when these actions finish, sourcing images from the material they acted on (fetched pages, video thumbnails) before the repositories. Turning any of these on adds "${SOURCE_PAGE_LICENSE}" to the allowed licenses so those images can be proposed; it is never removed automatically.`);
	runAfterSetting.settingEl.addClass('synapse-setting--has-helper');
	const runAfterChips = runAfterSetting.settingEl.createDiv({ cls: 'synapse-illustrate-run-after' });
	for (const row of RUN_AFTER_ROWS) {
		const label = runAfterChips.createEl('label', { cls: ['synapse-checklist-row', 'synapse-illustrate-run-after-row'] });
		const checkbox = label.createEl('input', { type: 'checkbox', attr: { 'data-run-after': row.key } });
		checkbox.checked = plugin.settings.illustrate.runAfter[row.key];
		checkbox.addEventListener('change', () => {
			plugin.settings.illustrate.runAfter[row.key] = checkbox.checked;
			if (checkbox.checked && !plugin.settings.illustrate.licenseFilter.includes(SOURCE_PAGE_LICENSE)) {
				plugin.settings.illustrate.licenseFilter = [...plugin.settings.illustrate.licenseFilter, SOURCE_PAGE_LICENSE];
			}
			void plugin.saveSettings();
		});
		label.createEl('span', { text: row.name });
	}

	new Setting(body)
		.setName('Fetch linked pages for images')
		.setDesc('When a chained run has few source images, fetch pages linked from the note and use their images. Makes one network request per linked page.')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.illustrate.fetchLinkedPages)
				.onChange(async (value) => {
					plugin.settings.illustrate.fetchLinkedPages = value;
					await plugin.saveSettings();
				})
		);

	new Setting(body)
		.setName('Max linked pages per note')
		.setDesc('Upper bound on linked pages fetched for one chained run')
		.addText((text) =>
			text
				.setValue(String(plugin.settings.illustrate.maxLinkedPagesPerNote))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.illustrate.maxLinkedPagesPerNote = num;
						await plugin.saveSettings();
					}
				})
		);

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
