import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, ButtonComponent } from '../__mocks__/obsidian';
import { createSettingsSectionContext } from '../shared';
import { renderVideoSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Enable video transcription';

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

describe('renderVideoSettings', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
		ButtonComponent.instances.length = 0;
	});

	it('renders an accordion with the feature header toggle reflecting enabled state', () => {
		const { ctx, containerEl } = makeCtx((s) => { s.video.enabled = true; });
		renderVideoSettings(ctx);
		expect(containerEl.children.length).toBeGreaterThan(0);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP);
		expect(headerToggle).toBeDefined();
		expect(headerToggle!.getValue()).toBe(true);
	});

	it('writes the enabled flag and saves when the header toggle changes', async () => {
		const { ctx, plugin, saveSettings } = makeCtx((s) => { s.video.enabled = true; });
		renderVideoSettings(ctx);
		const headerToggle = ToggleComponent.instances.find((t) => t.tooltip === FEATURE_TOOLTIP)!;
		await headerToggle._trigger(false);
		expect(plugin.settings.video.enabled).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('adds per-OS install help (?-button tooltips) to the yt-dlp and ffmpeg path settings (#382)', () => {
		const { ctx } = makeCtx();
		renderVideoSettings(ctx);

		// Each help affordance is an extra button whose tooltip carries the
		// per-OS install instructions; the mock records setTooltip calls.
		const tooltips = ButtonComponent.instances.flatMap((b) =>
			b.setTooltip.mock.calls.map((c) => String(c[0]))
		);

		const ytdlpHelp = tooltips.find((t) => /yt-dlp/i.test(t));
		expect(ytdlpHelp).toBeDefined();
		expect(ytdlpHelp!).toMatch(/brew install yt-dlp/);    // macOS
		expect(ytdlpHelp!).toMatch(/apt install yt-dlp/);     // Linux
		expect(ytdlpHelp!).toMatch(/winget install yt-dlp/);  // Windows

		const ffmpegHelp = tooltips.find((t) => /brew install ffmpeg/i.test(t));
		expect(ffmpegHelp).toBeDefined();
		expect(ffmpegHelp!).toMatch(/apt install ffmpeg/);    // Linux
		expect(ffmpegHelp!).toMatch(/winget install ffmpeg/); // Windows
	});
});
