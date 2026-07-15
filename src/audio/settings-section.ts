import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Audio Transcription settings accordion (#243).
 *
 * The transcription provider dropdown and its provider-specific API-key fields
 * live in the AI Configuration section (#332, see
 * {@link renderTranscriptionCredentials}); this section owns the remaining
 * audio settings (language, lyrics formatting, post-processing).
 */
export function renderAudioSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const audioBody = ctx.featureSection(
		'audio',
		'Audio transcription',
		() => plugin.settings.audio.enabled,
		(v) => { plugin.settings.audio.enabled = v; },
		'Enable audio transcription',
	);

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
		.setName('Auto-format song lyrics')
		.setDesc(
			'Detect transcripts that are song lyrics and format them into verse/chorus ' +
			'sections (preserving every line) instead of leaving them as prose. Makes one ' +
			'extra AI call when a song is detected.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.audio.autoFormatLyrics)
				.onChange(async (value) => {
					plugin.settings.audio.autoFormatLyrics = value;
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
		.setDesc(
			'Strip "um", "uh", and false starts during post-processing. Best for ' +
			'voice memos — it rewords quoted speech, so leave it off for ' +
			'interviews, talks, and video transcripts you want verbatim.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.audio.postProcessing.removeFiller)
				.onChange(async (value) => {
					plugin.settings.audio.postProcessing.removeFiller = value;
					await plugin.saveSettings();
				})
		);
}
