// First-run onboarding (#89). A deliberately minimal, non-intrusive experience:
// a one-time welcome notice that points new users at the settings tab, plus a
// "required" emphasis on the AI provider API key field while it is still unset.
//
// This module is pure TypeScript with no Obsidian runtime import — the side
// effects (showing the notice, touching the DOM) live in the caller. The DOM
// helper takes a small structural target so both Obsidian's `Setting` and the
// test stub satisfy it. Keeping the logic here makes every branch unit-testable
// without rendering a full settings tab.

import type { SynapseSettings } from './settings';

/**
 * Duration (ms) of the first-run welcome notice. Longer than a routine info
 * toast so a brand-new user has time to read it and act before it dismisses.
 */
export const WELCOME_NOTICE_DURATION_MS = 12000;

/**
 * Copy for the first-run welcome notice. `NotificationManager.info` prefixes
 * `Synapse: `, so this string intentionally omits the brand name to avoid
 * doubling it. Brand voice: charged ("fire"), precise ("AI provider API key"),
 * deferential at the threshold ("proposals" — the user decides).
 */
export const WELCOME_MESSAGE =
	'Welcome — add your AI provider API key in the settings tab to fire your first proposals.';

/** CSS class that draws the "required" emphasis on a setting row. */
export const REQUIRED_FIELD_CLASS = 'synapse-setting-required';

/** Neutral description for the API key field once a key is set (or not needed). */
export const API_KEY_DESC = 'API key for OpenAI, Anthropic, or Google Gemini';

/** Emphasised description shown while the active provider still needs a key. */
export const API_KEY_REQUIRED_DESC =
	'Required — add your provider API key to activate AI features.';

/**
 * Note shown under the API key field for hosted providers (#364): a consumer
 * subscription is not API access, so it cannot power Synapse. Points to the two
 * paths that do work — a pay-as-you-go API key, or local/free Ollama. Brand
 * voice: precise and dry, no hype. See the README FAQ for the full rationale.
 */
export const API_KEY_NO_SUBSCRIPTION_NOTE =
	"Subscriptions (Claude Pro/Max, ChatGPT Plus, Gemini Advanced) can't be used here — use an API key, or Ollama for free local AI.";

/**
 * Whether the configured provider still needs an API key. Ollama runs locally
 * and authenticates against a URL endpoint, so it never counts as missing — only
 * the hosted providers (OpenAI, Anthropic, Gemini) require a key here.
 */
export function needsApiKey(settings: SynapseSettings): boolean {
	return settings.ai.provider !== 'ollama' && settings.ai.apiKey.trim() === '';
}

/**
 * The outcome of evaluating first-run onboarding. The caller performs the side
 * effects so this stays pure and testable.
 *
 * - `markSeen`  — persist `onboarding.hasSeenWelcome = true` (so it never fires
 *   again). False only when it was already seen.
 * - `showWelcome` — actually surface the welcome notice.
 */
export interface FirstRunPlan {
	showWelcome: boolean;
	markSeen: boolean;
}

/**
 * Decide what first-run onboarding to perform.
 *
 * The welcome only greets a *genuine* fresh install (no persisted plugin data).
 * An existing user upgrading into this version has saved data but has never had
 * the flag set — we silently mark them as seen rather than greeting them with a
 * "configure your API key" notice they neither need nor expect. Once the flag is
 * set, this is a no-op forever.
 */
export function planFirstRun(
	settings: SynapseSettings,
	isFreshInstall: boolean,
): FirstRunPlan {
	if (settings.onboarding.hasSeenWelcome) {
		return { showWelcome: false, markSeen: false };
	}
	return { showWelcome: isFreshInstall, markSeen: true };
}

/**
 * Minimal structural view of an Obsidian `Setting` needed to toggle the
 * required-field emphasis. Both the real `Setting` and the test stub satisfy it.
 */
export interface EmphasisTarget {
	settingEl: { toggleClass(cls: string, on: boolean): void };
	setDesc(desc: string): unknown;
}

/**
 * Apply (or clear) the "required" emphasis on the API key setting row to mirror
 * whether the active provider still needs a key. Safe to call repeatedly — it is
 * idempotent and reflects only the current settings, so it doubles as the live
 * update handler as the user types a key in (the emphasis clears the moment the
 * field is non-empty, without a full settings re-render that would steal focus).
 */
export function applyApiKeyEmphasis(
	target: EmphasisTarget,
	settings: SynapseSettings,
): void {
	const needed = needsApiKey(settings);
	target.settingEl.toggleClass(REQUIRED_FIELD_CLASS, needed);
	target.setDesc(needed ? API_KEY_REQUIRED_DESC : API_KEY_DESC);
}
