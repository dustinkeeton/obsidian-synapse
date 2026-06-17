import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Setting as ObsidianSetting } from 'obsidian';
import { Setting, ButtonComponent, createEl } from '../__mocks__/obsidian';
import { decorateCredentialField } from './credential-field';
import type { ValidationResult } from './credential-validator';
import { PROVIDER_METADATA } from './provider-metadata';

/**
 * Build a mock Setting row + a section-body container. The link + chip render
 * into the container (their own block), so tests inspect the container — not the
 * Setting row — mirroring how the decorator renders to avoid the settings-flex
 * freeze. The Setting is typed as the real one so it satisfies the decorator API.
 */
function makeCtx() {
	const setting = new Setting({} as never) as unknown as ObsidianSetting;
	const container = createEl();
	return { setting, container };
}

const extrasEl = (container: any) =>
	container.children.find((el: any) => el.classList?.contains('synapse-credential-extras'));
const chipEl = (container: any) =>
	extrasEl(container)?.children.find((el: any) => el.classList?.contains('synapse-credential-chip'));
const anchorEl = (container: any) =>
	extrasEl(container)?.children.find((el: any) => el.tagName === 'A');

function testButton(): ButtonComponent {
	const btn = ButtonComponent.instances.find((b) => b.buttonText === 'Test');
	if (!btn) throw new Error('Test button not rendered');
	return btn;
}

function validatorReturning(result: ValidationResult) {
	return vi.fn(async () => Promise.resolve(result));
}

/**
 * Flush pending microtasks. The Test onClick fires validation fire-and-forget
 * (it must NOT return the promise — that freezes Obsidian), so `_click()` returns
 * `undefined`; tests await this to let `.then(showResult)` settle.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('decorateCredentialField', () => {
	beforeEach(() => {
		ButtonComponent.instances.length = 0;
	});

	it('renders the link + chip as a block in the container, not in the setting row', () => {
		const { setting, container } = makeCtx();
		decorateCredentialField({ setting, container, provider: 'openai', getKey: () => 'sk-x' });
		// The extras block lives in the container…
		expect(extrasEl(container)).toBeDefined();
		// …and nothing was appended to the setting row itself (which would freeze).
		expect((setting.settingEl as any).children).toHaveLength(0);
	});

	it('renders a get-key anchor pointing at the provider console', () => {
		const { setting, container } = makeCtx();
		decorateCredentialField({ setting, container, provider: 'openai', getKey: () => 'sk-x' });
		const a = anchorEl(container);
		expect(a).toBeDefined();
		expect(a.getAttribute('href')).toBe(PROVIDER_METADATA.openai.getKeyUrl);
		expect(a.getAttribute('target')).toBe('_blank');
	});

	it('omits the get-key anchor for keyless ollama', () => {
		const { setting, container } = makeCtx();
		decorateCredentialField({
			setting,
			container,
			provider: 'ollama',
			getKey: () => '',
			getEndpoint: () => 'http://localhost:11434',
		});
		expect(anchorEl(container)).toBeUndefined();
	});

	it('starts with a neutral format-hint chip', () => {
		const { setting, container } = makeCtx();
		decorateCredentialField({ setting, container, provider: 'openai', getKey: () => '' });
		const chip = chipEl(container);
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
	});

	it('shows a valid chip when the Test button reports valid', async () => {
		const { setting, container } = makeCtx();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'openai',
			message: 'Connected to OpenAI',
		});
		decorateCredentialField({ setting, container, provider: 'openai', getKey: () => 'sk-good', validate });

		testButton()._click();
		await flush();

		expect(validate).toHaveBeenCalledWith('openai', 'sk-good', { endpoint: undefined });
		const chip = chipEl(container);
		expect(chip.textContent).toContain('Connected to OpenAI');
		expect(chip.classList.contains('is-valid')).toBe(true);
	});

	it('shows an invalid chip when the Test button reports invalid', async () => {
		const { setting, container } = makeCtx();
		const validate = validatorReturning({
			status: 'invalid',
			provider: 'openai',
			message: 'Invalid key',
		});
		decorateCredentialField({ setting, container, provider: 'openai', getKey: () => 'sk-bad', validate });

		testButton()._click();
		await flush();

		const chip = chipEl(container);
		expect(chip.textContent).toContain('Invalid key');
		expect(chip.classList.contains('is-invalid')).toBe(true);
	});

	it('passes the live endpoint through for ollama', async () => {
		const { setting, container } = makeCtx();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'ollama',
			message: 'Ollama is reachable',
		});
		decorateCredentialField({
			setting,
			container,
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
		const { setting, container } = makeCtx();
		const validate = validatorReturning({
			status: 'valid',
			provider: 'openai',
			message: 'Connected to OpenAI',
		});
		const handle = decorateCredentialField({
			setting,
			container,
			provider: 'openai',
			getKey: () => 'sk-good',
			validate,
		});

		testButton()._click();
		await flush();
		expect(chipEl(container).classList.contains('is-valid')).toBe(true);

		handle.reset();
		const chip = chipEl(container);
		expect(chip.textContent).toBe(PROVIDER_METADATA.openai.formatHint);
		expect(chip.classList.contains('is-hint')).toBe(true);
		expect(chip.classList.contains('is-valid')).toBe(false);
	});
});
