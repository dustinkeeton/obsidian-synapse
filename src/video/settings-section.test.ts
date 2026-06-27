import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEl, ToggleComponent, ButtonComponent, Notice } from '../__mocks__/obsidian';
import { createSettingsSectionContext, NotificationManager } from '../shared';
import { renderVideoSettings } from './settings-section';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

const FEATURE_TOOLTIP = 'Enable video transcription';

// Expected per-OS install commands (also a spec for the rendered rows).
const YT_DLP_CMDS = [
	'brew install yt-dlp',
	'sudo apt install yt-dlp',
	'pipx install yt-dlp',
	'winget install yt-dlp',
	'choco install yt-dlp',
];
const FFMPEG_CMDS = [
	'brew install ffmpeg',
	'sudo apt install ffmpeg',
	'winget install ffmpeg',
	'choco install ffmpeg',
];
const ALL_CMDS = [...YT_DLP_CMDS, ...FFMPEG_CMDS];

// ── Stub-tree introspection helpers (mirror feature-chip-select.test.ts) ──
function walk(el: any, out: any[] = []): any[] {
	for (const c of el?.children ?? []) {
		out.push(c);
		walk(c, out);
	}
	return out;
}
function byClass(root: any, cls: string): any[] {
	return walk(root).filter((e) => e.classList?.contains(cls));
}
function classTexts(root: any, cls: string): string[] {
	return byClass(root, cls).map((e) => e.textContent);
}

let writeText: ReturnType<typeof vi.fn>;

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	// Real manager so the copy-failure path routes through it (#396); the routed
	// info() prepends "Synapse: " and creates a real Notice under the mock.
	const plugin = { settings, saveSettings, manifest: { version: '0.0.0-test' }, notifications: new NotificationManager() };
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
		Notice.instances.length = 0;
		writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
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

	it('renders each per-OS install command as a code row with a copy button (#382/#383)', () => {
		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		const cmds = classTexts(containerEl, 'synapse-install-cmd');
		for (const c of ALL_CMDS) expect(cmds).toContain(c);
		expect(cmds).toHaveLength(ALL_CMDS.length);

		// One copy button per command.
		expect(byClass(containerEl, 'synapse-install-copy')).toHaveLength(ALL_CMDS.length);

		const headings = classTexts(containerEl, 'synapse-install-help-heading');
		expect(headings).toContain('Install yt-dlp');
		expect(headings).toContain('Install ffmpeg (includes ffprobe)');
	});

	it('keeps each install panel hidden until its ? button toggles it (#383)', () => {
		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		const panels = byClass(containerEl, 'synapse-install-help');
		expect(panels).toHaveLength(2);

		const helpButtons = ButtonComponent.instances.filter((b) =>
			b.setTooltip.mock.calls.some((c) => c[0] === 'Show install commands'),
		);
		expect(helpButtons).toHaveLength(2);

		const openCount = () =>
			byClass(containerEl, 'synapse-install-help').filter((p) =>
				p.classList.contains('is-open'),
			).length;

		expect(openCount()).toBe(0); // collapsed by default
		helpButtons[0]._click();
		expect(openCount()).toBe(1); // expands exactly one
		helpButtons[0]._click();
		expect(openCount()).toBe(0); // and collapses again
		helpButtons[1]._click();
		expect(openCount()).toBe(1); // the other panel is independent
	});

	it('copies the exact command to the clipboard on copy-button click (#383)', () => {
		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		const copyButtons = byClass(containerEl, 'synapse-install-copy');
		for (const btn of copyButtons) btn.dispatchEvent({ type: 'click' });

		const copied = writeText.mock.calls.map((c) => c[0]);
		for (const c of ALL_CMDS) expect(copied).toContain(c);
	});

	it('confirms a successful copy in-place (checkmark state) (#383)', async () => {
		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		const btn = byClass(containerEl, 'synapse-install-copy')[0];
		expect(btn.classList.contains('is-copied')).toBe(false);

		btn.dispatchEvent({ type: 'click' });
		await Promise.resolve();
		await Promise.resolve();

		expect(btn.classList.contains('is-copied')).toBe(true);
		expect(btn.getAttribute('aria-label')).toBe('Copied!');
	});

	it('shows a notice when the clipboard write fails (#383)', async () => {
		writeText.mockRejectedValueOnce(new Error('denied'));
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		byClass(containerEl, 'synapse-install-copy')[0].dispatchEvent({ type: 'click' });
		await Promise.resolve();
		await Promise.resolve();

		expect(Notice.instances.some((n) => n.message === "Synapse: Couldn't copy to clipboard")).toBe(true);
		expect(errSpy).toHaveBeenCalled();
	});

	it('no longer mentions downloading the binary (#383)', () => {
		const { ctx, containerEl } = makeCtx();
		renderVideoSettings(ctx);

		const domText = walk(containerEl).map((e) => e.textContent ?? '').join(' ');
		expect(domText).not.toMatch(/download the binary/i);

		const tooltips = ButtonComponent.instances.flatMap((b) =>
			b.setTooltip.mock.calls.map((c) => String(c[0])),
		);
		expect(tooltips.join(' ')).not.toMatch(/download/i);
	});
});
