import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Intake Folder settings accordion (#243).
 */
export function renderIntakeSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const intakeBody = ctx.featureSection(
		'intake',
		'Intake folder',
		() => plugin.settings.intake.enabled,
		(v) => { plugin.settings.intake.enabled = v; },
		'Watch the intake folder and run enabled Synapse features on new notes',
	);

	new Setting(intakeBody)
		.setName('Settle window (seconds)')
		.setDesc(
			'Wait this long after the last change to a note before processing it. ' +
			'The timer resets on every edit, so active typing or chunked sync keeps ' +
			'deferring — processing fires only once the note has been quiet for the ' +
			'full window. Raise it if notes are still arriving when they get processed.'
		)
		.addText((text) =>
			text
				.setValue(String(plugin.settings.intake.settleSeconds))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.intake.settleSeconds = num;
						await plugin.saveSettings();
					}
				})
		);

	new Setting(intakeBody)
		.setName('Intake folder')
		.setDesc('Folder to watch for new notes. See docs/intake-folder.md for the mobile capture workflow.')
		.addText((text) =>
			text
				.setPlaceholder('Inbox')
				.setValue(plugin.settings.intake.intakeFolder)
				.onChange(async (value) => {
					plugin.settings.intake.intakeFolder = value;
					await plugin.saveSettings();
				})
		);

	new Setting(intakeBody)
		.setName('Adopt shared captures')
		.setDesc(
			'Also watch newly created notes at the vault ROOT and move any whose ' +
			'body is a single video/audio/article link into the intake folder. ' +
			'Catches captures from the mobile share sheet when "Default location ' +
			'for new notes" is not the intake folder. Off by default because it ' +
			'relocates root notes.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.intake.adoptSharedCaptures)
				.onChange(async (value) => {
					plugin.settings.intake.adoptSharedCaptures = value;
					await plugin.saveSettings();
				})
		);

	new Setting(intakeBody)
		.setName('Mark processed in frontmatter')
		.setDesc('Stamp `synapse-processed: true` on a note once handled so it is not reprocessed')
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.intake.markProcessed)
				.onChange(async (value) => {
					plugin.settings.intake.markProcessed = value;
					await plugin.saveSettings();
				})
		);

	new Setting(intakeBody)
		.setName('Move when done (fallback)')
		.setDesc(
			'Fallback destination used only when auto-organize keeps a note in ' +
			'the intake folder (e.g. low confidence). Notes organize relocates ' +
			'are left where it put them. Leave blank to keep unorganized notes ' +
			'in the intake folder.'
		)
		.addText((text) =>
			text
				.setPlaceholder('')
				.setValue(plugin.settings.intake.moveWhenDone ?? '')
				.onChange(async (value) => {
					const trimmed = value.trim();
					plugin.settings.intake.moveWhenDone = trimmed === '' ? undefined : trimmed;
					await plugin.saveSettings();
				})
		);

	new Setting(intakeBody)
		.setName('Capture log')
		.setDesc(
			'When a note is auto-organized out of the intake folder, leave a ' +
			'dated breadcrumb linking to its new home in the capture-log subfolder.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.intake.captureLog)
				.onChange(async (value) => {
					plugin.settings.intake.captureLog = value;
					await plugin.saveSettings();
				})
		);

	new Setting(intakeBody)
		.setName('Capture log folder')
		.setDesc(
			'Subfolder of the intake folder for breadcrumbs (relative to it). ' +
			'This subfolder is ignored by the watcher so breadcrumbs are never reprocessed.'
		)
		.addText((text) =>
			text
				.setPlaceholder('_captured')
				.setValue(plugin.settings.intake.captureLogFolder)
				.onChange(async (value) => {
					const trimmed = value.trim();
					if (trimmed.length > 0) {
						plugin.settings.intake.captureLogFolder = trimmed;
						await plugin.saveSettings();
					}
				})
		);
}
