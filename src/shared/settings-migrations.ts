import { buildMigratedExclusions } from './exclusions';
import type { LegacyModuleExclusions } from './exclusions';

/**
 * Version-stamped settings migration framework (#93).
 *
 * A small, PURE runner that transforms the RAW persisted settings object (the
 * value `loadData()` returns) BEFORE it is merged with `DEFAULT_SETTINGS`. It is
 * driven by a `settingsVersion` field on the stored data: every migration whose
 * `to` exceeds the persisted version is replayed, in ascending order, to bring
 * the object up to {@link CURRENT_SETTINGS_VERSION}.
 *
 * Layering: this module is part of the lowest (`shared/`) layer. It imports
 * `buildMigratedExclusions`/`LegacyModuleExclusions` DIRECTLY from `./exclusions`
 * (same layer, not via the barrel) and operates only on `Record<string, unknown>`.
 * It must NEVER import `../settings` — keeping `shared/` the bottom layer is what
 * keeps the `settings → settings-migrations → exclusions` import graph acyclic.
 */

/**
 * The schema version {@link DEFAULT_SETTINGS} currently targets. Bump this each
 * time a migration is appended to {@link SETTINGS_MIGRATIONS}; a drift-guard test
 * asserts it always equals the highest migration `to`.
 */
export const CURRENT_SETTINGS_VERSION = 8;

/**
 * A single ordered migration. `to` is the schema version this step upgrades the
 * raw object *to*; `migrate` transforms the object it is handed (the clone
 * {@link migrateSettings} owns) and returns it.
 */
export interface SettingsMigration {
	to: number;
	migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Read the persisted schema version off a raw settings object. An absent, null,
 * or non-numeric `settingsVersion` is treated as version 0 — the pre-versioning
 * baseline — so a legacy `data.json` replays every migration from the start.
 */
export function readSettingsVersion(raw: Record<string, unknown> | null | undefined): number {
	if (raw && typeof raw.settingsVersion === 'number') {
		return raw.settingsVersion;
	}
	return 0;
}

/**
 * v1 — fold the legacy per-module `excludeFolders` lists into the centralized
 * `exclusions` list (#307), wrapping {@link buildMigratedExclusions}. KEEPS the
 * original presence guard: only build the list when `exclusions` is absent. This
 * preserves today's exact behavior — including a user who deliberately cleared
 * exclusions to `[]` (which must stay `[]`) — and makes the step idempotent.
 */
export function foldExcludeFoldersIntoExclusions(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	if (raw.exclusions === undefined) {
		// `LegacyModuleExclusions` is an all-optional read shape, so the raw record
		// satisfies it directly (a typed annotation, not an assertion);
		// buildMigratedExclusions defensively coerces each legacy value it reads.
		const legacy: LegacyModuleExclusions = raw;
		raw.exclusions = buildMigratedExclusions(legacy);
	}
	return raw;
}

/**
 * v2 — drop the inert `rem.semanticMatching` flag left behind by the REM rename
 * to `titleMatchWeight`. DELETE-ONLY: REM is always-on now and the old boolean
 * has no faithful target, so it is not mapped to `titleMatchWeight`. Tolerates a
 * missing or non-object `rem`; idempotent.
 */
export function dropSemanticMatching(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const rem = raw.rem;
	if (
		typeof rem === 'object' &&
		rem !== null &&
		Object.prototype.hasOwnProperty.call(rem, 'semanticMatching')
	) {
		delete (rem as Record<string, unknown>).semanticMatching;
	}
	return raw;
}

/**
 * v3 — rename the Whisper-only `audio.whisperModel` to the provider-agnostic
 * `audio.transcriptionModel` (#521). Carries the user's value across rather
 * than dropping it, and leaves an existing `transcriptionModel` untouched so
 * the step stays idempotent. Tolerates a missing or non-object `audio`.
 */
export function renameWhisperModelToTranscriptionModel(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const audio = raw.audio;
	if (typeof audio !== 'object' || audio === null) {
		return raw;
	}
	const record = audio as Record<string, unknown>;
	if (!Object.prototype.hasOwnProperty.call(record, 'whisperModel')) {
		return raw;
	}
	if (record.transcriptionModel === undefined && typeof record.whisperModel === 'string') {
		record.transcriptionModel = record.whisperModel;
	}
	delete record.whisperModel;
	return raw;
}

/** Vendor-retired model IDs and the replacement each vendor's deprecation notice names (checked 2026-11-13). */
export const RETIRED_MODEL_REPLACEMENTS: Record<string, string> = {
	'o3': 'gpt-5.6-sol',
	'o3-mini': 'gpt-5.6-sol',
	'o4-mini': 'gpt-5.6-terra',
	'gemini-2.5-pro': 'gemini-3.8-flash',
	'gemini-2.5-flash': 'gemini-3.5-flash-lite',
	'gemini-3.5-flash': 'gemini-3.6-flash',
	'gpt-4o': 'gpt-6-luna',
	'gpt-4o-mini': 'gpt-6-luna',
	'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite',
};

const MODEL_FIELD_PATHS: string[][] = [
	['ai', 'model'],
	['audio', 'transcriptionModel'],
	['image', 'visionModel'],
	['video', 'frameExtraction', 'visionModel'],
];

/** The `ai.overrides` entries of a raw settings object, skipping malformed ones. */
function rawOverrides(raw: Record<string, unknown>): Record<string, unknown>[] {
	const ai = raw.ai;
	if (typeof ai !== 'object' || ai === null) return [];
	const overrides = (ai as Record<string, unknown>).overrides;
	if (typeof overrides !== 'object' || overrides === null) return [];
	return Object.values(overrides).filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null);
}

