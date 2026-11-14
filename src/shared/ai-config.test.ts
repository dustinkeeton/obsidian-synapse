import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { aiRequestTimeoutMs, anthropicMaxTokens, apiKeyForProvider, effortFor, effortStepsFor, switchDefaultProvider, effortWireValue, extraProviders, hasEffortControl, resolveAIConfig, transcriptionKeyProvider, visionModelOverride } from './ai-config';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.ai.provider = 'anthropic';
	settings.ai.model = 'opus';
	settings.ai.apiKey = 'default-key';
	mutate?.(settings);
	return settings;
}

describe('resolveAIConfig', () => {
	it('returns the default provider, model and key without a feature', () => {
		expect(resolveAIConfig(makeSettings())).toMatchObject({ provider: 'anthropic', model: 'opus', apiKey: 'default-key' });
	});

	it('applies a feature override with that provider key', () => {
		const s = makeSettings((x) => {
			x.ai.providerKeys = { openai: 'openai-key' };
			x.ai.overrides = { title: { provider: 'openai', model: 'gpt-6-luna' } };
		});
		expect(resolveAIConfig(s, 'title')).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'openai-key' });
		expect(resolveAIConfig(s, 'tidy')).toMatchObject({ provider: 'anthropic', model: 'opus' });
	});

	it('uses the main key when an override names the default provider', () => {
		const s = makeSettings((x) => {
			x.ai.overrides = { rem: { provider: 'anthropic', model: 'haiku' } };
		});
		expect(resolveAIConfig(s, 'rem')).toMatchObject({ model: 'haiku', apiKey: 'default-key' });
	});

	it('ignores an incomplete override', () => {
		const s = makeSettings((x) => {
			x.ai.overrides = { rem: { provider: 'openai', model: '' } };
		});
		expect(resolveAIConfig(s, 'rem').provider).toBe('anthropic');
	});
});

describe('apiKeyForProvider', () => {
	it('returns an empty key for an unconfigured or Ollama provider', () => {
		const s = makeSettings();
		expect(apiKeyForProvider(s, 'gemini')).toBe('');
		expect(apiKeyForProvider(s, 'ollama')).toBe('');
	});
});

describe('visionModelOverride', () => {
	it('returns the legacy vision model only when image has no override', () => {
		const s = makeSettings((x) => {
			x.image.visionModel = 'sonnet';
		});
		expect(visionModelOverride(s)).toBe('sonnet');
		s.ai.overrides = { image: { provider: 'gemini', model: 'gemini-3.8-flash' } };
		expect(visionModelOverride(s)).toBeUndefined();
	});
});

describe('extraProviders', () => {
	it('lists each non-default override provider once', () => {
		const s = makeSettings((x) => {
			x.audio.transcriptionProvider = 'local-whisper';
			x.ai.overrides = {
				'deep-dive': { provider: 'gemini', model: 'gemini-4-argon' },
				summarize: { provider: 'gemini', model: 'gemini-3.6-flash' },
				tidy: { provider: 'anthropic', model: 'haiku' },
				image: { provider: 'ollama', model: 'gemma4' },
			};
		});
		expect(extraProviders(s)).toEqual(['gemini', 'ollama']);
	});

	it('adds the transcription vendor unless it is the default provider', () => {
		const s = makeSettings((x) => {
			x.ai.provider = 'anthropic';
			x.audio.transcriptionProvider = 'deepgram';
		});
		expect(extraProviders(s)).toEqual(['deepgram']);
		s.ai.provider = 'openai';
		s.audio.transcriptionProvider = 'whisper-api';
		expect(extraProviders(s)).toEqual([]);
	});
});

describe('transcription keys', () => {
	it('maps each transcription provider to the vendor key it uses', () => {
		expect(transcriptionKeyProvider('whisper-api')).toBe('openai');
		expect(transcriptionKeyProvider('gemini')).toBe('gemini');
		expect(transcriptionKeyProvider('deepgram')).toBe('deepgram');
		expect(transcriptionKeyProvider('local-whisper')).toBeUndefined();
	});

	it('shares one key per vendor between chat and transcription', () => {
		const s = makeSettings((x) => {
			x.ai.provider = 'anthropic';
			x.ai.apiKey = 'sk-ant';
			x.ai.providerKeys = { openai: 'sk-oa', deepgram: 'dg' };
		});
		expect(apiKeyForProvider(s, 'openai')).toBe('sk-oa');
		expect(apiKeyForProvider(s, 'deepgram')).toBe('dg');
		s.ai.provider = 'openai';
		s.ai.apiKey = 'sk-main';
		expect(apiKeyForProvider(s, 'openai')).toBe('sk-main');
	});
});

