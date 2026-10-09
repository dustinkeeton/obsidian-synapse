import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, Setting, ToggleComponent } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { REM_THRESHOLD_DESC, renderRemSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions. Link suggestions are ranked by AI content relevance, not just literal title matches.';

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

describe('renderRemSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders an accordion with the feature header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.rem.enabled = true; });
		renderRemSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP);
		expect(headerToggle).toBeDefined();
		expect(headerToggle!.getValue()).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.rem.enabled = true; });
		renderRemSettings(ctx);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false);
		expect(plugin.settings.rem.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('describes what the confidence threshold gates in both lanes', () => {
		const { ctx } = makeCtx();
		Setting.instances.length = 0;
		renderRemSettings(ctx);
		const threshold = Setting.instances.find((st) => st.setName.mock.calls.some(([n]) => n === 'Confidence threshold'))!;
		expect(threshold.setDesc).toHaveBeenCalledWith(REM_THRESHOLD_DESC);
		expect(REM_THRESHOLD_DESC).toMatch(/strongly related/);
		expect(REM_THRESHOLD_DESC).toMatch(/before it is proposed/);
	});
});
