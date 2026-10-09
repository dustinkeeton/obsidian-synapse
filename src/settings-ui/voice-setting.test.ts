import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEl, Setting, setIcon, type StubEl } from '../__mocks__/obsidian';
import {
	renderVoiceSetting,
	VOICE_DESC,
	NEUTRAL_NOTE,
	CUSTOM_LABEL,
	CUSTOM_LABEL_HINT,
	CUSTOM_PLACEHOLDER,
	CUSTOM_BLANK_HINT,
	CUSTOM_CARD_CLASS,
} from './voice-setting';
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

const classesOf = (el: StubEl): string[] => el.className.split(/\s+/);
const byClass = (root: StubEl, cls: string): StubEl[] => walkEls(root).filter((e) => classesOf(e).includes(cls));
const byTag = (root: StubEl, tag: string): StubEl[] => walkEls(root).filter((e) => e.tagName === tag.toUpperCase());

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { app: {}, settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const rerender = vi.fn();
	const ctx = createSettingsSectionContext({ containerEl: createEl(), plugin: plugin as never, rerender });
	const body = createEl();
	return { ctx, settings, saveSettings, rerender, body };
}

function render(mutate?: (s: SynapseSettings) => void) {
	const made = makeCtx(mutate);
	renderVoiceSetting(made.body, made.ctx);
	const [card] = byClass(made.body, 'synapse-voice-card');
	const [select] = byTag(card, 'select');
	const choose = (value: string): void => {
		select.value = value;
		select.dispatchEvent({ type: 'change' });
	};
	return { ...made, card, select, choose };
}

describe('renderVoiceSetting (#540)', () => {
	beforeEach(() => {
		Setting.instances.length = 0;
		setIcon.mockClear();
	});

	it('renders one card holding the Voice row, whose select offers every option and shows neutral by default', () => {
		const { body, card, select } = render();

		expect(body.children).toHaveLength(1);
		expect(Setting.instances.map((s) => s.name)).toEqual(['Voice']);
		expect(Setting.instances[0].setDesc).toHaveBeenCalledWith(VOICE_DESC);
		expect(walkEls(card)).toContain(Setting.instances[0].settingEl);
		expect(classesOf(select)).toContain('synapse-voice-select');
		expect((select.children as unknown as StubEl[]).map((o) => o.value)).toEqual(['neutral', 'match-note', 'first-person', 'custom']);
		expect(select.value).toBe('neutral');
		expect(byTag(card, 'textarea')).toHaveLength(0);
	});

	it('renders the custom panel inside the card and toggles the custom-state class in place', () => {
		const { body, card, choose, settings, saveSettings, rerender } = render();
		expect(classesOf(card)).not.toContain(CUSTOM_CARD_CLASS);

		choose('custom');
		expect(settings.ai.voice).toBe('custom');
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(classesOf(card)).toContain(CUSTOM_CARD_CLASS);
		const [panel] = byClass(card, 'synapse-voice-custom');
		expect(panel).toBeDefined();
		expect(byTag(panel, 'textarea')).toHaveLength(1);
		expect(body.children).toHaveLength(1);

		choose('match-note');
		expect(settings.ai.voice).toBe('match-note');
		expect(classesOf(card)).not.toContain(CUSTOM_CARD_CLASS);
		expect(byClass(card, 'synapse-voice-custom')).toHaveLength(0);
		expect(rerender).not.toHaveBeenCalled();
	});

	it('labels the custom panel and shows the blank-fallback hint with an info icon', () => {
		const { card } = render((s) => { s.ai.voice = 'custom'; });

		expect(byClass(card, 'synapse-voice-custom-label')[0].textContent).toBe(CUSTOM_LABEL);
		expect(byClass(card, 'synapse-voice-custom-label-hint')[0].textContent).toBe(CUSTOM_LABEL_HINT);
		expect(byTag(card, 'textarea')[0].getAttribute('placeholder')).toBe(CUSTOM_PLACEHOLDER);
		const [hint] = byClass(card, 'synapse-voice-custom-blank-hint');
		expect(walkEls(hint).map((e) => e.textContent)).toContain(CUSTOM_BLANK_HINT);
		const [icon] = byClass(hint, 'synapse-voice-custom-info-icon');
		expect(setIcon).toHaveBeenCalledWith(icon, 'info');
	});

	it('pre-fills the textarea, persists input, and updates the live char count', () => {
		const { card, settings, saveSettings } = render((s) => {
			s.ai.voice = 'custom';
			s.ai.voiceCustom = 'Be terse.';
		});
		const [textarea] = byTag(card, 'textarea');
		const [count] = byClass(card, 'synapse-voice-custom-count');
		expect(textarea.value).toBe('Be terse.');
		expect(count.textContent).toBe('9 chars');

		textarea.value = 'Write like a field guide.';
		textarea.dispatchEvent({ type: 'input' });
		expect(settings.ai.voiceCustom).toBe('Write like a field guide.');
		expect(count.textContent).toBe('25 chars');
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it('shows the Neutral-only note while neutral is selected and hides it otherwise', () => {
		const { card, choose } = render();
		const notes = (): StubEl[] => byClass(card, 'synapse-voice-neutral-note');
		expect(notes().map((n) => n.textContent)).toEqual([NEUTRAL_NOTE]);

		choose('first-person');
		expect(notes()).toHaveLength(0);

		choose('neutral');
		expect(notes()).toHaveLength(1);
	});

	it('repairs an unknown persisted voice to neutral', () => {
		const { settings, select } = render((s) => {
			s.ai.voice = 'pirate' as SynapseSettings['ai']['voice'];
		});
		expect(settings.ai.voice).toBe('neutral');
		expect(select.value).toBe('neutral');
	});
});
