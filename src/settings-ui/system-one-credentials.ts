import { Setting } from 'obsidian';
import { SYSTEM_ONE_MODEL_OPTIONS } from '../settings';
import { PROVIDER_METADATA, addEnhancedSlider, decorateCredentialField } from '../shared';
import type { CredentialFieldHandle, SettingsSectionContext } from '../shared';

/** System 1 decision lane rows (#558) inside the AI configuration section; writes `settings.ai.systemOne`. */
export function renderSystemOneCredentials(body: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const systemOne = plugin.settings.ai.systemOne;

	new Setting(body)
		.setName('System 1 decisions')
		.setDesc(
			'Route tag, folder, and link classification through TypeSafe Jev, a typed decision model ' +
			'with calibrated confidence, and fall back to the AI provider above only when it is unsure. ' +
			'Note text is sent to TypeSafe; exclusions still apply.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(systemOne.enabled)
				.onChange(async (value) => {
					plugin.settings.ai.systemOne.enabled = value;
					await plugin.saveSettings();
					ctx.rerender();
				})
		);

	if (!systemOne.enabled) return;

	let handle: CredentialFieldHandle | undefined;
	const keySetting = new Setting(body)
		.setName('TypeSafe API key')
		.setDesc('Required for System 1 decisions')
		.addText((text) => {
			text
				.setPlaceholder(PROVIDER_METADATA.typesafe.placeholder)
				.setValue(systemOne.apiKey)
				.onChange(async (value) => {
					plugin.settings.ai.systemOne.apiKey = value;
					await plugin.saveSettings();
					handle?.reset();
				});
			text.inputEl.type = 'password';
			text.inputEl.autocomplete = 'off';
		});
	handle = decorateCredentialField({
		setting: keySetting,
		provider: 'typesafe',
		getKey: () => plugin.settings.ai.systemOne.apiKey,
	});

	if (!(systemOne.model in SYSTEM_ONE_MODEL_OPTIONS)) {
		plugin.settings.ai.systemOne.model = Object.keys(SYSTEM_ONE_MODEL_OPTIONS)[0];
	}
	new Setting(body)
		.setName('Decision model')
		.setDesc('Jev model used for System 1 decisions')
		.addDropdown((dd) => {
			dd.addOptions(SYSTEM_ONE_MODEL_OPTIONS);
			dd.setValue(plugin.settings.ai.systemOne.model);
			dd.onChange(async (value) => {
				plugin.settings.ai.systemOne.model = value;
				await plugin.saveSettings();
			});
		});

	addEnhancedSlider(
		new Setting(body)
			.setName('Confidence floor')
			.setDesc(
				'Act on a System 1 answer at or above this confidence; below it the AI provider decides. ' +
				'Organize and REM use their own thresholds.'
			),
		{
			min: 0.5,
			max: 0.95,
			step: 0.05,
			value: systemOne.confidenceFloor,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.ai.systemOne.confidenceFloor = value;
				await plugin.saveSettings();
			},
		},
	);
}
