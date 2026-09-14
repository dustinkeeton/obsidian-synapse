import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { renderElaborationSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Enable stub note detection and proposal generation';

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

describe('renderElaborationSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders an accordion with the feature header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.elaboration.enabled = true; });
		renderElaborationSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP);
		expect(headerToggle).toBeDefined();
		expect(headerToggle!.getValue()).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.elaboration.enabled = true; });
		renderElaborationSettings(ctx);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false);
		expect(plugin.settings.elaboration.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});
});

describe('renderElaborationSettings -- backlink context toggle (#500)', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders the toggle from includeBacklinkContext and saves on change', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => {
			s.elaboration.proposal.includeBacklinkContext = false;
		});
		renderElaborationSettings(ctx);
		const toggle = ToggleComponent.instances.find(
			(t) => t.tooltip !== FEATURE_TOOLTIP && t.getValue() === false
		);
		expect(toggle).toBeDefined();
		await toggle!._trigger(true);
		expect(plugin.settings.elaboration.proposal.includeBacklinkContext).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('defaults includeBacklinkContext to on', () => {
		expect(DEFAULT_SETTINGS.elaboration.proposal.includeBacklinkContext).toBe(true);
	});
});
