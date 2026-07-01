import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Setting as ObsidianSetting } from 'obsidian';
import { Setting, ButtonComponent, createEl, type StubEl } from '../__mocks__/obsidian';
import { decorateCredentialField } from './credential-field';
import type { ValidationResult } from './credential-validator';
import { PROVIDER_METADATA } from './provider-metadata';

/**
 * Build a mock Setting row + a section-body container. The link + chip now render
 * INSIDE the row's own `.setting-item` (`setting.settingEl`), on their own line —
 * so tests inspect the setting row, not the container. The `{}` passed to the mock
 * `Setting` has no `createDiv`, so `settingEl` is an orphan stub the tests inspect
 * directly. The Setting is typed as the real one so it satisfies the decorator API.
 */
function makeCtx() {
	const setting = new Setting({}) as unknown as ObsidianSetting;
	const container = createEl();
	return { setting, container };
}

const extrasEl = (setting: ObsidianSetting): StubEl | undefined =>
	(setting.settingEl.children as unknown as StubEl[]).find((el) =>
		el.classList.contains('synapse-credential-extras'),
	);
const chipEl = (setting: ObsidianSetting): StubEl | undefined =>
	(extrasEl(setting)?.children as unknown as StubEl[] | undefined)?.find((el) =>
		el.classList.contains('synapse-credential-chip'),
	);
const anchorEl = (setting: ObsidianSetting): StubEl | undefined =>
	(extrasEl(setting)?.children as unknown as StubEl[] | undefined)?.find(
		(el) => el.tagName === 'A',
	);

function testButton(): ButtonComponent {
	const btn = ButtonComponent.instances.find((b) => b.buttonText === 'Test');
	if (!btn) throw new Error('Test button not rendered');
	return btn;
}

function validatorReturning(result: ValidationResult) {
	return vi.fn(async () => Promise.resolve(result));
}

/**
 * Let validation settle AND the deferred UI update run. The Test onClick applies
 * the result on a macrotask (`setTimeout`, not the resolved-promise microtask —
 * that form hard-freezes Obsidian; see #335), so we wait two macrotask ticks: one
 * for `validate()` to resolve, one for the deferred chip update.
 */
const flush = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('decorateCredentialField', () => {
	beforeEach(() => {
		ButtonComponent.instances.length = 0;
	});

	it('renders the link + chip as a block inside the setting row, not the container', () => {
		const { setting, container } = makeCtx();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-x' });
		// The extras block now lives inside the setting row's own `.setting-item`…
		expect(extrasEl(setting)).toBeDefined();
		// …and the host row is marked so CSS can wrap the helper onto its own line.
		expect(setting.settingEl.classList.contains('synapse-setting--has-helper')).toBe(true);
		// …and nothing leaked into the section-body container.
		expect(container.children).toHaveLength(0);
	});

	it('renders a get-key anchor pointing at the provider console', () => {
		const { setting } = makeCtx();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-x' });
		const a = anchorEl(setting)!;
		expect(a).toBeDefined();
		expect(a.getAttribute('href')).toBe(PROVIDER_METADATA.openai.getKeyUrl);
		expect(a.getAttribute('target')).toBe('_blank');
	});

	it('omits the get-key anchor for keyless ollama', () => {
		const { setting } = makeCtx();
		decorateCredentialField({
			setting,
			provider: 'ollama',
			getKey: () => '',
			getEndpoint: () => 'http://localhost:11434',
		});
		expect(anchorEl(setting)).toBeUndefined();
	});

	it('starts with a neutral format-hint chip', () => {
		const { setting } = makeCtx();
		decorateCredentialField({ setting, provider: 'openai', getKey: () => '' });
		const chip = chipEl(setting)!;
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
	});

	it('shows a valid chip when the Test button reports valid', async () => {
		const { setting } = makeCtx();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'openai',
			message: 'Connected to OpenAI',
		});
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-good', validate });

		testButton()._click();
		await flush();

		expect(validate).toHaveBeenCalledWith('openai', 'sk-good', { endpoint: undefined });
		const chip = chipEl(setting)!;
		expect(chip.textContent).toContain('Connected to OpenAI');
		expect(chip.classList.contains('is-valid')).toBe(true);
	});

	it('shows an invalid chip when the Test button reports invalid', async () => {
		const { setting } = makeCtx();
		const validate = validatorReturning({
			status: 'invalid',
			provider: 'openai',
			message: 'Invalid key',
		});
		decorateCredentialField({ setting, provider: 'openai', getKey: () => 'sk-bad', validate });

		testButton()._click();
		await flush();

		const chip = chipEl(setting)!;
		expect(chip.textContent).toContain('Invalid key');
		expect(chip.classList.contains('is-invalid')).toBe(true);
	});

	it('passes the live endpoint through for ollama', async () => {
		const { setting } = makeCtx();
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

		testButton()._click();
		await flush();

		expect(validate).toHaveBeenCalledWith('ollama', '', { endpoint: 'http://localhost:11434' });
	});

	it('reset() restores the neutral hint after a result', async () => {
		const { setting } = makeCtx();
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

		testButton()._click();
		await flush();
		expect(chipEl(setting)!.classList.contains('is-valid')).toBe(true);

		handle.reset();
		const chip = chipEl(setting)!;
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
		expect(chip.classList.contains('is-valid')).toBe(false);
	});
});
