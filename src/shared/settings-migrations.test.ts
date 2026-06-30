import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	CURRENT_SETTINGS_VERSION,
	SETTINGS_MIGRATIONS,
	readSettingsVersion,
	migrateSettings,
	foldExcludeFoldersIntoExclusions,
	dropSemanticMatching,
} from './settings-migrations';
import type { ExclusionRule } from './exclusions';

describe('readSettingsVersion (#93)', () => {
	it('returns 0 when the settingsVersion field is missing', () => {
		expect(readSettingsVersion({})).toBe(0);
	});

	it('returns 0 for null or undefined input', () => {
		expect(readSettingsVersion(null)).toBe(0);
		expect(readSettingsVersion(undefined)).toBe(0);
	});

	it('returns 0 when settingsVersion is a non-number (e.g. a numeric string)', () => {
		expect(readSettingsVersion({ settingsVersion: '2' })).toBe(0);
	});

	it('returns the value when settingsVersion is a number', () => {
		expect(readSettingsVersion({ settingsVersion: 2 })).toBe(2);
		expect(readSettingsVersion({ settingsVersion: 0 })).toBe(0);
	});
});

describe('migrateSettings — ordering (#93)', () => {
	it('runs both migrations from version 0', () => {
		const raw = {
			enrichment: { excludeFolders: ['Templates'] },
			rem: { semanticMatching: true, titleMatchWeight: 0.6 },
		};
		const out = migrateSettings(raw, 0);
		// to:1 synthesized exclusions from the legacy folder list...
		expect(Array.isArray(out.exclusions)).toBe(true);
		expect((out.exclusions as ExclusionRule[]).length).toBeGreaterThan(0);
		// ...and to:2 dropped the inert flag (but kept the renamed field).
		expect(out.rem).not.toHaveProperty('semanticMatching');
		expect((out.rem as Record<string, unknown>).titleMatchWeight).toBe(0.6);
	});

	it('runs only the to:2 migration from version 1', () => {
		const raw = {
			enrichment: { excludeFolders: ['Templates'] },
			rem: { semanticMatching: true },
		};
		const out = migrateSettings(raw, 1);
		// to:1 skipped → no exclusions synthesized from the legacy folders.
		expect(out.exclusions).toBeUndefined();
		// to:2 still ran.
		expect(out.rem).not.toHaveProperty('semanticMatching');
	});

	it('runs no migrations from the current version', () => {
		const raw = {
			enrichment: { excludeFolders: ['Templates'] },
			rem: { semanticMatching: true },
		};
		const out = migrateSettings(raw, CURRENT_SETTINGS_VERSION);
		expect(out.exclusions).toBeUndefined();
		expect(out.rem).toHaveProperty('semanticMatching');
	});

	it('does not mutate the input object (proves the clone)', () => {
		const raw = {
			enrichment: { excludeFolders: ['Templates'] },
			rem: { semanticMatching: true, titleMatchWeight: 0.6 },
		};
		const snapshot: unknown = JSON.parse(JSON.stringify(raw));
		migrateSettings(raw, 0);
		// Deep-equal to its pre-call snapshot: no field added or removed.
		expect(raw).toEqual(snapshot);
		expect(raw).not.toHaveProperty('exclusions');
		expect(raw.rem).toHaveProperty('semanticMatching');
	});
});

describe('migrateSettings — error propagation (#93)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('lets a throwing migration propagate out so loadSettings can fall back', () => {
		const boom = new Error('migration exploded');
		vi.spyOn(SETTINGS_MIGRATIONS[0], 'migrate').mockImplementation(() => {
			throw boom;
		});
		expect(() => migrateSettings({}, 0)).toThrow(boom);
	});
});

describe('foldExcludeFoldersIntoExclusions — to:1 migration (#93)', () => {
	it('builds exclusions from legacy excludeFolders when exclusions is absent', () => {
		const raw: Record<string, unknown> = {
			enrichment: { excludeFolders: ['Templates'] },
		};
		const out = foldExcludeFoldersIntoExclusions(raw);
		const rules = out.exclusions as ExclusionRule[];
		expect(Array.isArray(rules)).toBe(true);
		expect(rules.some((r) => r.pattern === 'Templates/**')).toBe(true);
	});

	it('is a no-op when exclusions is already present (keeps the existing list)', () => {
		const existing: ExclusionRule[] = [{ pattern: 'Keep/**', features: 'all' }];
		const raw: Record<string, unknown> = {
			enrichment: { excludeFolders: ['Templates'] },
			exclusions: existing,
		};
		const out = foldExcludeFoldersIntoExclusions(raw);
		// Same array reference — nothing rebuilt.
		expect(out.exclusions).toBe(existing);
	});

	it('preserves an empty exclusions array (user deliberately cleared it)', () => {
		const raw: Record<string, unknown> = {
			enrichment: { excludeFolders: ['Templates'] },
			exclusions: [],
		};
		const out = foldExcludeFoldersIntoExclusions(raw);
		expect(out.exclusions).toEqual([]);
	});

	it('is idempotent on a second run', () => {
		const raw: Record<string, unknown> = {
			enrichment: { excludeFolders: ['Templates'] },
		};
		const first = foldExcludeFoldersIntoExclusions(raw);
		const built = first.exclusions;
		const second = foldExcludeFoldersIntoExclusions(first);
		// Second pass sees exclusions present → no rebuild, same reference.
		expect(second.exclusions).toBe(built);
	});
});

describe('dropSemanticMatching — to:2 migration (#93)', () => {
	it('removes rem.semanticMatching when present, leaving sibling fields intact', () => {
		const raw: Record<string, unknown> = {
			rem: { semanticMatching: true, titleMatchWeight: 0.6 },
		};
		const out = dropSemanticMatching(raw);
		expect(out.rem).not.toHaveProperty('semanticMatching');
		expect((out.rem as Record<string, unknown>).titleMatchWeight).toBe(0.6);
	});

	it('is idempotent — a second run is a no-op', () => {
		const raw: Record<string, unknown> = { rem: { semanticMatching: true } };
		dropSemanticMatching(raw);
		const out = dropSemanticMatching(raw);
		expect(out.rem).not.toHaveProperty('semanticMatching');
	});

	it('tolerates a missing rem', () => {
		const raw: Record<string, unknown> = {};
		expect(() => dropSemanticMatching(raw)).not.toThrow();
		expect(raw.rem).toBeUndefined();
	});

	it('tolerates a non-object rem', () => {
		const raw: Record<string, unknown> = { rem: 'not-an-object' };
		expect(() => dropSemanticMatching(raw)).not.toThrow();
		expect(raw.rem).toBe('not-an-object');
	});

	it('tolerates a null rem', () => {
		const raw: Record<string, unknown> = { rem: null };
		expect(() => dropSemanticMatching(raw)).not.toThrow();
		expect(raw.rem).toBeNull();
	});
});

describe('settings-migration drift guard (#93)', () => {
	it('CURRENT_SETTINGS_VERSION equals the highest migration `to`', () => {
		expect(CURRENT_SETTINGS_VERSION).toBe(
			Math.max(...SETTINGS_MIGRATIONS.map((m) => m.to)),
		);
	});

	it('orders the migrations ascending by `to`', () => {
		const tos = SETTINGS_MIGRATIONS.map((m) => m.to);
		expect(tos).toEqual([...tos].sort((a, b) => a - b));
	});
});
