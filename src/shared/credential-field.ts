// Decorates an API-key Setting row with the friendlier-auth affordances (#335):
// a "Get an API key →" deep link, a "Test" button, and a live ✓/✗ status chip.
//
// The Test button is added to the Setting row (`setting.addButton`); the get-key
// link and status chip render INSIDE the row's own `.setting-item` as a
// full-width wrapping line (no longer a section-body sibling), so the helper
// reflows independently of the row's name/control. The chip is updated in place,
// never via a settings re-render, so the password field keeps focus while the
// user types.

import { Setting } from 'obsidian';
import { PROVIDER_METADATA } from './provider-metadata';
import type { CredentialProvider } from './provider-metadata';
import { validateCredentials } from './credential-validator';
import type { ValidationResult } from './credential-validator';

export interface CredentialFieldOptions {
	/** The key (or, for Ollama, endpoint) Setting row to decorate (gets the Test button). */
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

	// Render the link + chip INSIDE the row's own `.setting-item`, as a full-width
	// wrapping line below the name/control — not as a section-body sibling — so the
	// helper reflows only itself. The marker class lets CSS wrap the setting-item so
	// the helper drops onto its own line. NB: the #335 freeze was NOT the chip's
	// location; it was updating the chip inside the promise-resolution microtask
	// after Test (see the Test onClick below for the root cause + fix).
	setting.settingEl.addClass('synapse-setting--has-helper');
	const extras = setting.settingEl.createDiv({ cls: 'synapse-credential-extras' });

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
				// Apply the result on a MACROTASK, not in the promise-resolution
				// microtask. Updating the settings DOM (the chip) inside the `.then()`
				// continuation after validation hard-freezes Obsidian's settings layout
				// — isolated for #335: the identical update via setTimeout never freezes;
				// only the `.then()`-microtask form does, independent of the network.
				// `void` keeps Obsidian's onClick handler synchronous.
				const settle = (result: ValidationResult): void => {
					window.setTimeout(() => {
						showResult(result);
						btn.setDisabled(false);
					}, 0);
				};
				void validate(provider, getKey(), { endpoint: getEndpoint?.() })
					.then(settle)
					.catch((err: unknown) =>
						settle({
							status: 'error',
							provider,
							message: err instanceof Error ? err.message : String(err),
						}),
					);
			}),
	);

	showHint();

	return { reset: showHint };
}
