import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	CURRENT_SETTINGS_VERSION,
	SETTINGS_MIGRATIONS,
	readSettingsVersion,
	migrateSettings,
	foldExcludeFoldersIntoExclusions,
	dropSemanticMatching,
	renameWhisperModelToTranscriptionModel,
	replaceRetiredModels,
	dropSamplingSettings,
	moveTranscriptionKeys,
	normalizeEfforts,
	RETIRED_MODEL_REPLACEMENTS,
} from './settings-migrations';
import { MODEL_OPTIONS, TRANSCRIPTION_MODEL_OPTIONS } from '../settings';
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

describe('renameWhisperModelToTranscriptionModel — to:3 migration (#521)', () => {
	it('carries a customized whisperModel across to transcriptionModel', () => {
		const raw: Record<string, unknown> = {
			audio: { whisperModel: 'whisper-large', language: 'en' },
		};
		const out = renameWhisperModelToTranscriptionModel(raw);
		const audio = out.audio as Record<string, unknown>;
		expect(audio.transcriptionModel).toBe('whisper-large');
		expect(audio).not.toHaveProperty('whisperModel');
		expect(audio.language).toBe('en');
	});

	it('carries the stock whisper-1 value across', () => {
		const raw: Record<string, unknown> = { audio: { whisperModel: 'whisper-1' } };
		const out = renameWhisperModelToTranscriptionModel(raw);
		expect((out.audio as Record<string, unknown>).transcriptionModel).toBe('whisper-1');
	});

	it('leaves an existing transcriptionModel untouched and still drops the old key', () => {
		const raw: Record<string, unknown> = {
			audio: { whisperModel: 'whisper-1', transcriptionModel: 'nova-3-general' },
		};
		const out = renameWhisperModelToTranscriptionModel(raw);
		const audio = out.audio as Record<string, unknown>;
		expect(audio.transcriptionModel).toBe('nova-3-general');
		expect(audio).not.toHaveProperty('whisperModel');
	});

	it('is idempotent — a second run is a no-op', () => {
		const raw: Record<string, unknown> = { audio: { whisperModel: 'whisper-large' } };
		renameWhisperModelToTranscriptionModel(raw);
		const out = renameWhisperModelToTranscriptionModel(raw);
		expect((out.audio as Record<string, unknown>).transcriptionModel).toBe('whisper-large');
	});

	it('does not invent a transcriptionModel when whisperModel is absent', () => {
		const raw: Record<string, unknown> = { audio: { language: 'en' } };
		const out = renameWhisperModelToTranscriptionModel(raw);
		expect(out.audio).not.toHaveProperty('transcriptionModel');
	});

	it('drops a non-string whisperModel rather than carrying it across', () => {
		const raw: Record<string, unknown> = { audio: { whisperModel: 42 } };
		const out = renameWhisperModelToTranscriptionModel(raw);
		const audio = out.audio as Record<string, unknown>;
		expect(audio).not.toHaveProperty('whisperModel');
		expect(audio).not.toHaveProperty('transcriptionModel');
	});

	it('tolerates a missing, non-object, or null audio', () => {
		expect(() => renameWhisperModelToTranscriptionModel({})).not.toThrow();
		expect(() => renameWhisperModelToTranscriptionModel({ audio: 'nope' })).not.toThrow();
		expect(() => renameWhisperModelToTranscriptionModel({ audio: null })).not.toThrow();
	});
});

