import { Setting, setIcon } from 'obsidian';
import { VOICE_OPTIONS } from '../shared';
import type { SettingsSectionContext, VoiceMode } from '../shared';

export const VOICE_DESC =
	'How elaborations, deep dives and summaries are written. Quotes and transcriptions always keep their original wording.';
export const NEUTRAL_NOTE = 'Neutral never writes as you.';
export const CUSTOM_LABEL = 'Custom instruction';
export const CUSTOM_LABEL_HINT = 'Added to the prompt exactly as written';
export const CUSTOM_PLACEHOLDER = 'e.g. Write in a warm, second-person voice.';
export const CUSTOM_BLANK_HINT = 'Left blank, Synapse falls back to Neutral.';
export const CUSTOM_CARD_CLASS = 'synapse-voice-card--custom';

const charCount = (text: string): string => `${text.length} chars`;

/** Voice card (#540) inside the AI configuration section; writes `settings.ai.voice` / `voiceCustom`. */
export function renderVoiceSetting(body: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const card = body.createDiv({ cls: 'synapse-voice-card' });

	const row = new Setting(card).setName('Voice').setDesc(VOICE_DESC);
	row.settingEl.addClass('synapse-voice-row');

	const select = row.controlEl.createEl('select', {
		cls: 'dropdown synapse-voice-select',
		attr: { 'aria-label': 'Voice' },
	});
	for (const [value, label] of Object.entries(VOICE_OPTIONS)) {
		select.createEl('option', { text: label }).value = value;
	}
	if (!(plugin.settings.ai.voice in VOICE_OPTIONS)) {
		plugin.settings.ai.voice = 'neutral';
	}
	select.value = plugin.settings.ai.voice;

	const neutralSlot = card.createDiv({ cls: 'synapse-voice-neutral-slot' });
	const customSlot = card.createDiv({ cls: 'synapse-voice-custom-slot' });

	const renderNeutralNote = (): void => {
		neutralSlot.empty();
		if (plugin.settings.ai.voice !== 'neutral') return;
		neutralSlot.createDiv({ cls: 'setting-item-description synapse-voice-neutral-note', text: NEUTRAL_NOTE });
	};

	const renderCustomPanel = (): void => {
		customSlot.empty();
		const isCustom = plugin.settings.ai.voice === 'custom';
		card.toggleClass(CUSTOM_CARD_CLASS, isCustom);
		if (!isCustom) return;

		const panel = customSlot.createDiv({ cls: 'synapse-voice-custom' });
		const labelRow = panel.createDiv({ cls: 'synapse-voice-custom-label-row' });
		labelRow.createSpan({ cls: 'synapse-voice-custom-label', text: CUSTOM_LABEL });
		labelRow.createSpan({ cls: 'synapse-voice-custom-label-hint', text: CUSTOM_LABEL_HINT });

		const textarea = panel.createEl('textarea', {
			cls: 'synapse-voice-custom-input',
			attr: { rows: 4, 'aria-label': CUSTOM_LABEL, placeholder: CUSTOM_PLACEHOLDER },
		});
		textarea.value = plugin.settings.ai.voiceCustom;

		const helper = panel.createDiv({ cls: 'synapse-voice-custom-helper' });
		const blankHint = helper.createDiv({ cls: 'synapse-voice-custom-blank-hint' });
		setIcon(blankHint.createSpan({ cls: 'synapse-voice-custom-info-icon' }), 'info');
		blankHint.createSpan({ text: CUSTOM_BLANK_HINT });
		const count = helper.createSpan({ cls: 'synapse-voice-custom-count', text: charCount(textarea.value) });

		textarea.addEventListener('input', () => {
			plugin.settings.ai.voiceCustom = textarea.value;
			count.setText(charCount(textarea.value));
			void plugin.saveSettings();
		});
	};

	select.addEventListener('change', () => {
		plugin.settings.ai.voice = select.value as VoiceMode;
		void plugin.saveSettings();
		renderNeutralNote();
		renderCustomPanel();
	});

	renderNeutralNote();
	renderCustomPanel();
}
