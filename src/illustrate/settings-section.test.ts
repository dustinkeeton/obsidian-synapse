import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, type StubEl } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { renderIllustrateSettings, ILLUSTRATE_FEATURE_TOOLTIP } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const containerEl = createEl();
	const ctx = createSettingsSectionContext({ containerEl, plugin: plugin as never, onFeatureToggle: vi.fn(), rerender: vi.fn() });
	return { ctx, plugin, containerEl, saveSettings };
}

function licenseBoxes(root: StubEl): HTMLInputElement[] {
	return root.findAll('.synapse-illustrate-license').map((label) => (label.children as unknown as HTMLInputElement[])[0]);
}

describe('renderIllustrateSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders the accordion with the header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.illustrate.enabled = true; });
		renderIllustrateSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === ILLUSTRATE_FEATURE_TOOLTIP);
		expect(headerToggle?.getValue()).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.illustrate.enabled = true; });
		renderIllustrateSettings(ctx);
		await ToggleComponent.instances.find((t) => t.tooltip === ILLUSTRATE_FEATURE_TOOLTIP)!._trigger(false);
		expect(plugin.settings.illustrate.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('renders one license checkbox per known license, checked per the filter', () => {
		const { ctx, containerEl } = makeCtx();
		renderIllustrateSettings(ctx);
		const boxes = licenseBoxes(containerEl);
		expect(boxes).toHaveLength(8);
		const checked = boxes.filter((box) => box.checked).map((box) => box.getAttribute('data-license'));
		expect(checked).toEqual(['CC0', 'Public domain', 'CC BY', 'CC BY-SA']);
	});

	it('toggling a license checkbox rewrites the filter in canonical order and saves', () => {
		const { ctx, containerEl, plugin, saveSettings } = makeCtx();
		renderIllustrateSettings(ctx);
		const nc = licenseBoxes(containerEl).find((box) => box.getAttribute('data-license') === 'CC BY-NC')!;
		nc.checked = true;
		(nc as unknown as StubEl).dispatchEvent({ type: 'change' });
		expect(plugin.settings.illustrate.licenseFilter).toEqual(['CC0', 'Public domain', 'CC BY', 'CC BY-SA', 'CC BY-NC']);
		const cc0 = licenseBoxes(containerEl).find((box) => box.getAttribute('data-license') === 'CC0')!;
		cc0.checked = false;
		(cc0 as unknown as StubEl).dispatchEvent({ type: 'change' });
		expect(plugin.settings.illustrate.licenseFilter).toEqual(['Public domain', 'CC BY', 'CC BY-SA', 'CC BY-NC']);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});
});
