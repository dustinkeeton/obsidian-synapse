import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, Setting, type StubEl } from '../__mocks__/obsidian';

vi.mock('../changelog', () => ({
	ChangelogModal: vi.fn(function (this: { open: () => void }) {
		this.open = vi.fn();
	}),
}));

import { renderGeneral, renderAutoAccept } from './global-sections';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { createSettingsSectionContext } from '../shared';
import { METADATA_CONTAINER_SELECTOR, PROPERTIES_COLLAPSED_CLASS } from '../properties-fold';

function walkEls(el: StubEl, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		out.push(child);
		walkEls(child, out);
	}
	return out;
}
function elsWithClass(root: StubEl, cls: string): StubEl[] {
	return walkEls(root).filter((e) => e.classList.contains(cls));
}

function makeCtx(mutate?: (s: SynapseSettings) => void, activeView?: unknown) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const getActiveViewOfType = vi.fn().mockReturnValue(activeView ?? null);
	const app = { workspace: { getActiveViewOfType } };
	const plugin = { app, settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const containerEl = createEl();
	const ctx = createSettingsSectionContext({
		containerEl,
		plugin: plugin as never,
		rerender: vi.fn(),
	});
	return { ctx, plugin, settings, saveSettings, containerEl, getActiveViewOfType };
}

describe('renderGeneral — auto-fold properties (#381) and update notifications (#365)', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
	});

	function makeFoldableView() {
		const classes = new Set<string>();
		const panel = {
			classList: {
				contains: (c: string) => classes.has(c),
				add: (c: string) => { classes.add(c); },
			},
		};
		const containerEl = {
			querySelector: (sel: string) =>
				sel === METADATA_CONTAINER_SELECTOR ? panel : null,
		};
		return { view: { containerEl }, isCollapsed: () => classes.has(PROPERTIES_COLLAPSED_CLASS) };
	}

	function renderGeneralOnly(mutate?: (s: SynapseSettings) => void, activeView?: unknown) {
		const made = makeCtx(mutate, activeView);
		renderGeneral(made.ctx);
		return made;
	}

	const generalToggle = () => ToggleComponent.instances[0];
	const updateToggle = () => ToggleComponent.instances[1];

	it('renders a "General" accordion section', () => {
		const { containerEl } = renderGeneralOnly();
		const titles = elsWithClass(containerEl, 'synapse-accordion-title').map((e) => e.textContent);
		expect(titles).toContain('General');
	});

	it('renders the auto-fold toggle reflecting the stored setting (on)', () => {
		renderGeneralOnly((s) => { s.ui.autoFoldProperties = true; });
		expect(ToggleComponent.instances).toHaveLength(2);
		expect(generalToggle().getValue()).toBe(true);
	});

	it('renders the auto-fold toggle reflecting the stored setting (off)', () => {
		renderGeneralOnly((s) => { s.ui.autoFoldProperties = false; });
		expect(generalToggle().getValue()).toBe(false);
	});

	it('persists the flag and saves when the toggle changes', async () => {
		const { plugin, saveSettings } = renderGeneralOnly((s) => { s.ui.autoFoldProperties = false; });
		await generalToggle()._trigger(true);
		expect(plugin.settings.ui.autoFoldProperties).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('folds the active note Properties immediately when switched on', async () => {
		const { view, isCollapsed } = makeFoldableView();
		const { getActiveViewOfType } = renderGeneralOnly(
			(s) => { s.ui.autoFoldProperties = false; },
			view,
		);
		await generalToggle()._trigger(true);
		expect(getActiveViewOfType).toHaveBeenCalled();
		expect(isCollapsed()).toBe(true);
	});

	it('does not fold (or reach the view) when switched off', async () => {
		const { view, isCollapsed } = makeFoldableView();
		const { getActiveViewOfType } = renderGeneralOnly(
			(s) => { s.ui.autoFoldProperties = true; },
			view,
		);
		await generalToggle()._trigger(false);
		expect(isCollapsed()).toBe(false);
		expect(getActiveViewOfType).not.toHaveBeenCalled();
	});

	it('renders the update-notifications toggle reflecting the stored setting', () => {
		renderGeneralOnly((s) => { s.updates.enableUpdateNotifications = false; });
		expect(updateToggle().getValue()).toBe(false);
	});

	it('persists the update-notifications flag and saves when the toggle changes', async () => {
		const { plugin, saveSettings } = renderGeneralOnly(
			(s) => { s.updates.enableUpdateNotifications = true; },
		);
		await updateToggle()._trigger(false);
		expect(plugin.settings.updates.enableUpdateNotifications).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});
});

describe('renderAutoAccept — live refresh via ctx.onFeatureToggle', () => {
	beforeEach(() => {
		Setting.instances.length = 0;
	});

	function lastSetDisabledArg(row: Setting): boolean {
		const calls = (row.setDisabled as ReturnType<typeof vi.fn>).mock.calls;
		return calls[calls.length - 1][0] as boolean;
	}

	it('re-syncs the REM row when a feature toggle listener fires', async () => {
		const listeners: Array<() => void | Promise<void>> = [];
		const { ctx, plugin } = makeCtx((s) => { s.rem.enabled = true; });
		ctx.onFeatureToggle = (l) => { listeners.push(l); };

		renderAutoAccept(ctx);
		const remRow = Setting.instances.find((s) => s.name === 'REM (link discovery)')!;
		expect(lastSetDisabledArg(remRow)).toBe(false);
		expect(listeners).toHaveLength(1);

		plugin.settings.rem.enabled = false;
		await listeners[0]();

		expect(lastSetDisabledArg(remRow)).toBe(true);
		expect(remRow.setDesc).toHaveBeenLastCalledWith(
			expect.stringContaining('(Enable REM (link discovery) to configure auto-accept.)'),
		);
	});
});
