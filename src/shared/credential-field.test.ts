import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Setting as ObsidianSetting } from 'obsidian';
import { Setting, ButtonComponent } from '../__mocks__/obsidian';
import { decorateCredentialField } from './credential-field';
import type { ValidationResult } from './credential-validator';
import { PROVIDER_METADATA } from './provider-metadata';

/** A mock `Setting`, typed as the real one so it satisfies the decorator's API. */
function makeSetting(): ObsidianSetting {
	return new Setting({} as never) as unknown as ObsidianSetting;
}

function findChild(setting: ObsidianSetting, predicate: (el: any) => boolean): any {
	return (setting.settingEl as any).children.find(predicate);
}
const chipEl = (setting: ObsidianSetting) =>
	findChild(setting, (el) => el.classList?.contains('synapse-credential-chip'));
const anchorEl = (setting: ObsidianSetting) => findChild(setting, (el) => el.tagName === 'A');

function testButton(): ButtonComponent {
	const btn = ButtonComponent.instances.find((b) => b.buttonText === 'Test');
	if (!btn) throw new Error('Test button not rendered');
	return btn;
}

function validatorReturning(result: ValidationResult) {
	return vi.fn(async () => Promise.resolve(result));
}

describe('decorateCredentialField', () => {
	beforeEach(() => {
		ButtonComponent.instances.length = 0;
	});

	it('renders a get-key anchor pointing at the provider console', () => {
		const setting = makeSetting();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-x' });
		const a = anchorEl(setting);
		expect(a).toBeDefined();
		expect(a.getAttribute('href')).toBe(PROVIDER_METADATA.openai.getKeyUrl);
		expect(a.getAttribute('target')).toBe('_blank');
	});

	it('omits the get-key anchor for keyless ollama', () => {
		const setting = makeSetting();
		decorateCredentialField({
			setting,
			provider: 'ollama',
			getKey: () => '',
			getEndpoint: () => 'http://localhost:11434',
		});
		expect(anchorEl(setting)).toBeUndefined();
	});

	it('starts with a neutral format-hint chip', () => {
		const setting = makeSetting();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => '' });
		const chip = chipEl(setting);
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
	});

	it('marks the row with a static class (no CSS :has() — avoids settings-DOM freeze)', () => {
		const setting = makeSetting();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-x' });
		expect((setting.settingEl as any).classList.contains('synapse-credential-row')).toBe(true);
	});

	it('shows a valid chip when the Test button reports valid', async () => {
		const setting = makeSetting();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'openai',
			message: 'Connected to OpenAI',
		});
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-good', validate });

		await testButton()._click();

		expect(validate).toHaveBeenCalledWith('openai', 'sk-good', { endpoint: undefined });
		const chip = chipEl(setting);
		expect(chip.textContent).toContain('Connected to OpenAI');
		expect(chip.classList.contains('is-valid')).toBe(true);
	});

	it('shows an invalid chip when the Test button reports invalid', async () => {
		const setting = makeSetting();
		const validate = validatorReturning({
			status: 'invalid',
			provider: 'openai',
			message: 'Invalid key',
		});
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-bad', validate });

		await testButton()._click();

		const chip = chipEl(setting);
		expect(chip.textContent).toContain('Invalid key');
		expect(chip.classList.contains('is-invalid')).toBe(true);
	});

	it('passes the live endpoint through for ollama', async () => {
		const setting = makeSetting();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'ollama',
			message: 'Ollama is reachable',
		});
		decorateCredentialField({
			setting,
			provider: 'ollama',
			getKey: () => '',
			getEndpoint: () => 'http://localhost:11434',
			validate,
		});

		await testButton()._click();

		expect(validate).toHaveBeenCalledWith('ollama', '', { endpoint: 'http://localhost:11434' });
	});

	it('reset() restores the neutral hint after a result', async () => {
		const setting = makeSetting();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'openai',
			message: 'Connected to OpenAI',
		});
		const handle = decorateCredentialField({
			setting,
			provider: 'openai',
			getKey: () => 'sk-good',
			validate,
		});

		await testButton()._click();
		expect(chipEl(setting).classList.contains('is-valid')).toBe(true);

		handle.reset();
		const chip = chipEl(setting);
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
		expect(chip.classList.contains('is-valid')).toBe(false);
	});
});
