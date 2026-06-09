import { Setting } from 'obsidian';
import type { SettingsSectionContext } from '../shared';

/**
 * Render the Image settings accordion (#243).
 */
export function renderImageSettings(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;

	const imageBody = ctx.featureSection(
		'image',
		'Image',
		() => plugin.settings.image.enabled,
		(v) => { plugin.settings.image.enabled = v; },
		'Run OCR and image analysis on images referenced in notes',
	);

	new Setting(imageBody)
		.setName('Max image size (MB)')
		.setDesc(
			'Images whose base64 payload exceeds this size are automatically downscaled ' +
			'before being sent to the API. The Anthropic API limit is 5 MB; lower this only ' +
			'if your provider enforces a smaller limit.'
		)
		.addText((text) =>
			text
				.setPlaceholder('5')
				.setValue(String(plugin.settings.image.maxImageSizeMb))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.image.maxImageSizeMb = num;
						await plugin.saveSettings();
					}
				})
		);
}
