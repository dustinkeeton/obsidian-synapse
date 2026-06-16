import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared/settings-section';
import { GEMINI_MAX_INLINE_AUDIO_BYTES } from './transcriber';

/**
 * Transcription provider options shown in the dropdown.
 *
 * 'local-whisper' is intentionally hidden from the dropdown until implemented
 * (see src/audio/transcriber.ts). The type is kept for forward compatibility.
 */
const providerOptions: Record<string, string> = {
	'whisper-api': 'OpenAI Whisper API',
	deepgram: 'Deepgram',
	gemini: 'Google Gemini',
};

/**
 * Render the transcription provider dropdown and its provider-specific API-key
 * fields (#332). These controls live in the AI Configuration section but write
 * to `settings.audio.*`, since they configure the audio transcription backend.
 *
 * The transcription provider dropdown and AI provider together decide which
 * API-key fields are shown, so changing either provider triggers a full
 * re-render via {@link SettingsSectionContext.rerender}. (The AI provider
 * dropdown re-renders the whole tab, and `rerender` is that same `display()`.)
 *
 * Rendered into the passed `body` element, not `ctx.containerEl`.
 */
export function renderTranscriptionCredentials(body: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const providerSetting = new Setting(body)
		.setName('Transcription provider')
		.addDropdown((dd) =>
			dd
				.addOptions(providerOptions)
				.setValue(plugin.settings.audio.transcriptionProvider)
				.onChange(async (value) => {
					plugin.settings.audio.transcriptionProvider =
						value as 'whisper-api' | 'deepgram' | 'gemini' | 'local-whisper';
					await plugin.saveSettings();
					ctx.rerender(); // Re-render to show/hide provider-specific fields
				})
		);
	if (plugin.settings.audio.transcriptionProvider === 'gemini') {
		const limitMb = GEMINI_MAX_INLINE_AUDIO_BYTES / (1024 * 1024);
		providerSetting.setDesc(
			`Gemini sends audio inline with the request, so files are limited to ${limitMb} MB ` +
			'(the API caps requests at 20 MB). Use Whisper or Deepgram for larger files. ' +
			'Note: Gemini transcribes with an LLM, so spoken instructions inside untrusted ' +
			'audio could still influence the transcript — review output before trusting it.'
		);
	}

	// Show Whisper API key field when provider is whisper-api and AI provider isn't OpenAI
	// (if AI provider is OpenAI, the shared API key is already an OpenAI key)
	if (
		plugin.settings.audio.transcriptionProvider === 'whisper-api' &&
		plugin.settings.ai.provider !== 'openai'
	) {
		new Setting(body)
			.setName('OpenAI API key (Whisper)')
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

	// Show Gemini API key field when provider is gemini and AI provider isn't Gemini
	// (if AI provider is Gemini, the shared API key is already a Google key)
	if (
		plugin.settings.audio.transcriptionProvider === 'gemini' &&
		plugin.settings.ai.provider !== 'gemini'
	) {
		new Setting(body)
			.setName('Google Gemini API key')
			.setDesc(
				'Gemini transcription uses the Google AI API. Provide your Gemini key here since your AI provider is set to ' +
				plugin.settings.ai.provider.charAt(0).toUpperCase() +
				plugin.settings.ai.provider.slice(1) + '.'
			)
			.addText((text) => {
				text
					.setPlaceholder('AIza...')
					.setValue(plugin.settings.audio.geminiApiKey)
					.onChange(async (value) => {
						plugin.settings.audio.geminiApiKey = value;
						await plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
	}

	if (plugin.settings.audio.transcriptionProvider === 'deepgram') {
		new Setting(body)
			.setName('Deepgram API key')
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
}
