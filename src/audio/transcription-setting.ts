import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';
import { GEMINI_MAX_INLINE_AUDIO_BYTES } from './transcriber';
import { decodeTranscriptionChoice, encodeTranscriptionChoice, transcriptionChoiceOptions } from './transcription-models';

/** The "Transcription" row of the per-feature model list: one provider · model dropdown. */
export function renderTranscriptionSetting(parent: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const { audio } = plugin.settings;
	const options = transcriptionChoiceOptions();
	const setting = new Setting(parent)
		.setName('Transcription')
		.setDesc('Speech-to-text for audio and video.')
		.addDropdown((dd) => {
			dd.addOptions(options);
			const current = encodeTranscriptionChoice(audio.transcriptionProvider, audio.transcriptionModel);
			dd.setValue(current in options ? current : Object.keys(options)[0]);
			dd.onChange(async (value) => {
				const choice = decodeTranscriptionChoice(value);
				if (!choice) return;
				plugin.settings.audio.transcriptionProvider = choice.provider;
				plugin.settings.audio.transcriptionModel = choice.model;
				await plugin.saveSettings();
				ctx.rerender();
			});
		});
	if (audio.transcriptionProvider === 'gemini') {
		const limitMb = GEMINI_MAX_INLINE_AUDIO_BYTES / (1024 * 1024);
		setting.setDesc(
			`Speech-to-text for audio and video. Gemini sends audio inline, so files are limited to ${limitMb} MB; ` +
			'use OpenAI or Deepgram for larger files. Gemini transcribes with an LLM, so spoken instructions ' +
			'inside untrusted audio could still influence the transcript.'
		);
	}
}
