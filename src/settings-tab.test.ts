import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, Setting } from './__mocks__/obsidian';
import { SynapseSettingTab } from './settings-tab';
import { DEFAULT_SETTINGS } from './settings';
import type { SynapseSettings } from './settings';

/**
 * Tooltip of the REM feature's accordion-header enable toggle (see
 * `featureSection('rem', …)` in settings-tab.ts). Used to locate that toggle
 * among all rendered toggles so a test can simulate a user enabling/disabling
 * the REM feature itself.
 */
const REM_FEATURE_TOOLTIP =
	'Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions';

interface MockPlugin {
	settings: SynapseSettings;
	saveSettings: ReturnType<typeof vi.fn>;
	manifest: { version: string };
}

function makeTab(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const plugin: MockPlugin = {
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		manifest: { version: '0.0.0-test' },
	};
	const tab = new SynapseSettingTab({} as never, plugin as never);
	// The mock PluginSettingTab gives a bare containerEl; swap in a full stub el
	// that supports createDiv/createSpan/etc. so display() can render.
	(tab as unknown as { containerEl: HTMLElement }).containerEl = createEl();
	return { tab, plugin, settings };
}

/** The per-kind Auto-Accept `Setting` rows the tab tracks for live updates. */
function autoAcceptRows(tab: SynapseSettingTab): Record<string, Setting> {
	return (tab as unknown as { autoAcceptSettings: Record<string, Setting> })
		.autoAcceptSettings;
}

/** The Setting's first child toggle (the Auto-Accept on/off control). */
function rowToggle(row: Setting): ToggleComponent {
	return row.components[0];
}

function lastSetDisabledArg(row: Setting): boolean {
	const calls = (row.setDisabled as ReturnType<typeof vi.fn>).mock.calls;
	return calls[calls.length - 1][0] as boolean;
}

/** Recursively collect all anchor elements rendered into a stub element tree. */
function findAnchors(el: any, out: any[] = []): any[] {
	for (const child of el?.children ?? []) {
		if (child.tagName === 'A') out.push(child);
		findAnchors(child, out);
	}
	return out;
}

describe('SynapseSettingTab — Auto-Accept disabled state', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
	});

	it('disables an Auto-Accept row when its feature is disabled, enables it when enabled', () => {
		const { tab } = makeTab((s) => {
			s.rem.enabled = false; // disabled feature
			s.elaboration.enabled = true; // enabled feature
		});
		tab.display();

		const rows = autoAcceptRows(tab);
		expect(lastSetDisabledArg(rows['rem'])).toBe(true);
		expect(lastSetDisabledArg(rows['elaboration'])).toBe(false);
	});

	it('maps deep-dive to the deepDive feature flag (keys are not 1:1)', () => {
		const { tab } = makeTab((s) => {
			s.deepDive.enabled = false;
			s.organize.enabled = true;
		});
		tab.display();

		const rows = autoAcceptRows(tab);
		expect(lastSetDisabledArg(rows['deep-dive'])).toBe(true);
		expect(lastSetDisabledArg(rows['organize'])).toBe(false);
	});

	it('preserves the stored autoAccept value across a disable → re-enable cycle', async () => {
		const { tab, plugin } = makeTab((s) => {
			s.rem.enabled = true;
			s.autoAccept.rem = false;
		});
		tab.display();

		// User turns ON auto-accept for REM.
		const remRow = autoAcceptRows(tab)['rem'];
		await rowToggle(remRow)._trigger(true);
		expect(plugin.settings.autoAccept.rem).toBe(true);

		// Locate the REM feature's header enable toggle and turn the feature OFF.
		const remFeatureToggle = ToggleComponent.instances.find(
			(t) => t.tooltip === REM_FEATURE_TOOLTIP,
		);
		expect(remFeatureToggle).toBeDefined();
		await remFeatureToggle!._trigger(false);

		// Feature now disabled, but the stored auto-accept value is untouched…
		expect(plugin.settings.rem.enabled).toBe(false);
		expect(plugin.settings.autoAccept.rem).toBe(true);
		// …and the row was greyed out live (no full re-render).
		expect(lastSetDisabledArg(remRow)).toBe(true);

		// Re-enable the feature: value still intact, row re-enabled live.
		await remFeatureToggle!._trigger(true);
		expect(plugin.settings.autoAccept.rem).toBe(true);
		expect(lastSetDisabledArg(remRow)).toBe(false);

		// A fresh render restores the toggle exactly as the user left it (ON).
		tab.display();
		const remRowAfter = autoAcceptRows(tab)['rem'];
		expect(rowToggle(remRowAfter).getValue()).toBe(true);
	});

	it('never writes autoAccept when a feature is toggled (value falls out for free)', async () => {
		const { tab, plugin } = makeTab((s) => {
			s.rem.enabled = true;
			s.autoAccept.rem = false; // user left it OFF
		});
		tab.display();

		const remFeatureToggle = ToggleComponent.instances.find(
			(t) => t.tooltip === REM_FEATURE_TOOLTIP,
		);
		await remFeatureToggle!._trigger(false);
		await remFeatureToggle!._trigger(true);

		// A disable→re-enable cycle must not flip the stored OFF value to ON.
		expect(plugin.settings.autoAccept.rem).toBe(false);
	});
});

describe('SynapseSettingTab — About support links (#274)', () => {
	it('renders static GitHub Sponsors and Buy Me a Coffee links', () => {
		const { tab } = makeTab();
		tab.display();

		const containerEl = (tab as unknown as { containerEl: any }).containerEl;
		const anchors = findAnchors(containerEl);
		const byHref = new Map(
			anchors.map((a) => [a.getAttribute('href'), a.textContent]),
		);
		expect(byHref.get('https://github.com/sponsors/dustinkeeton')).toBe(
			'GitHub Sponsors',
		);
		expect(byHref.get('https://www.buymeacoffee.com/dustinkeeton')).toBe(
			'Buy Me a Coffee',
		);
	});
});
