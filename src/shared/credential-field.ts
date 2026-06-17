// Decorates an API-key Setting row with the friendlier-auth affordances (#335):
// a "Get an API key →" deep link, a "Test" button, and a live ✓/✗ status chip.
//
// All of these attach to `setting.settingEl` (the one element both real Obsidian
// and the test mock expose on `Setting` — controlEl/descEl/nameEl are absent
// from the mock). The chip is updated in place, never via a settings re-render,
// so the password field keeps focus while the user types.

import { Setting } from 'obsidian';
import { PROVIDER_METADATA } from './provider-metadata';
import type { CredentialProvider } from './provider-metadata';
import { validateCredentials } from './credential-validator';
import type { ValidationResult } from './credential-validator';

export interface CredentialFieldOptions {
	/** The key (or, for Ollama, endpoint) Setting row to decorate. */
	setting: Setting;
	provider: CredentialProvider;
	/** Reads the current key value at click time (empty for keyless providers). */
	getKey: () => string;
	/** Ollama only — reads the current endpoint at click time. */
	getEndpoint?: () => string;
	/** Injected for tests; defaults to the real {@link validateCredentials}. */
	validate?: typeof validateCredentials;
}

export interface CredentialFieldHandle {
	/** Reset the chip to its neutral format hint (call when the key text changes). */
	reset(): void;
}

const STATUS_ICON: Record<ValidationResult['status'], string> = {
	valid: '✓',
	invalid: '✗',
	error: '⚠',
	skipped: '',
};

/** Visual chip states. `skipped` results render as a neutral `hint`. */
type ChipState = 'valid' | 'invalid' | 'error' | 'hint' | 'checking';

const STATE_CLASSES = ['is-valid', 'is-invalid', 'is-error', 'is-checking', 'is-hint'];

/**
 * Add the get-key link, Test button, and status chip to `opts.setting`.
 * Returns a handle whose `reset()` clears the chip back to the neutral hint —
 * call it from the field's `onChange` so a stale "✓ Connected" doesn't linger
 * after the user edits the key.
 */
export function decorateCredentialField(opts: CredentialFieldOptions): CredentialFieldHandle {
	const { setting, provider, getKey, getEndpoint } = opts;
	const validate = opts.validate ?? validateCredentials;
	const meta = PROVIDER_METADATA[provider];

	// Mark the row so its link + chip wrap onto their own line. A plain static
	// class — NOT a CSS `:has()` selector. `:has()` forces Chromium to re-check
	// the selector across the whole (large) settings DOM on every chip mutation,
	// which can stall/freeze the renderer; a fixed class costs nothing to match.
	setting.settingEl.addClass('synapse-credential-row');

	// "Get an API key →" deep link. Omitted for keyless providers (Ollama).
	// Rendered as an external anchor (like the About support links) so Obsidian
	// hands it to the OS browser and tests can find it via the anchor walk.
	if (meta.getKeyUrl) {
		setting.settingEl.createEl('a', {
			cls: 'synapse-get-key-link',
			text: 'Get an API key →',
			attr: { href: meta.getKeyUrl, target: '_blank', rel: 'noopener' },
		});
	}

	const chip = setting.settingEl.createDiv({ cls: 'synapse-credential-chip' });

	const setChip = (state: ChipState, text: string): void => {
		chip.removeClass(...STATE_CLASSES);
		chip.setText(text);
		chip.addClass(`is-${state}`);
	};

	const showHint = (): void => setChip('hint', meta.formatHint);
	const showResult = (result: ValidationResult): void => {
		const state: ChipState = result.status === 'skipped' ? 'hint' : result.status;
		const icon = STATUS_ICON[result.status];
		setChip(state, icon ? `${icon} ${result.message}` : result.message);
	};

	setting.addButton((btn) =>
		btn
			.setButtonText('Test')
			.setTooltip(`Test the ${meta.label} credential`)
			.onClick(() => {
				console.log('[synapse335] Test clicked, provider =', provider);
				setChip('checking', 'Checking…');
				btn.setDisabled(true);
				console.log('[synapse335] chip set to Checking, calling validate');
				// Returned (not floating) so Obsidian owns the promise and tests can
				// await the click via the mock's `_click()`.
				return validate(provider, getKey(), { endpoint: getEndpoint?.() })
					.then((result) => {
						console.log('[synapse335] validate resolved:', result.status);
						showResult(result);
						console.log('[synapse335] showResult done');
					})
					.catch((err: unknown) => {
						console.log('[synapse335] onClick catch:', err instanceof Error ? err.message : String(err));
						showResult({
							status: 'error',
							provider,
							message: err instanceof Error ? err.message : String(err),
						});
					})
					.finally(() => {
						console.log('[synapse335] finally — re-enabling button');
						btn.setDisabled(false);
					});
			}),
	);

	showHint();

	return { reset: showHint };
}
