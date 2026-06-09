import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Audio Transcription settings accordion (#243).
 *
 * The transcription provider dropdown and AI provider together decide which
 * API-key fields are shown, so changing the provider triggers a full re-render
 * via {@link SettingsSectionContext.rerender}.
 */
export function renderAudioSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const audioBody = ctx.featureSection(
		'audio',
		'Audio Transcription',
		() => plugin.settings.audio.enabled,
		(v) => { plugin.settings.audio.enabled = v; },
		'Enable audio transcription',
	);

	const providerOptions: Record<string, string> = {
		'whisper-api': 'OpenAI Whisper API',
		deepgram: 'Deepgram',
	};
	// 'local-whisper' is intentionally hidden from the dropdown until implemented
	// (see src/audio/transcriber.ts). The type is kept for forward compatibility.

	new Setting(audioBody)
		.setName('Transcription provider')
		.addDropdown((dd) =>
			dd
				.addOptions(providerOptions)
				.setValue(plugin.settings.audio.transcriptionProvider)
				.onChange(async (value) => {
					plugin.settings.audio.transcriptionProvider =
						value as 'whisper-api' | 'deepgram' | 'local-whisper';
					await plugin.saveSettings();
					ctx.rerender(); // Re-render to show/hide provider-specific fields
				})
		);

	// Show Whisper API key field when provider is whisper-api and AI provider isn't OpenAI
	// (if AI provider is OpenAI, the shared API key is already an OpenAI key)
	if (
		plugin.settings.audio.transcriptionProvider === 'whisper-api' &&
		plugin.settings.ai.provider !== 'openai'
	) {
		new Setting(audioBody)
			.setName('OpenAI API Key (Whisper)')
			.setDesc(
				'Whisper uses the OpenAI API. Provide your OpenAI key here since your AI provider is set to ' +
				plugin.settings.ai.provider.charAt(0).toUpperCase() +
				plugin.settings.ai.provider.slice(1) + '.'
			)
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(plugin.settings.audio.whisperApiKey)
					.onChange(async (value) => {
						plugin.settings.audio.whisperApiKey = value;
						await plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
	}

	if (plugin.settings.audio.transcriptionProvider === 'deepgram') {
		new Setting(audioBody)
			.setName('Deepgram API Key')
			.setDesc('Required for Deepgram transcription provider')
			.addText((text) => {
				text
					.setPlaceholder('dg-...')
					.setValue(plugin.settings.audio.deepgramApiKey)
					.onChange(async (value) => {
						plugin.settings.audio.deepgramApiKey = value;
						await plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
	}

	new Setting(audioBody)
		.setName('Language')
		.setDesc('Audio language for transcription (auto-detect if empty)')
		.addDropdown((dd) =>
			dd
				.addOptions({
					'': 'Auto-detect',
					en: 'English',
					es: 'Spanish',
					fr: 'French',
					de: 'German',
					ja: 'Japanese',
					zh: 'Chinese',
					ko: 'Korean',
					pt: 'Portuguese',
					ru: 'Russian',
					ar: 'Arabic',
					hi: 'Hindi',
					it: 'Italian',
					nl: 'Dutch',
					pl: 'Polish',
					sv: 'Swedish',
					tr: 'Turkish',
				})
				.setValue(plugin.settings.audio.language)
				.onChange(async (value) => {
					plugin.settings.audio.language = value;
					await plugin.saveSettings();
				})
		);

	new Setting(audioBody)
		.setName('Post-processing')
		.setDesc('Clean up and structure transcriptions with AI')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.audio.postProcessing.enabled)
				.onChange(async (value) => {
					plugin.settings.audio.postProcessing.enabled = value;
					await plugin.saveSettings();
				})
		);

	new Setting(audioBody)
		.setName('Remove filler words')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.audio.postProcessing.removeFiller)
				.onChange(async (value) => {
					plugin.settings.audio.postProcessing.removeFiller = value;
					await plugin.saveSettings();
				})
		);
}
