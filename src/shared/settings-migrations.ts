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
export const CURRENT_SETTINGS_VERSION = 2;

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
 * The ordered migration chain, ascending by `to`. {@link migrateSettings}
 * applies, in order, every entry whose `to` exceeds the persisted version.
 */
export const SETTINGS_MIGRATIONS: SettingsMigration[] = [
	{ to: 1, migrate: foldExcludeFoldersIntoExclusions },
	{ to: 2, migrate: dropSemanticMatching },
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
