import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, Setting, type StubEl } from '../__mocks__/obsidian';
import { renderVoiceSetting } from './voice-setting';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { createSettingsSectionContext } from '../shared';

function walkEls(el: StubEl, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		out.push(child);
		walkEls(child, out);
	}
	return out;
}

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { app: {}, settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const rerender = vi.fn();
	const ctx = createSettingsSectionContext({ containerEl: createEl(), plugin: plugin as never, rerender });
	return { ctx, settings, saveSettings, rerender, body: createEl() };
}

const selectIn = (root: StubEl): StubEl => walkEls(root).find((e) => e.tagName === 'SELECT')!;
const textareasIn = (root: StubEl): StubEl[] => walkEls(root).filter((e) => e.tagName === 'TEXTAREA');

describe('renderVoiceSetting (#540)', () => {
	beforeEach(() => {
		Setting.instances.length = 0;
	});

	it('renders a Voice row whose select offers every option and shows neutral by default', () => {
		const { ctx, body } = makeCtx();
		renderVoiceSetting(body, ctx);

		expect(Setting.instances.map((s) => s.name)).toEqual(['Voice']);
		const select = selectIn(body);
		expect(select.className.split(/\s+/)).toContain('synapse-voice-select');
		const options = (select.children as unknown as StubEl[]).map((o) => o.value);
		expect(options).toEqual(['neutral', 'match-note', 'first-person', 'custom']);
		expect(select.value).toBe('neutral');
		expect(textareasIn(body)).toHaveLength(0);
	});

	it('persists a dropdown change and reveals the custom text area in place only for custom', () => {
		const { ctx, body, settings, saveSettings, rerender } = makeCtx();
		renderVoiceSetting(body, ctx);
		const select = selectIn(body);

		select.value = 'custom';
		select.dispatchEvent({ type: 'change' });
		expect(settings.ai.voice).toBe('custom');
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(textareasIn(body)).toHaveLength(1);

		select.value = 'match-note';
		select.dispatchEvent({ type: 'change' });
		expect(settings.ai.voice).toBe('match-note');
		expect(textareasIn(body)).toHaveLength(0);
		expect(rerender).not.toHaveBeenCalled();
	});

	it('pre-fills the custom text area and persists edits', () => {
		const { ctx, body, settings, saveSettings } = makeCtx((s) => {
			s.ai.voice = 'custom';
			s.ai.voiceCustom = 'Be terse.';
		});
		renderVoiceSetting(body, ctx);
		const [textarea] = textareasIn(body);
		expect(textarea.value).toBe('Be terse.');

		textarea.value = 'Write like a field guide.';
		textarea.dispatchEvent({ type: 'input' });
		expect(settings.ai.voiceCustom).toBe('Write like a field guide.');
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it('repairs an unknown persisted voice to neutral', () => {
		const { ctx, body, settings } = makeCtx((s) => {
			s.ai.voice = 'pirate' as SynapseSettings['ai']['voice'];
		});
		renderVoiceSetting(body, ctx);
		expect(settings.ai.voice).toBe('neutral');
		expect(selectIn(body).value).toBe('neutral');
	});
});
