import { Setting } from 'obsidian';
import { VOICE_OPTIONS } from '../shared';
import type { SettingsSectionContext, VoiceMode } from '../shared';

/** Voice dropdown (#540) inside the AI configuration section; writes `settings.ai.voice` / `voiceCustom`. */
export function renderVoiceSetting(body: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const row = new Setting(body)
		.setName('Voice')
		.setDesc(
			'How elaboration, deep dive, and summaries write. Neutral never writes as you; ' +
			'quoted or transcribed material always keeps its original wording.'
		);

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

	const customEl = body.createDiv({ cls: 'synapse-voice-custom' });

	const renderCustom = (): void => {
		customEl.empty();
		if (plugin.settings.ai.voice !== 'custom') return;
		customEl.createDiv({
			cls: 'setting-item-description',
			text: 'Custom voice instruction, added to the prompt as written. Leave blank to use neutral.',
		});
		const textarea = customEl.createEl('textarea', {
			cls: 'synapse-voice-custom-input',
			attr: { rows: 3, 'aria-label': 'Custom voice instruction', placeholder: 'Write in a warm, second-person voice.' },
		});
		textarea.value = plugin.settings.ai.voiceCustom;
		textarea.addEventListener('input', () => {
			plugin.settings.ai.voiceCustom = textarea.value;
			void plugin.saveSettings();
		});
	};

	select.addEventListener('change', () => {
		plugin.settings.ai.voice = select.value as VoiceMode;
		void plugin.saveSettings();
		renderCustom();
	});

	renderCustom();
}
