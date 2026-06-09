import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { renderAudioSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Enable audio transcription';

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const rerender = vi.fn();
	const plugin = { settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const containerEl = createEl();
	const ctx = createSettingsSectionContext({
		containerEl,
		plugin: plugin as never,
		onFeatureToggle: vi.fn(),
		rerender,
	});
	return { ctx, plugin, containerEl, saveSettings, rerender };
}

describe('renderAudioSettings', () => {
	beforeEach(() => { ToggleComponent.instances.length = 0; });

	it('renders an accordion with the feature header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.audio.enabled = true; });
		renderAudioSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP);
		expect(headerToggle).toBeDefined();
		expect(headerToggle!.getValue()).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.audio.enabled = true; });
		renderAudioSettings(ctx);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false);
		expect(plugin.settings.audio.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('renders without throwing for either AI provider (Whisper key visibility branch)', () => {
		const openai = makeCtx((s) => { s.audio.transcriptionProvider = 'whisper-api'; s.ai.provider = 'openai'; });
		expect(() => renderAudioSettings(openai.ctx)).not.toThrow();
		const anthropic = makeCtx((s) => { s.audio.transcriptionProvider = 'whisper-api'; s.ai.provider = 'anthropic'; });
		expect(() => renderAudioSettings(anthropic.ctx)).not.toThrow();
	});
});
