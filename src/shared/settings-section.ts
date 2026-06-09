import type SynapsePlugin from '../main';
import { addCollapsibleSection } from './collapsible-section';

/**
 * Shared accordion plumbing for the settings tab (#243).
 *
 * The settings tab is a thin orchestrator that owns section ORDER and the
 * cross-cutting sections (AI Configuration, Auto-Accept). Each feature renders
 * its own section through a uniform `render<Feature>Settings(ctx)` function that
 * receives a {@link SettingsSectionContext}. This module is the only place that
 * knows how an accordion is built, so feature modules never import from
 * `settings-tab.ts` — they depend on `shared/` only.
 */
export interface SettingsSectionContext {
	/** The settings tab's root container element. */
	containerEl: HTMLElement;
	/** The plugin instance (settings + saveSettings + manifest). */
	plugin: SynapsePlugin;
	/**
	 * Render a feature accordion with an enable toggle in the header and return
	 * the body element to populate with the feature's sub-settings.
	 *
	 * The toggle is wired to the feature's `enabled` flag: turning it off
	 * auto-collapses the body, turning it on auto-expands it. Manual header
	 * clicks fold/unfold independently. All collapse changes persist under
	 * `ui.collapsedSections[key]`. After the toggle changes (and the new value
	 * is saved), the context's `onFeatureToggle` hook fires so the orchestrator
	 * can react — e.g. grey out the matching Auto-Accept row in place.
	 */
	featureSection(
		key: string,
		title: string,
		getEnabled: () => boolean,
		setEnabled: (value: boolean) => void,
		toggleDesc?: string,
	): HTMLElement;
	/**
	 * Render a config accordion that has no enable toggle (always-needed
	 * settings). It is collapsible/persistent but never auto-collapses.
	 */
	configSection(key: string, title: string): HTMLElement;
	/**
	 * Trigger a full re-render of the settings tab. Used by sections whose layout
	 * depends on a just-changed value (e.g. the audio transcription provider
	 * dropdown showing/hiding provider-specific fields).
	 */
	rerender: () => void;
}

/**
 * Options for {@link createSettingsSectionContext}. The orchestrator supplies
 * the container, plugin, a re-render hook, and an optional post-toggle hook.
 */
export interface SettingsSectionContextOptions {
	containerEl: HTMLElement;
	plugin: SynapsePlugin;
	/**
	 * Invoked after any feature header enable-toggle changes and the new value
	 * is persisted. Lets the orchestrator propagate the change live (without a
	 * full re-render) — e.g. refresh Auto-Accept rows' disabled state.
	 */
	onFeatureToggle?: () => void | Promise<void>;
	/** Full re-render hook (defaults to a no-op). */
	rerender?: () => void;
}

/**
 * Resolve the persisted collapse state for a section, falling back to a
 * sensible default: collapsed when the feature is disabled, expanded when it is
 * enabled. A `null` `enabled` (config sections with no toggle, e.g. AI
 * Configuration) defaults to expanded.
 */
export function isSectionCollapsed(
	plugin: SynapsePlugin,
	key: string,
	enabled: boolean | null,
): boolean {
	const persisted = plugin.settings.ui.collapsedSections[key];
	if (persisted !== undefined) return persisted;
	return enabled === false;
}

/** Persist a section's collapse state and save. */
export async function persistCollapse(
	plugin: SynapsePlugin,
	key: string,
	collapsed: boolean,
): Promise<void> {
	plugin.settings.ui.collapsedSections[key] = collapsed;
	await plugin.saveSettings();
}

/**
 * Build a {@link SettingsSectionContext} bound to a plugin and container. The
 * returned `featureSection`/`configSection` helpers close over the collapse
 * persistence and the post-toggle hook so feature renderers stay declarative.
 */
export function createSettingsSectionContext(
	options: SettingsSectionContextOptions,
): SettingsSectionContext {
	const { containerEl, plugin, onFeatureToggle, rerender } = options;

	function featureSection(
		key: string,
		title: string,
		getEnabled: () => boolean,
		setEnabled: (value: boolean) => void,
		toggleDesc?: string,
	): HTMLElement {
		const enabled = getEnabled();
		const { bodyEl } = addCollapsibleSection(containerEl, {
			title,
			enabled,
			collapsed: isSectionCollapsed(plugin, key, enabled),
			toggleAriaLabel: toggleDesc ?? `Enable ${title}`,
			onToggle: async (value) => {
				setEnabled(value);
				await plugin.saveSettings();
				// Greying out a feature must propagate to its Auto-Accept row in
				// place — the orchestrator flips the stored Setting's disabled
				// state directly rather than re-rendering (which would jump scroll
				// and collapse accordions).
				await onFeatureToggle?.();
			},
			onCollapseChange: async (collapsed) => {
				await persistCollapse(plugin, key, collapsed);
			},
		});
		return bodyEl;
	}

	function configSection(key: string, title: string): HTMLElement {
		const { bodyEl } = addCollapsibleSection(containerEl, {
			title,
			collapsed: isSectionCollapsed(plugin, key, null),
			onCollapseChange: async (collapsed) => {
				await persistCollapse(plugin, key, collapsed);
			},
		});
		return bodyEl;
	}

	return {
		containerEl,
		plugin,
		featureSection,
		configSection,
		rerender: rerender ?? (() => {}),
	};
}