describe('effort resolution', () => {
	it('uses the default effort for features without an override', () => {
		const s = makeSettings((x) => {
			x.ai.effort = 'high';
		});
		expect(resolveAIConfig(s, 'tidy').effort).toBe('high');
	});

	it('uses the override effort, not the default, for an overridden feature', () => {
		const s = makeSettings((x) => {
			x.ai.effort = 'high';
			x.ai.overrides = {
				'deep-dive': { provider: 'anthropic', model: 'fable', effort: 'max' },
				title: { provider: 'anthropic', model: 'haiku' },
			};
		});
		expect(resolveAIConfig(s, 'deep-dive').effort).toBe('max');
		expect(resolveAIConfig(s, 'title').effort).toBeUndefined();
	});

	it('drops the effort for a model without an effort control', () => {
		expect(effortFor('ollama', 'llama3', 'high')).toBeUndefined();
		expect(effortFor('gemini', 'gemini-3.6-flash', 'low')).toBe('low');
		expect(hasEffortControl('ollama', 'llama3.2')).toBe(false);
		expect(hasEffortControl('ollama', 'qwen3.5')).toBe(true);
	});

	it.each([
		['anthropic', 'opus', 'max', 'max'],
		['openai', 'gpt-6.1-sol', 'low', 'low'],
		['gemini', 'gemini-3.8-flash', 'max', 'HIGH'],
		['ollama', 'gpt-oss', 'max', 'high'],
		['ollama', 'deepseek-r1', 'low', false],
		['ollama', 'gemma4', 'medium', undefined],
	] as const)('clamps %s %s effort %s to %s', (provider, model, effort, wire) => {
		expect(effortWireValue(provider, model, effort)).toBe(wire);
	});

	it('sends nothing for Default', () => {
		expect(effortWireValue('anthropic', 'opus', undefined)).toBeUndefined();
	});

	it('caps Anthropic output by effort', () => {
		expect(anthropicMaxTokens(undefined)).toBe(16384);
		expect(anthropicMaxTokens('medium')).toBe(16384);
		expect(anthropicMaxTokens('high')).toBe(21333);
		expect(anthropicMaxTokens('max')).toBe(21333);
	});

	it('gives a reasoning model 10 minutes, including at Default, and 2 minutes at Low', () => {
		expect(aiRequestTimeoutMs('anthropic', 'opus', undefined)).toBe(600_000);
		expect(aiRequestTimeoutMs('anthropic', 'opus', 'medium')).toBe(600_000);
		expect(aiRequestTimeoutMs('anthropic', 'opus', 'max')).toBe(600_000);
		expect(aiRequestTimeoutMs('anthropic', 'opus', 'low')).toBe(120_000);
		expect(aiRequestTimeoutMs('ollama', 'qwen3.8', undefined)).toBe(600_000);
		expect(aiRequestTimeoutMs('ollama', 'qwen3.8', 'low')).toBe(120_000);
	});

	it('keeps 2 minutes for a model with no effort control', () => {
		expect(aiRequestTimeoutMs('ollama', 'llama3.2', undefined)).toBe(120_000);
	});

	it('lists only the steps that send something', () => {
		expect(effortStepsFor('anthropic', 'opus')).toEqual(['low', 'medium', 'high', 'max']);
		expect(effortStepsFor('ollama', 'qwen3.8')).toEqual(['low']);
		expect(effortStepsFor('ollama', 'llama3.2')).toEqual([]);
		expect(effortFor('ollama', 'qwen3.8', 'high')).toBeUndefined();
		expect(effortFor('ollama', 'qwen3.8', 'low')).toBe('low');
	});
});

describe('switchDefaultProvider', () => {
	it('swaps keys so each vendor keeps its own for chat and transcription', () => {
		const s = makeSettings((x) => { x.ai.providerKeys = { openai: 'openai-key' }; });

		switchDefaultProvider(s.ai, 'openai');

		expect(s.ai.provider).toBe('openai');
		expect(resolveAIConfig(s).apiKey).toBe('openai-key');
		expect(apiKeyForProvider(s, 'openai')).toBe('openai-key');
		expect(apiKeyForProvider(s, 'anthropic')).toBe('default-key');
		expect(s.ai.providerKeys).toEqual({ anthropic: 'default-key' });
	});

	it('leaves the main key blank when the new default has no saved key', () => {
		const s = makeSettings();
		switchDefaultProvider(s.ai, 'gemini');
		expect(s.ai.apiKey).toBe('');
		expect(apiKeyForProvider(s, 'anthropic')).toBe('default-key');
	});

	it('keeps keys when switching to and from Ollama', () => {
		const s = makeSettings();
		switchDefaultProvider(s.ai, 'ollama');
		expect(s.ai.apiKey).toBe('');
		switchDefaultProvider(s.ai, 'anthropic');
		expect(s.ai.apiKey).toBe('default-key');
		expect(s.ai.providerKeys).toEqual({});
	});
});
