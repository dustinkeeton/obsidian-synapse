import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Per-OS install hint surfaced on the yt-dlp path setting's `?` help button (the
 * `?`-circle icon's tooltip, #382). Covers macOS, Linux, and Windows plus the
 * "download the binary and set its full path" escape hatch for systems without a
 * package manager.
 */
const YT_DLP_INSTALL_HELP =
	'Install yt-dlp:\n' +
	'• macOS: brew install yt-dlp\n' +
	'• Linux: sudo apt install yt-dlp  (or: pipx install yt-dlp)\n' +
	'• Windows: winget install yt-dlp  (or: choco install yt-dlp)\n' +
	'Or download the binary and set its full path here.';

/** Per-OS install hint for the ffmpeg path setting's `?` help button (#382). */
const FFMPEG_INSTALL_HELP =
	'Install ffmpeg (includes ffprobe):\n' +
	'• macOS: brew install ffmpeg\n' +
	'• Linux: sudo apt install ffmpeg\n' +
	'• Windows: winget install ffmpeg  (or: choco install ffmpeg)\n' +
	'Or download the binary and set its full path here.';

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
		.setDesc('Path to yt-dlp binary (or leave as "yt-dlp" to use your PATH)')
		.addExtraButton((btn) =>
			btn
				.setIcon('help-circle')
				.setTooltip(YT_DLP_INSTALL_HELP)
		)
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
		.setDesc('Path to ffmpeg binary (or leave as "ffmpeg" to use your PATH)')
		.addExtraButton((btn) =>
			btn
				.setIcon('help-circle')
				.setTooltip(FFMPEG_INSTALL_HELP)
		)
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
