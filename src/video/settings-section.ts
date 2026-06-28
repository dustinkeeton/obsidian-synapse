import { Setting, setIcon } from 'obsidian';
import type { SettingsSectionContext, NotificationManager } from '../shared';

/** A single copy-able install command shown in a path setting's help panel (#382/#383). */
interface InstallCommand {
	/** Short OS label shown left of the command. */
	os: string;
	/** The exact shell command to copy. */
	cmd: string;
}

/**
 * Per-OS install commands surfaced under the `yt-dlp path` setting's `?` help
 * panel (#382). Each "or" alternate is its own row so it gets its own copy
 * button (#383). The "download the binary" fallback was dropped — anyone able
 * to do that doesn't need this panel.
 */
const YT_DLP_INSTALL: InstallCommand[] = [
	{ os: 'macOS', cmd: 'brew install yt-dlp' },
	{ os: 'Linux', cmd: 'sudo apt install yt-dlp' },
	{ os: 'Linux', cmd: 'pipx install yt-dlp' },
	{ os: 'Windows', cmd: 'winget install yt-dlp' },
	{ os: 'Windows', cmd: 'choco install yt-dlp' },
];

/** Per-OS install commands for the `ffmpeg path` setting's `?` help panel (#382/#383). */
const FFMPEG_INSTALL: InstallCommand[] = [
	{ os: 'macOS', cmd: 'brew install ffmpeg' },
	{ os: 'Linux', cmd: 'sudo apt install ffmpeg' },
	{ os: 'Windows', cmd: 'winget install ffmpeg' },
	{ os: 'Windows', cmd: 'choco install ffmpeg' },
];

/** How long the copy button shows its checkmark confirmation before reverting. */
const COPY_CONFIRM_MS = 1200;

/**
 * Build the (initially hidden) install-help panel for a binary: a small heading
 * plus one left-aligned, code-styled command row per {@link InstallCommand},
 * each with a right-aligned one-click copy button (#383). The panel is toggled
 * open by the path setting's `?` help button.
 *
 * Built from raw `createEl` DOM (mirrors {@link renderFeatureChipSelect}) so the
 * structure stays unit-testable under the Obsidian mock.
 *
 * @returns The panel element (caller wires the `?` button to toggle `is-open`).
 */
function buildInstallHelpPanel(
	body: HTMLElement,
	heading: string,
	commands: InstallCommand[],
	notifications: NotificationManager,
): HTMLElement {
	const panel = body.createDiv({ cls: 'synapse-install-help' });
	panel.createDiv({ cls: 'synapse-install-help-heading', text: heading });

	for (const { os, cmd } of commands) {
		const row = panel.createDiv({ cls: 'synapse-install-row' });
		row.createSpan({ cls: 'synapse-install-os', text: os });
		// <code> for terminal-command styling; selectable for manual copy too.
		row.createEl('code', { cls: 'synapse-install-cmd', text: cmd });

		const copyBtn = row.createEl('button', {
			cls: 'synapse-install-copy',
			attr: { type: 'button', 'aria-label': `Copy: ${cmd}` },
		});
		setIcon(copyBtn, 'copy');
		copyBtn.addEventListener('click', () => {
			navigator.clipboard
				.writeText(cmd)
				.then(() => {
					// In-place confirmation: swap to a checkmark, then revert.
					copyBtn.addClass('is-copied');
					setIcon(copyBtn, 'check');
					copyBtn.setAttribute('aria-label', 'Copied!');
					window.setTimeout(() => {
						copyBtn.removeClass('is-copied');
						setIcon(copyBtn, 'copy');
						copyBtn.setAttribute('aria-label', `Copy: ${cmd}`);
					}, COPY_CONFIRM_MS);
				})
				.catch((err) => {
					console.error('[Synapse] Could not copy install command:', err);
					notifications.info("Couldn't copy to clipboard");
				});
		});
	}

	return panel;
}

/** Options for {@link addPathSetting}. */
interface PathSettingOptions {
	name: string;
	desc: string;
	/** Heading shown atop the install-help panel. */
	heading: string;
	commands: InstallCommand[];
	get: () => string;
	set: (value: string) => void;
	save: () => Promise<void>;
}

/**
 * Render a binary-path text setting plus its collapsible per-OS install-help
 * panel. The `?` help button toggles the panel open/closed (#382/#383); the
 * panel is created as the row's sibling so it expands directly beneath the field.
 */
function addPathSetting(
	body: HTMLElement,
	opts: PathSettingOptions,
	notifications: NotificationManager,
): void {
	let panel: HTMLElement;
	let open = false;

	new Setting(body)
		.setName(opts.name)
		.setDesc(opts.desc)
		.addExtraButton((btn) =>
			btn
				.setIcon('help-circle')
				.setTooltip('Show install commands')
				.onClick(() => {
					open = !open;
					panel.toggleClass('is-open', open);
					btn.setTooltip(open ? 'Hide install commands' : 'Show install commands');
				}),
		)
		.addText((text) =>
			text.setValue(opts.get()).onChange(async (value) => {
				opts.set(value);
				await opts.save();
			}),
		);

	// Sibling after the row so it expands beneath the field (closure above
	// references it; the `?` handler only runs after this assignment).
	panel = buildInstallHelpPanel(body, opts.heading, opts.commands, notifications);
}

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

	addPathSetting(videoBody, {
		name: 'yt-dlp path',
		desc: 'Path to yt-dlp binary (or leave as "yt-dlp" to use your PATH)',
		heading: 'Install yt-dlp',
		commands: YT_DLP_INSTALL,
		get: () => plugin.settings.video.ytDlpPath,
		set: (value) => { plugin.settings.video.ytDlpPath = value; },
		save: () => plugin.saveSettings(),
	}, plugin.notifications);

	addPathSetting(videoBody, {
		name: 'ffmpeg path',
		desc: 'Path to ffmpeg binary (or leave as "ffmpeg" to use your PATH)',
		heading: 'Install ffmpeg (includes ffprobe)',
		commands: FFMPEG_INSTALL,
		get: () => plugin.settings.video.ffmpegPath,
		set: (value) => { plugin.settings.video.ffmpegPath = value; },
		save: () => plugin.saveSettings(),
	}, plugin.notifications);

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
