import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';

/**
 * Reset-to-defaults logic for the settings tab (#420).
 *
 * Pure, DOM-free helpers so the reset math is unit-testable in isolation from the
 * accordion UI and the confirmation modal. Two scopes:
 *  - {@link applySectionReset} restores a single section's subtree in place.
 *  - {@link applyResetAll} rebuilds the whole settings object, preserving a small
 *    set of install bookkeeping fields.
 *
 * ALIASING GUARD: `main.ts`'s `deepMerge` is not a deep clone, so on a fresh
 * install `settings.<key>` can be the SAME object reference as
 * `DEFAULT_SETTINGS.<key>`. Every object restored here therefore goes through
 * `structuredClone` so a later edit never mutates the shared `DEFAULT_SETTINGS`
 * constant.
 */

/**
 * Whether a settings section exposes a per-section "reset to defaults" control.
 * Every section does EXCEPT `about`, which hosts the global reset-all control
 * instead of resetting a settings subtree of its own.
 */
export function sectionHasReset(key: string): boolean {
	return key !== 'about';
}

/**
 * Restore one top-level settings group to its default (deep-cloned) value.
 * Generic over the key so the source and destination stay correlated — a plain
 * `settings[key] = clone(DEFAULT[key])` with a union `key` doesn't type-check.
 */
function restoreGroup<K extends keyof SynapseSettings>(
	settings: SynapseSettings,
	key: K,
): void {
	settings[key] = structuredClone(DEFAULT_SETTINGS[key]);
}

/**
 * Restore a single section's settings subtree to shipped defaults, mutating
 * `settings` in place. The section KEY identifies the subtree.
 *
 * Most sections map 1:1 to a top-level settings group and are restored
 * wholesale. Three keys are special:
 *  - `general` — a cross-cutting section that owns only `ui.autoFoldProperties`
 *    and `updates.enableUpdateNotifications` (not the whole `ui`/`updates` group).
 *  - `ai` — restores the `ai` group plus the six audio credential/provider fields
 *    that render under AI configuration.
 *  - `audio` — restores ONLY the four audio behavior fields, preserving the
 *    credential/provider fields owned by AI configuration.
 *
 * Does NOT touch `ui.collapsedSections[key]`: a section's collapse state is UI
 * bookkeeping, not a user setting.
 */
export function applySectionReset(settings: SynapseSettings, key: string): void {
	switch (key) {
		case 'general':
			// Primitives — no aliasing concern, direct copy from defaults.
			settings.ui.autoFoldProperties = DEFAULT_SETTINGS.ui.autoFoldProperties;
			settings.updates.enableUpdateNotifications =
				DEFAULT_SETTINGS.updates.enableUpdateNotifications;
			return;
		case 'ai':
			settings.ai = structuredClone(DEFAULT_SETTINGS.ai);
			// The six audio credential/provider fields render under AI configuration,
			// so restore them here alongside `ai`. All string primitives (or a string
			// literal union) — direct copy is safe, no clone needed.
			settings.audio.transcriptionProvider = DEFAULT_SETTINGS.audio.transcriptionProvider;
			settings.audio.whisperApiKey = DEFAULT_SETTINGS.audio.whisperApiKey;
			settings.audio.deepgramApiKey = DEFAULT_SETTINGS.audio.deepgramApiKey;
			settings.audio.geminiApiKey = DEFAULT_SETTINGS.audio.geminiApiKey;
			settings.audio.whisperModel = DEFAULT_SETTINGS.audio.whisperModel;
			settings.audio.localWhisperPath = DEFAULT_SETTINGS.audio.localWhisperPath;
			return;
		case 'audio':
			// Behavior fields only — leave the credential/provider fields (owned by
			// AI configuration) exactly as the user left them.
			settings.audio.enabled = DEFAULT_SETTINGS.audio.enabled;
			settings.audio.language = DEFAULT_SETTINGS.audio.language;
			settings.audio.autoFormatLyrics = DEFAULT_SETTINGS.audio.autoFormatLyrics;
			settings.audio.postProcessing = structuredClone(
				DEFAULT_SETTINGS.audio.postProcessing,
			);
			return;
		default:
			// Every remaining section key names a 1:1 top-level settings subtree.
			// restoreGroup deep-clones so the fresh values never alias DEFAULT_SETTINGS.
			restoreGroup(settings, key as keyof SynapseSettings);
	}
}

/**
 * Build a fresh settings object at shipped defaults for a global "reset all",
 * copying back the small set of install-bookkeeping fields that must survive a
 * reset:
 *  - `settingsVersion` — schema version stamp;
 *  - `onboarding.hasSeenWelcome` — so the first-run welcome never re-fires;
 *  - `updates.lastUpdateCheck` / `updates.dismissedUpdateVersion` — update-check
 *    rate-limit + dedupe state (optional; only copied when present, since
 *    `DEFAULT_SETTINGS.updates` omits them);
 *  - `ui.collapsedSections` — the accordion collapse state.
 *
 * Returns a new object (the caller reassigns `plugin.settings`); `current` is
 * not mutated.
 */
export function applyResetAll(current: SynapseSettings): SynapseSettings {
	const fresh = structuredClone(DEFAULT_SETTINGS);

	fresh.settingsVersion = current.settingsVersion;
	fresh.onboarding.hasSeenWelcome = current.onboarding.hasSeenWelcome;
	fresh.ui.collapsedSections = structuredClone(current.ui.collapsedSections);

	if (current.updates.lastUpdateCheck !== undefined) {
		fresh.updates.lastUpdateCheck = current.updates.lastUpdateCheck;
	}
	if (current.updates.dismissedUpdateVersion !== undefined) {
		fresh.updates.dismissedUpdateVersion = current.updates.dismissedUpdateVersion;
	}

	return fresh;
}
