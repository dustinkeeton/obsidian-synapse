import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import type { ButtonComponent } from 'obsidian';
import type SynapsePlugin from '../main';
import { createSettingsSectionContext, sectionMatchesDefaults } from '../shared';
import type { SettingsSectionContext } from '../shared';
import { renderElaborationSettings } from '../elaboration';
import { renderIntakeSettings } from '../intake';
import { renderImageSettings } from '../image';
import { renderAudioSettings } from '../audio';
import { renderVideoSettings } from '../video';
import { renderEnrichmentSettings } from '../enrichment';
import { renderSummarizeSettings } from '../summarize';
import { renderTidySettings } from '../tidy';
import { renderOrganizeSettings } from '../organize';
import { renderDeepDiveSettings } from '../deep-dive';
import { renderTitleSettings } from '../title';
import { renderRemSettings } from '../rem';
import {
	renderAiConfiguration,
	renderAutoAccept,
	renderExclusions,
	renderGeneral,
	renderAbout,
} from './global-sections';

/** One accordion in the settings tab; `platform` restricts where it renders. */
export interface SettingsSectionEntry {
	key: string;
	render: (ctx: SettingsSectionContext) => void;
	platform?: 'desktop' | 'mobile';
}

/** Every settings section, in render order (#243). Video sits after Audio on all platforms (#184). */
export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
	{ key: 'ai', render: renderAiConfiguration },
	{ key: 'autoAccept', render: renderAutoAccept },
	{ key: 'exclusions', render: renderExclusions },
	{ key: 'general', render: renderGeneral },
	{ key: 'elaboration', render: renderElaborationSettings },
	{ key: 'intake', render: renderIntakeSettings },
	{ key: 'image', render: renderImageSettings },
	{ key: 'audio', render: renderAudioSettings },
	{ key: 'video', render: renderVideoSettings },
	{ key: 'enrichment', render: renderEnrichmentSettings },
	{ key: 'summarize', render: renderSummarizeSettings },
	{ key: 'tidy', render: renderTidySettings },
	{ key: 'organize', render: renderOrganizeSettings },
	{ key: 'deepDive', render: renderDeepDiveSettings },
	{ key: 'title', render: renderTitleSettings },
	{ key: 'rem', render: renderRemSettings },
	{ key: 'about', render: renderAbout },
];

/** Whether a section entry renders on the current platform. */
export function isSectionVisible(
	entry: SettingsSectionEntry,
	platform: { isDesktop: boolean; isMobile: boolean } = Platform,
): boolean {
	if (entry.platform === undefined) return true;
	return entry.platform === 'desktop' ? platform.isDesktop : platform.isMobile;
}

/**
 * Thin orchestrator: builds the section context, renders {@link SETTINGS_SECTIONS}
 * in order, then appends the per-section reset footers (#442) and version line.
 * Sections never import this file; they receive a `SettingsSectionContext`.
 */
export class SynapseSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SynapsePlugin) {
		super(app, plugin);
	}

	/** Per-section reset rows keyed by section key; rebuilt on every display(). */
	private resetControls: Record<
		string,
		{ setting: Setting; button: ButtonComponent; title: string }
	> = {};

	private resetSectionDesc(title: string, atDefaults: boolean): string {
		const base = `Restore the ${title} settings to their shipped defaults. Your other settings are left unchanged.`;
		return atDefaults ? `${base} (Already at defaults.)` : base;
	}

	/** Sync reset rows to whether their section still matches defaults; `key` scopes to one row. */
	private refreshResetDisabledState(key?: string): void {
		const keys = key !== undefined ? [key] : Object.keys(this.resetControls);
		for (const k of keys) {
			const control = this.resetControls[k];
			if (!control) continue;
			const atDefaults = sectionMatchesDefaults(this.plugin.settings, k);
			control.button.setDisabled(atDefaults);
			control.setting.setDesc(this.resetSectionDesc(control.title, atDefaults));
		}
	}

	/** Append a "Reset to defaults" row to every resettable section body. */
	private renderResetFooters(ctx: SettingsSectionContext): void {
		for (const entry of ctx.sections) {
			if (!entry.reset) continue;
			const reset = entry.reset;
			const atDefaults = sectionMatchesDefaults(this.plugin.settings, entry.key);
			const setting = new Setting(entry.bodyEl)
				.setName('Reset to defaults')
				.setDesc(this.resetSectionDesc(entry.title, atDefaults))
				.setClass('synapse-section-reset');
			setting.addButton((button) => {
				button
					.setButtonText('Reset')
					.setWarning()
					.setTooltip(`Reset ${entry.title} to defaults`)
					.setDisabled(atDefaults)
					.onClick(reset);
				this.resetControls[entry.key] = { setting, button, title: entry.title };
			});
			// Best-effort live refresh; the feature-toggle hook and full re-render cover the rest.
			const recompute = (): void => this.refreshResetDisabledState(entry.key);
			entry.bodyEl.addEventListener('input', recompute);
			entry.bodyEl.addEventListener('change', recompute);
		}
	}

	// Migrating to getSettingDefinitions() waits for minAppVersion >= 1.13.0.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.resetControls = {};

		const ctx = createSettingsSectionContext({
			containerEl,
			plugin: this.plugin,
			onFeatureToggle: () => this.refreshResetDisabledState(),
			rerender: () => this.display(),
		});

		for (const entry of SETTINGS_SECTIONS) {
			if (isSectionVisible(entry)) entry.render(ctx);
		}

		this.renderResetFooters(ctx);

		// No top-level plugin-name heading (community guidelines); version goes in a footer.
		containerEl.createDiv({
			cls: 'setting-item-description synapse-settings-footer',
			text: `Synapse v${this.plugin.manifest.version}`,
		});
	}
}
