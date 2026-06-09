import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { renderDeepDiveSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Recursively explore a note into a tree of interlinked child notes';

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const containerEl = createEl();
	const ctx = createSettingsSectionContext({
		containerEl,
		plugin: plugin as never,
		onFeatureToggle: vi.fn(),
		rerender: vi.fn(),
	});
	return { ctx, plugin, containerEl, saveSettings };
}

describe('renderDeepDiveSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders an accordion (key "deepDive") with the header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.deepDive.enabled = true; });
		renderDeepDiveSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP);
		expect(headerToggle).toBeDefined();
		expect(headerToggle!.getValue()).toBe(true);
	});

	it('uses the deepDive collapse key (deep-dive → deepDive nuance)', async () => {
		const { ctx, plugin } = makeCtx((s) => { s.deepDive.enabled = true; });
		renderDeepDiveSettings(ctx);
		// Collapsing the section persists under ui.collapsedSections['deepDive'].
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false); // disabling auto-collapses → persists collapse
		expect(plugin.settings.ui.collapsedSections['deepDive']).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.deepDive.enabled = true; });
		renderDeepDiveSettings(ctx);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false);
		expect(plugin.settings.deepDive.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});
});
