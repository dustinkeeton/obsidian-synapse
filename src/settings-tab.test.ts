import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, ToggleComponent, ButtonComponent, Setting, type StubEl } from './__mocks__/obsidian';

// Mock the changelog modal so this suite never resolves the real CHANGELOG.md
// import (a build-time `.md` text import that Vitest can't transform), and so
// the About link's open behavior can be asserted (#375).
const { changelogOpen } = vi.hoisted(() => ({ changelogOpen: vi.fn() }));
vi.mock('./changelog-modal', () => ({
	// A regular function (not an arrow) so it's usable with `new` while staying a
	// spy for construction assertions.
	ChangelogModal: vi.fn(function (this: { open: () => void }) {
		this.open = changelogOpen;
	}),
}));

// Mock the confirm modal (used by both the per-section reset and the global
// reset-all) so its confirm/cancel outcome is controllable via `confirmResult`
// without opening a real modal (#420). Mocking the leaf module also covers the
// `./shared` barrel re-export that settings-tab imports.
const { confirmResult } = vi.hoisted(() => ({ confirmResult: vi.fn() }));
vi.mock('./shared/confirm-modal', () => ({
	ConfirmModal: vi.fn(function (this: { openAndConfirm: () => Promise<boolean> }) {
		this.openAndConfirm = confirmResult;
	}),
}));

import { ChangelogModal } from './changelog-modal';
import { ConfirmModal } from './shared/confirm-modal';
import { SynapseSettingTab } from './settings-tab';
import { DEFAULT_SETTINGS } from './settings';
import type { SynapseSettings } from './settings';
import { createSettingsSectionContext } from './shared';
import { METADATA_CONTAINER_SELECTOR, PROPERTIES_COLLAPSED_CLASS } from './properties-fold';

/**
 * Tooltip of the REM feature's accordion-header enable toggle (see
 * `featureSection('rem', …)` in settings-tab.ts). Used to locate that toggle
 * among all rendered toggles so a test can simulate a user enabling/disabling
 * the REM feature itself.
 */
const REM_FEATURE_TOOLTIP =
	'Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions. Link suggestions are ranked by AI content relevance, not just literal title matches.';

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
function findAnchors(el: StubEl, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		if (child.tagName === 'A') out.push(child);
		findAnchors(child, out);
	}
	return out;
}

/**
 * Recursively collect stub elements whose own text contains `needle`. The mock's
 * `textContent` is per-element (it does not aggregate descendants), so a match is
 * the element that was created with that text — not an ancestor.
 */
function findByText(el: StubEl, needle: string, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		if (typeof child.textContent === 'string' && child.textContent.includes(needle)) {
			out.push(child);
		}
		findByText(child, needle, out);
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

describe('SynapseSettingTab — transcription credentials in AI Configuration (#332)', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
	});

	// The transcription provider dropdown + its API-key fields now render inside
	// the AI Configuration section. A full display() across a couple of provider
	// values confirms the relocated controls render in their new home without
	// throwing (the Obsidian mock no-ops dropdown/text, so this is a smoke test).
	it.each(['whisper-api', 'gemini', 'deepgram'] as const)(
		'renders the settings tab without throwing for transcription provider %s',
		(provider) => {
			const { tab } = makeTab((s) => {
				s.audio.transcriptionProvider = provider;
			});
			expect(() => tab.display()).not.toThrow();
		},
	);
});