/**
 * v4 — repoint every saved model field holding a retired vendor ID to its
 * replacement, so a stale value never reaches the API before the settings tab
 * normalizes it. IDs are vendor-unique, so no provider check is needed.
 * Tolerates missing or non-object parents; idempotent.
 */
export function replaceRetiredModels(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	for (const override of rawOverrides(raw)) {
		const model = override.model;
		if (typeof model === 'string' && Object.prototype.hasOwnProperty.call(RETIRED_MODEL_REPLACEMENTS, model)) {
			override.model = RETIRED_MODEL_REPLACEMENTS[model];
		}
	}
	for (const path of MODEL_FIELD_PATHS) {
		let parent: unknown = raw;
		for (const key of path.slice(0, -1)) {
			parent = typeof parent === 'object' && parent !== null
				? (parent as Record<string, unknown>)[key]
				: undefined;
		}
		if (typeof parent !== 'object' || parent === null) continue;
		const record = parent as Record<string, unknown>;
		const leaf = path[path.length - 1];
		const value = record[leaf];
		if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(RETIRED_MODEL_REPLACEMENTS, value)) {
			record[leaf] = RETIRED_MODEL_REPLACEMENTS[value];
		}
	}
	return raw;
}

/**
 * v5 — drop the retired `ai.temperature` and `ai.maxTokens` (#596). A user on
 * temperature 0 had caching on automatically, so they get `cacheResponses: true`.
 */
export function dropSamplingSettings(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const ai = raw.ai;
	if (typeof ai !== 'object' || ai === null) return raw;
	const record = ai as Record<string, unknown>;
	if (record.temperature === 0) record.cacheResponses = true;
	delete record.temperature;
	delete record.maxTokens;
	return raw;
}

const TRANSCRIPTION_KEY_VENDORS: [string, string][] = [
	['whisperApiKey', 'openai'],
	['geminiApiKey', 'gemini'],
	['deepgramApiKey', 'deepgram'],
];

/**
 * v7 — move the transcription keys into the shared per-vendor keys, one key per
 * vendor. A vendor that is the default provider fills `ai.apiKey` only when it is
 * empty; an existing main key wins. Tolerates missing sections; idempotent.
 */
export function moveTranscriptionKeys(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const audio = raw.audio;
	if (typeof audio !== 'object' || audio === null) return raw;
	const audioRecord = audio as Record<string, unknown>;
	if (typeof raw.ai !== 'object' || raw.ai === null) raw.ai = {};
	const ai = raw.ai as Record<string, unknown>;
	if (typeof ai.providerKeys !== 'object' || ai.providerKeys === null) ai.providerKeys = {};
	const keys = ai.providerKeys as Record<string, unknown>;
	for (const [field, vendor] of TRANSCRIPTION_KEY_VENDORS) {
		const value = audioRecord[field];
		delete audioRecord[field];
		if (typeof value !== 'string' || value === '') continue;
		if (ai.provider === vendor) {
			if (!ai.apiKey) ai.apiKey = value;
		} else if (!keys[vendor]) {
			keys[vendor] = value;
		}
	}
	return raw;
}

/** Retired effort levels and the step each becomes; never a higher step than the user chose. */
export const RETIRED_EFFORT_REPLACEMENTS: Record<string, string> = {
	none: 'low',
	minimal: 'low',
	xhigh: 'high',
};

/** v8 — map the retired effort levels onto Default / Low / Medium / High / Max, for the default and every override. */
export function normalizeEfforts(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const ai = raw.ai;
	if (typeof ai !== 'object' || ai === null) return raw;
	for (const holder of [ai as Record<string, unknown>, ...rawOverrides(raw)]) {
		const effort = holder.effort;
		if (typeof effort === 'string' && Object.prototype.hasOwnProperty.call(RETIRED_EFFORT_REPLACEMENTS, effort)) {
			holder.effort = RETIRED_EFFORT_REPLACEMENTS[effort];
		}
	}
	return raw;
}

/**
 * The ordered migration chain, ascending by `to`. {@link migrateSettings}
 * applies, in order, every entry whose `to` exceeds the persisted version.
 */
export const SETTINGS_MIGRATIONS: SettingsMigration[] = [
	{ to: 1, migrate: foldExcludeFoldersIntoExclusions },
	{ to: 2, migrate: dropSemanticMatching },
	{ to: 3, migrate: renameWhisperModelToTranscriptionModel },
	{ to: 4, migrate: replaceRetiredModels },
	{ to: 5, migrate: dropSamplingSettings },
	// v6 replays the retired-model remap for the IDs added since v4 (gpt-4o, gpt-4o-mini, gemini-3.1-flash-lite).
	{ to: 6, migrate: replaceRetiredModels },
	{ to: 7, migrate: moveTranscriptionKeys },
	{ to: 8, migrate: normalizeEfforts },
];

/**
 * Apply every migration newer than `fromVersion` to `raw`, in ascending order,
 * returning the transformed object. The input is CLONED once via a JSON
 * round-trip up front (the data is JSON-origin from `loadData`, so this is safe)
 * so a throwing migration can never half-mutate the caller's fallback object.
 */
export function migrateSettings(
	raw: Record<string, unknown>,
	fromVersion: number,
): Record<string, unknown> {
	let working = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
	for (const migration of SETTINGS_MIGRATIONS) {
		if (migration.to > fromVersion) {
			working = migration.migrate(working);
		}
	}
	return working;
}
