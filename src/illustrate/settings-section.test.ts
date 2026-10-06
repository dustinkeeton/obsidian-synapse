import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, Setting, ToggleComponent, type StubEl } from '../__mocks__/obsidian';
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

function runAfterBoxes(root: StubEl): HTMLInputElement[] {
	return root.findAll('.synapse-illustrate-run-after-row').map((label) => (label.children as unknown as HTMLInputElement[])[0]);
}

function licenseBoxes(root: StubEl): HTMLInputElement[] {
	return root.findAll('.synapse-illustrate-license').map((label) => (label.children as unknown as HTMLInputElement[])[0]);
}

function toggleNamed(name: string): ToggleComponent {
	return Setting.instances.find((s) => s.name === name)!.components[0];
}

function emptyConfigHelper(root: StubEl): StubEl {
	return root.findAll('.synapse-illustrate-empty-config')[0];
}

describe('renderIllustrateSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; Setting.instances.length = 0; });

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
		expect(boxes).toHaveLength(9);
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

	it('renders one run-after checkbox per chained action, all off by default', () => {
		const { ctx, containerEl } = makeCtx();
		renderIllustrateSettings(ctx);
		const boxes = runAfterBoxes(containerEl);
		expect(boxes.map((box) => box.getAttribute('data-run-after'))).toEqual(['elaboration', 'transcription', 'summarize', 'enrichment', 'deepDive']);
		expect(boxes.every((box) => !box.checked)).toBe(true);
	});

	it('turning a run-after checkbox on sets the flag and adds Source page to the license filter once', () => {
		const { ctx, containerEl, plugin, saveSettings } = makeCtx();
		renderIllustrateSettings(ctx);
		const summarize = runAfterBoxes(containerEl).find((box) => box.getAttribute('data-run-after') === 'summarize')!;
		summarize.checked = true;
		(summarize as unknown as StubEl).dispatchEvent({ type: 'change' });
		expect(plugin.settings.illustrate.runAfter.summarize).toBe(true);
		expect(plugin.settings.illustrate.licenseFilter).toEqual(['CC0', 'Public domain', 'CC BY', 'CC BY-SA', 'Source page']);
		summarize.checked = false;
		(summarize as unknown as StubEl).dispatchEvent({ type: 'change' });
		expect(plugin.settings.illustrate.runAfter.summarize).toBe(false);
		expect(plugin.settings.illustrate.licenseFilter).toContain('Source page');
		const deepDive = runAfterBoxes(containerEl).find((box) => box.getAttribute('data-run-after') === 'deepDive')!;
		deepDive.checked = true;
		(deepDive as unknown as StubEl).dispatchEvent({ type: 'change' });
		expect(plugin.settings.illustrate.licenseFilter.filter((l) => l === 'Source page')).toHaveLength(1);
		expect(saveSettings).toHaveBeenCalledTimes(3);
	});

	it('renders the Mermaid toggle off by default and saves the flag when it changes (#549)', async () => {
		const { ctx, plugin, saveSettings } = makeCtx();
		renderIllustrateSettings(ctx);
		const toggle = toggleNamed('Propose Mermaid diagrams and charts');
		expect(toggle.getValue()).toBe(false);
		await toggle._trigger(true);
		expect(plugin.settings.illustrate.mermaid).toBe(true);
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it('hides the empty-config helper while a photo provider is enabled', () => {
		const { ctx, containerEl } = makeCtx();
		renderIllustrateSettings(ctx);
		expect(emptyConfigHelper(containerEl).classList.contains('is-hidden')).toBe(true);
	});

	it('shows the empty-config helper when no provider and no Mermaid output is enabled', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.illustrate.providers = { wikimedia: false, openverse: false }; });
		renderIllustrateSettings(ctx);
		const helper = emptyConfigHelper(containerEl);
		expect(helper.classList.contains('is-hidden')).toBe(false);
		expect(helper.textContent).toContain('Mermaid');
	});

	it('re-evaluates the empty-config helper as the provider and Mermaid toggles change', async () => {
		const { ctx, containerEl } = makeCtx();
		renderIllustrateSettings(ctx);
		const helper = emptyConfigHelper(containerEl);
		await toggleNamed('Wikimedia Commons')._trigger(false);
		expect(helper.classList.contains('is-hidden')).toBe(true);
		await toggleNamed('Openverse')._trigger(false);
		expect(helper.classList.contains('is-hidden')).toBe(false);
		await toggleNamed('Propose Mermaid diagrams and charts')._trigger(true);
		expect(helper.classList.contains('is-hidden')).toBe(true);
		await toggleNamed('Propose Mermaid diagrams and charts')._trigger(false);
		expect(helper.classList.contains('is-hidden')).toBe(false);
		await toggleNamed('Openverse')._trigger(true);
		expect(helper.classList.contains('is-hidden')).toBe(true);
	});

	it('puts both checkbox lists on a wrapping helper row and seeds checked state from settings', () => {
		const { ctx, containerEl } = makeCtx((s) => {
			s.illustrate.licenseFilter = ['CC BY-NC'];
			s.illustrate.runAfter.deepDive = true;
		});
		renderIllustrateSettings(ctx);
		for (const cls of ['synapse-illustrate-licenses', 'synapse-illustrate-run-after']) {
			const list = containerEl.findAll(`.${cls}`)[0];
			expect(list).toBeDefined();
		}
		const hosts = containerEl.findAll('.synapse-setting--has-helper');
		expect(hosts.length).toBeGreaterThanOrEqual(2);
		expect(licenseBoxes(containerEl).filter((box) => box.checked).map((box) => box.getAttribute('data-license'))).toEqual(['CC BY-NC']);
		expect(runAfterBoxes(containerEl).filter((box) => box.checked).map((box) => box.getAttribute('data-run-after'))).toEqual(['deepDive']);
	});
});
