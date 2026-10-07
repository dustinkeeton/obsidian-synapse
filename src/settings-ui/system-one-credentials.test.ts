import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, Setting, type StubEl } from '../__mocks__/obsidian';
import { renderSystemOneCredentials } from './system-one-credentials';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { createSettingsSectionContext } from '../shared';

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { app: {}, settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const containerEl = createEl();
	const rerender = vi.fn();
	const ctx = createSettingsSectionContext({ containerEl, plugin: plugin as never, rerender });
	return { ctx, settings, saveSettings, rerender, body: createEl() as unknown as HTMLElement };
}

function rowNames(): string[] {
	return Setting.instances.map((s) => s.name);
}

describe('renderSystemOneCredentials (#558)', () => {
	beforeEach(() => {
		Setting.instances.length = 0;
		ToggleComponent.instances.length = 0;
	});

	it('renders only the toggle while the lane is off', () => {
		const { ctx, body } = makeCtx();
		renderSystemOneCredentials(body, ctx);
		expect(rowNames()).toEqual(['System 1 decisions']);
		expect(ToggleComponent.instances[0].getValue()).toBe(false);
	});

	it('renders the key, model, and floor rows once enabled, with the Test affordance on the key row', () => {
		const { ctx, body } = makeCtx((s) => { s.ai.systemOne.enabled = true; });
		renderSystemOneCredentials(body, ctx);
		expect(rowNames()).toEqual(['System 1 decisions', 'TypeSafe API key', 'Decision model', 'Confidence floor']);
		const keyRow = Setting.instances[1];
		expect(keyRow.addButton).toHaveBeenCalledTimes(1);
		const children = Array.from(keyRow.settingEl.children) as unknown as StubEl[];
		expect(children.filter((c) => c.classList.contains('synapse-credential-extras'))).toHaveLength(1);
	});

	it('persists the toggle and re-renders so the dependent rows appear', async () => {
		const { ctx, body, settings, saveSettings, rerender } = makeCtx();
		renderSystemOneCredentials(body, ctx);
		await ToggleComponent.instances[0]._trigger(true);
		expect(settings.ai.systemOne.enabled).toBe(true);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(rerender).toHaveBeenCalledTimes(1);
	});

	it('falls back to the first model option when the saved model is unknown', () => {
		const { ctx, body, settings } = makeCtx((s) => {
			s.ai.systemOne.enabled = true;
			s.ai.systemOne.model = 'jev-retired';
		});
		renderSystemOneCredentials(body, ctx);
		expect(settings.ai.systemOne.model).toBe('jev-latest');
	});
});
