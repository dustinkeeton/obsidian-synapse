import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared/settings-section';
import { PROVIDER_METADATA, decorateCredentialField } from '../shared';
import type { CredentialProvider, CredentialFieldHandle } from '../shared';
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

	/**
	 * Render a provider-specific transcription key field with a per-provider
	 * placeholder plus the guided "Get a key"/"Test"/status-chip affordances
	 * (#335). The chip resets on edit so a stale ✓/✗ never lingers.
	 */
	const addKeyField = (
		name: string,
		desc: string,
		provider: CredentialProvider,
		read: () => string,
		write: (value: string) => void,
	): void => {
		let handle: CredentialFieldHandle | undefined;
		const setting = new Setting(body)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text
					.setPlaceholder(PROVIDER_METADATA[provider].placeholder)
					.setValue(read())
					.onChange(async (value) => {
						write(value);
						await plugin.saveSettings();
						handle?.reset();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
		handle = decorateCredentialField({ setting, container: body, provider, getKey: read });
	};

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
		addKeyField(
			'OpenAI API key (Whisper)',
			'Whisper uses the OpenAI API. Provide your OpenAI key here since your AI provider is set to ' +
				plugin.settings.ai.provider.charAt(0).toUpperCase() +
				plugin.settings.ai.provider.slice(1) + '.',
			'openai',
			() => plugin.settings.audio.whisperApiKey,
			(value) => { plugin.settings.audio.whisperApiKey = value; },
		);
	}

	// Show Gemini API key field when provider is gemini and AI provider isn't Gemini
	// (if AI provider is Gemini, the shared API key is already a Google key)
	if (
		plugin.settings.audio.transcriptionProvider === 'gemini' &&
		plugin.settings.ai.provider !== 'gemini'
	) {
		addKeyField(
			'Google Gemini API key',
			'Gemini transcription uses the Google AI API. Provide your Gemini key here since your AI provider is set to ' +
				plugin.settings.ai.provider.charAt(0).toUpperCase() +
				plugin.settings.ai.provider.slice(1) + '.',
			'gemini',
			() => plugin.settings.audio.geminiApiKey,
			(value) => { plugin.settings.audio.geminiApiKey = value; },
		);
	}

	if (plugin.settings.audio.transcriptionProvider === 'deepgram') {
		addKeyField(
			'Deepgram API key',
			'Required for Deepgram transcription provider',
			'deepgram',
			() => plugin.settings.audio.deepgramApiKey,
			(value) => { plugin.settings.audio.deepgramApiKey = value; },
		);
	}
}