describe('replaceRetiredModels — to:4 migration', () => {
	it('repoints every saved model field holding a retired id', () => {
		const out = replaceRetiredModels({
			ai: { provider: 'openai', model: 'o4-mini' },
			audio: { transcriptionProvider: 'gemini', transcriptionModel: 'gemini-3.5-flash' },
			image: { visionModel: 'o3-mini' },
			video: { frameExtraction: { visionModel: 'gemini-2.5-pro' } },
		});
		expect(out).toEqual({
			ai: { provider: 'openai', model: 'gpt-5.6-terra' },
			audio: { transcriptionProvider: 'gemini', transcriptionModel: 'gemini-3.6-flash' },
			image: { visionModel: 'gpt-5.6-sol' },
			video: { frameExtraction: { visionModel: 'gemini-3.8-flash' } },
		});
	});

	it('leaves current ids, empty values and missing sections untouched', () => {
		const raw = { ai: { model: 'gpt-6-luna' }, image: { visionModel: '' }, video: 'bogus' };
		expect(replaceRetiredModels(structuredClone(raw))).toEqual(raw);
		expect(replaceRetiredModels({})).toEqual({});
	});

	it('only maps to ids that are still offered', () => {
		const offered = new Set([
			...Object.values(MODEL_OPTIONS).flatMap((m) => Object.keys(m)),
			...Object.values(TRANSCRIPTION_MODEL_OPTIONS).flatMap((m) => Object.keys(m)),
		]);
		for (const [retired, replacement] of Object.entries(RETIRED_MODEL_REPLACEMENTS)) {
			expect(offered.has(retired)).toBe(false);
			expect(offered.has(replacement)).toBe(true);
		}
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

describe('retired GPT-4o models — to:6 migration', () => {
	it('repoints gpt-4o and gpt-4o-mini for a user already on v5', () => {
		const raw = { settingsVersion: 5, ai: { model: 'gpt-4o' }, image: { visionModel: 'gpt-4o-mini' } };
		const out = migrateSettings(raw, 5);
		expect(out.ai).toEqual({ model: 'gpt-6-luna' });
		expect(out.image).toEqual({ visionModel: 'gpt-6-luna' });
	});
});

describe('dropSamplingSettings — to:5 migration', () => {
	it('removes temperature and maxTokens', () => {
		const out = dropSamplingSettings({ ai: { temperature: 0.7, maxTokens: 2048, cacheResponses: false } });
		expect(out.ai).toEqual({ cacheResponses: false });
	});

	it('keeps caching on for a user who was on temperature 0', () => {
		const out = dropSamplingSettings({ ai: { temperature: 0, maxTokens: 2048, cacheResponses: false } });
		expect(out.ai).toEqual({ cacheResponses: true });
	});

	it('tolerates a missing ai object and is idempotent', () => {
		expect(dropSamplingSettings({})).toEqual({});
		const once = dropSamplingSettings({ ai: { temperature: 0 } });
		expect(dropSamplingSettings(structuredClone(once))).toEqual(once);
	});
});

describe('moveTranscriptionKeys — to:7 migration', () => {
	it('moves each transcription key into the shared vendor keys', () => {
		const raw = {
			ai: { provider: 'anthropic', apiKey: 'sk-ant' },
			audio: { whisperApiKey: 'sk-oa', geminiApiKey: 'AIza', deepgramApiKey: 'dg', language: 'en' },
		};
		expect(moveTranscriptionKeys(raw)).toEqual({
			ai: { provider: 'anthropic', apiKey: 'sk-ant', providerKeys: { openai: 'sk-oa', gemini: 'AIza', deepgram: 'dg' } },
			audio: { language: 'en' },
		});
	});

	it('fills the main key for the default vendor only when it is empty', () => {
		expect(moveTranscriptionKeys({ ai: { provider: 'openai', apiKey: '' }, audio: { whisperApiKey: 'sk-w' } }).ai)
			.toEqual({ provider: 'openai', apiKey: 'sk-w', providerKeys: {} });
		expect(moveTranscriptionKeys({ ai: { provider: 'openai', apiKey: 'sk-main' }, audio: { whisperApiKey: 'sk-w' } }).ai)
			.toEqual({ provider: 'openai', apiKey: 'sk-main', providerKeys: { openai: 'sk-w' } });
		expect(moveTranscriptionKeys({ ai: { provider: 'openai', apiKey: 'sk-main' }, audio: { whisperApiKey: 'sk-main' } }).ai)
			.toEqual({ provider: 'openai', apiKey: 'sk-main', providerKeys: {} });
	});

	it('never overwrites an existing per-vendor key', () => {
		const raw = { ai: { provider: 'anthropic', providerKeys: { gemini: 'AIza-kept' } }, audio: { geminiApiKey: 'AIza-old' } };
		expect(moveTranscriptionKeys(raw).ai).toEqual({ provider: 'anthropic', providerKeys: { gemini: 'AIza-kept' } });
	});

	it('tolerates a missing audio section and is idempotent', () => {
		expect(moveTranscriptionKeys({})).toEqual({});
		const once = moveTranscriptionKeys({ ai: {}, audio: { deepgramApiKey: 'dg' } });
		expect(moveTranscriptionKeys(structuredClone(once))).toEqual(once);
	});
});

describe('normalizeEfforts — to:8 migration', () => {
	it('maps none and minimal to low and xhigh to high, for the default and every override', () => {
		const raw = {
			ai: {
				effort: 'xhigh',
				overrides: {
					tidy: { provider: 'openai', model: 'gpt-6-luna', effort: 'none' },
					rem: { provider: 'gemini', model: 'gemini-3.6-flash', effort: 'minimal' },
					title: { provider: 'anthropic', model: 'haiku', effort: 'max' },
					summarize: { provider: 'anthropic', model: 'opus' },
				},
			},
		};
		expect(normalizeEfforts(raw)).toEqual({
			ai: {
				effort: 'high',
				overrides: {
					tidy: { provider: 'openai', model: 'gpt-6-luna', effort: 'low' },
					rem: { provider: 'gemini', model: 'gemini-3.6-flash', effort: 'low' },
					title: { provider: 'anthropic', model: 'haiku', effort: 'max' },
					summarize: { provider: 'anthropic', model: 'opus' },
				},
			},
		});
	});

	it('leaves Default and missing sections alone', () => {
		expect(normalizeEfforts({ ai: { effort: '' } })).toEqual({ ai: { effort: '' } });
		expect(normalizeEfforts({})).toEqual({});
	});
});

describe('retired Gemini 3.1 Flash Lite', () => {
	it('moves to 3.5 Flash Lite in the default model and in overrides', () => {
		const raw = {
			ai: { model: 'gemini-3.1-flash-lite', overrides: { tidy: { provider: 'gemini', model: 'gemini-3.1-flash-lite' } } },
		};
		expect(replaceRetiredModels(raw).ai).toEqual({
			model: 'gemini-3.5-flash-lite',
			overrides: { tidy: { provider: 'gemini', model: 'gemini-3.5-flash-lite' } },
		});
	});
});