describe('SynapseSettingTab — About support links (#274)', () => {
	it('renders static GitHub Sponsors and Buy Me a Coffee links', () => {
		const { tab } = makeTab();
		tab.display();

		const containerEl = (tab as unknown as { containerEl: StubEl }).containerEl;
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

describe('SynapseSettingTab — About "What\'s new" changelog link (#375)', () => {
	beforeEach(() => {
		(ChangelogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
		changelogOpen.mockClear();
	});

	it('renders a "What\'s new" link that opens the changelog modal on click', () => {
		const { tab } = makeTab();
		tab.display();

		const containerEl = (tab as unknown as { containerEl: StubEl }).containerEl;
		const link = findAnchors(containerEl).find((a) => a.textContent === "What's new");
		expect(link).toBeDefined();

		const preventDefault = vi.fn();
		link!.dispatchEvent({ type: 'click', preventDefault });

		expect(preventDefault).toHaveBeenCalled();
		expect(ChangelogModal).toHaveBeenCalledTimes(1);
		expect(changelogOpen).toHaveBeenCalledTimes(1);
	});
});

/** Recursively collect every element in a stub tree. */
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
function elsWithTag(root: StubEl, tag: string): StubEl[] {
	return walkEls(root).filter((e) => e.tagName === tag);
}

describe('SynapseSettingTab — Exclusions chip multi-select (#328)', () => {
	/**
	 * The `synapse-exclusion-chips` containers in DOM order: one per rule, then the
	 * add-folder and add-pattern scope pickers. (The mocked `Setting` rows are not
	 * appended to the container, so only these chip divs are introspectable.)
	 */
	function chipContainers(tab: SynapseSettingTab): StubEl[] {
		const containerEl = (tab as unknown as { containerEl: StubEl }).containerEl;
		return elsWithClass(containerEl, 'synapse-exclusion-chips');
	}
	const chipLabels = (container: StubEl): (string | null)[] =>
		elsWithClass(container, 'synapse-chip-label').map((e) => e.textContent);

	/**
	 * Every chip container must be nested directly inside a `.setting-item` host
	 * that carries `synapse-setting--has-helper` (the #347 nesting). We assert it
	 * structurally: find a host with both classes whose direct children include
	 * the chip div.
	 */
	function assertChipsNestedInSettingItem(tab: SynapseSettingTab): void {
		const containerEl = (tab as unknown as { containerEl: StubEl }).containerEl;
		const hosts = walkEls(containerEl).filter(
			(e) =>
				e.classList.contains('setting-item') &&
				e.classList.contains('synapse-setting--has-helper'),
		);
		for (const chip of chipContainers(tab)) {
			const host = hosts.find((h) => (h.children as unknown as StubEl[]).includes(chip));
			expect(host).toBeDefined();
		}
	}

	it('renders one removable chip per scoped feature, ordered by FEATURE_ORDER', () => {
		const { tab } = makeTab((s) => {
			s.exclusions = [{ pattern: 'Archive/**', features: ['organize', 'summarize'] }];
		});
		tab.display();

		const containers = chipContainers(tab);
		expect(containers).toHaveLength(3); // rule + add-folder + add-pattern
		expect(chipLabels(containers[0])).toEqual(['Summarize', 'Organize']);
		// #347: each chip list now lives inside its owning `.setting-item`.
		assertChipsNestedInSettingItem(tab);
	});

	it("renders a single 'All features' chip for an all-scoped rule", () => {
		const { tab } = makeTab((s) => {
			s.exclusions = [{ pattern: '.synapse/**', features: 'all' }];
		});
		tab.display();
		expect(chipLabels(chipContainers(tab)[0])).toEqual(['All features']);
	});

	it('adds a feature to a rule via its dropdown and persists', () => {
		const { tab, plugin } = makeTab((s) => {
			s.exclusions = [{ pattern: 'Archive/**', features: ['organize'] }];
		});
		tab.display();

		const select = elsWithTag(chipContainers(tab)[0], 'SELECT')[0];
		select.value = 'summarize';
		select.dispatchEvent({ type: 'change' });

		expect(plugin.settings.exclusions[0].features).toEqual(['summarize', 'organize']);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it('removes a feature from a rule via its chip and persists', () => {
		const { tab, plugin } = makeTab((s) => {
			s.exclusions = [{ pattern: 'Archive/**', features: ['summarize', 'organize'] }];
		});
		tab.display();

		const removeBtn = elsWithClass(chipContainers(tab)[0], 'synapse-chip-remove').find(
			(b) => b.getAttribute('aria-label') === 'Remove Organize',
		);
		removeBtn!.dispatchEvent({ type: 'click' });

		expect(plugin.settings.exclusions[0].features).toEqual(['summarize']);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it('gives the add rows a scope picker defaulting to "All features"', () => {
		const { tab } = makeTab((s) => {
			s.exclusions = [];
		});
		tab.display();

		// No rules → the only chip containers are the two add-row pickers.
		const containers = chipContainers(tab);
		expect(containers).toHaveLength(2);
		for (const c of containers) expect(chipLabels(c)).toEqual(['All features']);
		// #347: the add-folder / add-pattern chip lists nest inside their `.setting-item`.
		assertChipsNestedInSettingItem(tab);
	});
});

describe('SynapseSettingTab — General section / auto-fold properties (#381)', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
	});

	/**
	 * A fake markdown view exposing a `querySelector`-able `containerEl` with a
	 * Properties panel, so a toggle-on can be asserted to fold it. `isCollapsed`
	 * reports whether the panel carries Obsidian's collapsed class.
	 */
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

	/** Render ONLY the General section so its toggles are unambiguous. */
	function renderGeneral(
		mutate?: (s: SynapseSettings) => void,
		activeView?: unknown,
	) {
		const settings = structuredClone(DEFAULT_SETTINGS);
		mutate?.(settings);
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const getActiveViewOfType = vi.fn().mockReturnValue(activeView ?? null);
		const app = { workspace: { getActiveViewOfType } };
		const plugin = { app, settings, saveSettings, manifest: { version: '0.0.0-test' } };
		const tab = new SynapseSettingTab(app as never, plugin as never);
		const containerEl = createEl();
		const ctx = createSettingsSectionContext({
			containerEl,
			plugin: plugin as never,
			rerender: vi.fn(),
		});
		(tab as unknown as { renderGeneralSettings(c: unknown): void }).renderGeneralSettings(ctx);
		return { plugin, settings, saveSettings, containerEl, getActiveViewOfType };
	}

	// Toggles render in source order: auto-fold (#381) first, then update
	// notifications (#365).
	const generalToggle = () => ToggleComponent.instances[0];
	const updateToggle = () => ToggleComponent.instances[1];

	it('renders a "General" accordion section', () => {
		const { containerEl } = renderGeneral();
		const titles = elsWithClass(containerEl, 'synapse-accordion-title').map((e) => e.textContent);
		expect(titles).toContain('General');
	});

	it('renders the auto-fold toggle reflecting the stored setting (on)', () => {
		renderGeneral((s) => { s.ui.autoFoldProperties = true; });
		// Two General toggles now: auto-fold (#381) + update notifications (#365).
		expect(ToggleComponent.instances).toHaveLength(2);
		expect(generalToggle().getValue()).toBe(true);
	});

	it('renders the auto-fold toggle reflecting the stored setting (off)', () => {
		renderGeneral((s) => { s.ui.autoFoldProperties = false; });
		expect(generalToggle().getValue()).toBe(false);
	});

	it('persists the flag and saves when the toggle changes', async () => {
		const { plugin, saveSettings } = renderGeneral((s) => { s.ui.autoFoldProperties = false; });
		await generalToggle()._trigger(true);
		expect(plugin.settings.ui.autoFoldProperties).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('folds the active note Properties immediately when switched on', async () => {
		const { view, isCollapsed } = makeFoldableView();
		const { getActiveViewOfType } = renderGeneral(
			(s) => { s.ui.autoFoldProperties = false; },
			view,
		);
		await generalToggle()._trigger(true);
		expect(getActiveViewOfType).toHaveBeenCalled();
		expect(isCollapsed()).toBe(true);
	});

	it('does not fold (or reach the view) when switched off', async () => {
		const { view, isCollapsed } = makeFoldableView();
		const { getActiveViewOfType } = renderGeneral(
			(s) => { s.ui.autoFoldProperties = true; },
			view,
		);
		await generalToggle()._trigger(false);
		expect(isCollapsed()).toBe(false);
		expect(getActiveViewOfType).not.toHaveBeenCalled();
	});

	it('renders the update-notifications toggle reflecting the stored setting', () => {
		renderGeneral((s) => { s.updates.enableUpdateNotifications = false; });
		expect(updateToggle().getValue()).toBe(false);
	});

	it('persists the update-notifications flag and saves when the toggle changes', async () => {
		const { plugin, saveSettings } = renderGeneral(
			(s) => { s.updates.enableUpdateNotifications = true; },
		);
		await updateToggle()._trigger(false);
		expect(plugin.settings.updates.enableUpdateNotifications).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
	});
});

describe('SynapseSettingTab — no-subscription note in AI Configuration (#364)', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
	});

	function subscriptionNotes(tab: SynapseSettingTab): StubEl[] {
		const container = (tab as unknown as { containerEl: StubEl }).containerEl;
		return findByText(container, 'Subscriptions');
	}

	it.each(['openai', 'anthropic', 'gemini'] as const)(
		'shows the no-subscription note for hosted provider %s',
		(provider) => {
			const { tab } = makeTab((s) => {
				s.ai.provider = provider;
			});
			tab.display();
			expect(subscriptionNotes(tab).length).toBeGreaterThan(0);
		},
	);

	it('omits the note when the local Ollama provider is selected', () => {
		const { tab } = makeTab((s) => {
			s.ai.provider = 'ollama';
		});
		tab.display();
		expect(subscriptionNotes(tab)).toHaveLength(0);
	});
});

/** Drain pending microtasks so an async reset handler (fired via `_click`) settles. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SynapseSettingTab — per-section reset rows (#442)', () => {
	beforeEach(() => {
		ToggleComponent.instances.length = 0;
		ButtonComponent.instances.length = 0;
		(ConfirmModal as unknown as ReturnType<typeof vi.fn>).mockClear();
		confirmResult.mockReset();
	});

	/**
	 * The private per-section reset control map the tab tracks, keyed by section
	 * key (read the way `autoAcceptRows` reads `autoAcceptSettings`). Each entry
	 * holds the row's `Setting` and its `ButtonComponent`, whose `.disabled`
	 * mirrors whether the section already equals shipped defaults.
	 */
	function resetControls(
		tab: SynapseSettingTab,
	): Record<string, { setting: Setting; button: ButtonComponent; title: string }> {
		return (
			tab as unknown as {
				resetControls: Record<
					string,
					{ setting: Setting; button: ButtonComponent; title: string }
				>;
			}
		).resetControls;
	}

	/** All accordion section wrappers, in DOM order. */
	function accordions(tab: SynapseSettingTab): StubEl[] {
		const container = (tab as unknown as { containerEl: StubEl }).containerEl;
		return elsWithClass(container, 'synapse-accordion');
	}

	/** The collapsible body of the accordion whose header title matches `title`. */
	function sectionBody(tab: SynapseSettingTab, title: string): StubEl | undefined {
		const section = accordions(tab).find((acc) =>
			elsWithClass(acc, 'synapse-accordion-title').some((t) => t.textContent === title),
		);
		return section ? elsWithClass(section, 'synapse-accordion-body')[0] : undefined;
	}

	it('registers a labeled "Reset" control for every section except About', () => {
		const { tab } = makeTab();
		tab.display();

		const controls = resetControls(tab);
		// A representative feature section + both cross-cutting config sections…
		expect(controls['elaboration']).toBeDefined();
		expect(controls['ai']).toBeDefined();
		expect(controls['general']).toBeDefined();
		// …every registered control is the labeled "Reset" button (not the old icon)…
		for (const key of Object.keys(controls)) {
			expect(controls[key].button.buttonText).toBe('Reset');
		}
		// …and About hosts the global reset-all row instead of a per-section reset.
		expect(controls['about']).toBeUndefined();
	});

	it('disables every section reset button at shipped defaults', () => {
		const { tab } = makeTab();
		tab.display();

		const controls = resetControls(tab);
		expect(Object.keys(controls).length).toBeGreaterThan(0);
		for (const key of Object.keys(controls)) {
			// setDisabled(true) at defaults — a reset would be a no-op.
			expect(controls[key].button.disabled).toBe(true);
		}
	});

	it('enables only the section whose settings diverge from defaults', () => {
		const { tab } = makeTab((s) => {
			s.elaboration.proposalFolderPath = 'custom/path';
		});
		tab.display();

		const controls = resetControls(tab);
		expect(controls['elaboration'].button.disabled).toBe(false);
		// A pristine sibling section stays disabled.
		expect(controls['organize'].button.disabled).toBe(true);
	});

	it('records the disabled decision through setDisabled (asserted, never via _click)', () => {
		const { tab } = makeTab((s) => {
			s.audio.language = 'es'; // dirties the Audio behavior section
		});
		tab.display();

		const setDisabled = resetControls(tab)['audio'].button.setDisabled as ReturnType<
			typeof vi.fn
		>;
		expect(setDisabled.mock.calls.at(-1)?.[0]).toBe(false);
	});

	it('re-enables a section reset live when a change event fires on its body', () => {
		const { tab, plugin } = makeTab();
		tab.display();

		const control = resetControls(tab)['elaboration'];
		expect(control.button.disabled).toBe(true); // pristine

		// An inline edit dirties the section; the delegated body listener recomputes.
		plugin.settings.elaboration.proposalFolderPath = 'custom/path';
		const body = sectionBody(tab, 'Note elaboration');
		expect(body).toBeDefined();
		body!.dispatchEvent({ type: 'change' });

		expect(control.button.disabled).toBe(false);
	});

	it('restores the section subtree, saves, and re-renders when confirmed', async () => {
		confirmResult.mockResolvedValue(true);
		const { tab, plugin } = makeTab((s) => {
			s.elaboration.enabled = false;
			s.elaboration.proposalFolderPath = 'custom/path';
		});
		const displaySpy = vi.spyOn(tab, 'display');
		tab.display();

		await resetControls(tab)['elaboration'].button._click();
		await flush();

		expect(plugin.settings.elaboration).toEqual(DEFAULT_SETTINGS.elaboration);
		expect(plugin.saveSettings).toHaveBeenCalled();
		// Initial render + the post-reset re-render.
		expect(displaySpy).toHaveBeenCalledTimes(2);
	});

	it('leaves settings untouched (no save) when the confirmation is cancelled', async () => {
		confirmResult.mockResolvedValue(false);
		const { tab, plugin } = makeTab((s) => {
			s.elaboration.enabled = false;
		});
		tab.display();

		await resetControls(tab)['elaboration'].button._click();
		await flush();

		expect(plugin.settings.elaboration.enabled).toBe(false);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it('scopes the Audio section reset so transcription credentials survive', async () => {
		confirmResult.mockResolvedValue(true);
		const { tab, plugin } = makeTab((s) => {
			s.audio.enabled = false;
			s.audio.language = 'es';
			s.audio.deepgramApiKey = 'dg-key';
			s.audio.whisperApiKey = 'sk-whisper';
		});
		tab.display();

		await resetControls(tab)['audio'].button._click();
		await flush();

		// Behavior restored…
		expect(plugin.settings.audio.enabled).toBe(DEFAULT_SETTINGS.audio.enabled);
		expect(plugin.settings.audio.language).toBe(DEFAULT_SETTINGS.audio.language);
		// …credentials preserved.
		expect(plugin.settings.audio.deepgramApiKey).toBe('dg-key');
		expect(plugin.settings.audio.whisperApiKey).toBe('sk-whisper');
	});
});

describe('SynapseSettingTab — global reset all (#420)', () => {
	beforeEach(() => {
		ButtonComponent.instances.length = 0;
		(ConfirmModal as unknown as ReturnType<typeof vi.fn>).mockClear();
		confirmResult.mockReset();
	});

	function resetAllButton(): ButtonComponent | undefined {
		return ButtonComponent.instances.find((b) => b.buttonText === 'Reset all settings');
	}

	it('renders a "Reset all settings" warning button in About', () => {
		const { tab } = makeTab();
		tab.display();

		const btn = resetAllButton();
		expect(btn).toBeDefined();
		expect(btn!.setWarning).toHaveBeenCalled();
	});

	it('restores all settings and preserves bookkeeping when confirmed', async () => {
		confirmResult.mockResolvedValue(true);
		const { tab, plugin } = makeTab((s) => {
			s.ai.apiKey = 'sk';
			s.elaboration.enabled = false;
			s.onboarding.hasSeenWelcome = true;
			s.ui.collapsedSections = { audio: true };
			s.settingsVersion = 3;
		});
		tab.display();

		await resetAllButton()!._click();

		// Everything reset to defaults…
		expect(plugin.settings.ai.apiKey).toBe('');
		expect(plugin.settings.elaboration.enabled).toBe(true);
		// …except the preserved install bookkeeping.
		expect(plugin.settings.onboarding.hasSeenWelcome).toBe(true);
		expect(plugin.settings.ui.collapsedSections).toEqual({ audio: true });
		expect(plugin.settings.settingsVersion).toBe(3);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it('does nothing when the reset-all confirmation is cancelled', async () => {
		confirmResult.mockResolvedValue(false);
		const { tab, plugin } = makeTab((s) => {
			s.ai.apiKey = 'sk';
		});
		tab.display();

		await resetAllButton()!._click();

		expect(plugin.settings.ai.apiKey).toBe('sk');
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
