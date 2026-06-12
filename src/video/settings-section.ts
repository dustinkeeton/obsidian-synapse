import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Video Transcription settings accordion (#243).
 *
 * NOTE: This feature is desktop-only (requires yt-dlp + ffmpeg). The
 * `Platform.isDesktop` gate lives in the orchestrator (`settings-tab.ts`),
 * which only invokes this renderer on desktop — keep it that way.
 */
export function renderVideoSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const videoBody = ctx.featureSection(
		'video',
		'Video transcription',
		() => plugin.settings.video.enabled,
		(v) => { plugin.settings.video.enabled = v; },
		'Enable video transcription',
	);

	new Setting(videoBody)
		.setName('yt-dlp path')
		.setDesc('Path to yt-dlp binary')
		.addText((text) =>
			text
				.setValue(plugin.settings.video.ytDlpPath)
				.onChange(async (value) => {
					plugin.settings.video.ytDlpPath = value;
					await plugin.saveSettings();
				})
		);

	new Setting(videoBody)
		.setName('ffmpeg path')
		.setDesc('Path to ffmpeg binary')
		.addText((text) =>
			text
				.setValue(plugin.settings.video.ffmpegPath)
				.onChange(async (value) => {
					plugin.settings.video.ffmpegPath = value;
					await plugin.saveSettings();
				})
		);

	new Setting(videoBody)
		.setName('Video download folder')
		.setDesc('Where to save downloaded video files in the vault')
		.addText((text) =>
			text
				.setValue(plugin.settings.video.downloadFolder)
				.onChange(async (value) => {
					plugin.settings.video.downloadFolder = value;
					await plugin.saveSettings();
				})
		);

	new Setting(videoBody)
		.setName('Embed video in note')
		.setDesc('Add an embed link to the downloaded video file in the note')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.video.embedInNote)
				.onChange(async (value) => {
					plugin.settings.video.embedInNote = value;
					await plugin.saveSettings();
				})
		);
}
