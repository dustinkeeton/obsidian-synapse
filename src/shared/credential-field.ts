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
	/** The key (or, for Ollama, endpoint) Setting row to decorate (gets the Test button). */
	setting: Setting;
	/**
	 * The section body the row lives in. The get-key link + status chip are
	 * rendered here as their own block (right after the row), NOT inside the
	 * `.setting-item` — mutating a child of the flex row forces a pathological
	 * relayout of Obsidian's settings flexbox that can freeze the app.
	 */
	container: HTMLElement;
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
	const { setting, container, provider, getKey, getEndpoint } = opts;
	const validate = opts.validate ?? validateCredentials;
	const meta = PROVIDER_METADATA[provider];

	// Render the link + chip as their own block in the section body, right after
	// the row — NOT inside the `.setting-item`. Mutating a flex child of the row
	// (the chip) forces a pathological relayout of Obsidian's settings flexbox
	// that hard-freezes the app; a standalone block reflows only itself. This
	// mirrors the exclusion-chips UI, which renders into the body and never freezes.
	const extras = container.createDiv({ cls: 'synapse-credential-extras' });

	// "Get an API key →" deep link. Omitted for keyless providers (Ollama).
	// An external anchor (like the About support links) so Obsidian hands it to
	// the OS browser and tests can find it via the anchor walk.
	if (meta.getKeyUrl) {
		extras.createEl('a', {
			cls: 'synapse-get-key-link',
			text: 'Get an API key →',
			attr: { href: meta.getKeyUrl, target: '_blank', rel: 'noopener' },
		});
	}

	const chip = extras.createDiv({ cls: 'synapse-credential-chip' });

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
				setChip('checking', 'Checking…');
				btn.setDisabled(true);
				// Returned (not floating) so Obsidian owns the promise and tests can
				// await the click via the mock's `_click()`.
				return validate(provider, getKey(), { endpoint: getEndpoint?.() })
					.then(showResult)
					.catch((err: unknown) =>
						showResult({
							status: 'error',
							provider,
							message: err instanceof Error ? err.message : String(err),
						}),
					)
					.finally(() => btn.setDisabled(false));
			}),
	);

	showHint();

	return { reset: showHint };
}
