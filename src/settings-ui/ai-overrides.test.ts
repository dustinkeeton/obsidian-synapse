import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import {
	DEFAULT_CHOICE,
	decodeModelChoice,
	effortChoiceOptions,
	encodeModelChoice,
	isAllowedOllamaEndpoint,
	modelChoiceOptions,
	providerModelOptions,
	withOverride,
} from './ai-overrides';

describe('model choice encoding', () => {
	it('round-trips a provider/model pair', () => {
		const choice = encodeModelChoice({ provider: 'gemini', model: 'gemini-4-argon' });
		expect(decodeModelChoice(choice)).toEqual({ provider: 'gemini', model: 'gemini-4-argon' });
	});

	it('decodes the default and unknown choices to no override', () => {
		expect(decodeModelChoice(DEFAULT_CHOICE)).toBeUndefined();
		expect(decodeModelChoice('gemini:retired-model')).toBeUndefined();
		expect(decodeModelChoice('nope:opus')).toBeUndefined();
	});
});

describe('modelChoiceOptions', () => {
	it('leads with the default and lists every provider model', () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const options = modelChoiceOptions(settings);
		expect(Object.keys(options)[0]).toBe(DEFAULT_CHOICE);
		expect(options[DEFAULT_CHOICE]).toBe('Default (Anthropic · Claude Opus)');
		expect(options['openai:gpt-6-luna']).toBe('OpenAI · GPT-6 Luna');
		expect(options['ollama:gemma4']).toBe('Ollama (Local) · Gemma 4');
	});
});

describe('withOverride', () => {
	it('sets and clears without mutating the input map', () => {
		const original = {};
		const set = withOverride(original, 'title', { provider: 'openai', model: 'gpt-6-luna' });
		expect(set).toEqual({ title: { provider: 'openai', model: 'gpt-6-luna' } });
		expect(original).toEqual({});
		expect(withOverride(set, 'title', undefined)).toEqual({});
	});

	it('stores no effort key when the effort is the model default', () => {
		expect(withOverride({}, 'rem', { provider: 'anthropic', model: 'haiku', effort: undefined })).toEqual({
			rem: { provider: 'anthropic', model: 'haiku' },
		});
	});
});

describe('effortChoiceOptions', () => {
	it.each([['gemini', 'gemini-4-argon'], ['anthropic', 'opus'], ['ollama', 'gpt-oss']] as const)(
		'offers the same five steps for %s %s',
		(provider, model) => {
			expect(effortChoiceOptions(provider, model)).toEqual({
				'': 'Default',
				low: 'Low',
				medium: 'Medium',
				high: 'High',
				max: 'Max',
			});
		}
	);

	it('offers only Default and Low for an on/off thinking model', () => {
		expect(effortChoiceOptions('ollama', 'qwen3.6')).toEqual({ '': 'Default', low: 'Low' });
	});

	it('returns undefined for a model without an effort parameter', () => {
		expect(effortChoiceOptions('ollama', 'llama3')).toBeUndefined();
	});
});

describe('isAllowedOllamaEndpoint', () => {
	it('allows HTTPS anywhere and HTTP only on localhost', () => {
		expect(isAllowedOllamaEndpoint('https://ollama.example.com')).toBe(true);
		expect(isAllowedOllamaEndpoint('http://localhost:11434')).toBe(true);
		expect(isAllowedOllamaEndpoint('http://ollama.example.com')).toBe(false);
		expect(isAllowedOllamaEndpoint('not a url')).toBe(false);
	});
});

describe('saved Ollama models that are no longer listed', () => {
	it('keeps a saved default Ollama tag as an extra option, but not a cloud id', () => {
		expect(providerModelOptions('ollama', 'llama4')).toMatchObject({ llama4: 'llama4', gemma4: 'Gemma 4' });
		expect(providerModelOptions('ollama', 'gemma4')).not.toHaveProperty('llama4');
		expect(providerModelOptions('gemini', 'gemini-3.1-flash-lite')).not.toHaveProperty(['gemini-3.1-flash-lite']);
	});

	it('keeps a saved Ollama override selectable and decodable', () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ai.overrides = { tidy: { provider: 'ollama', model: 'mistral' } };
		expect(modelChoiceOptions(settings)['ollama:mistral']).toBe('Ollama (Local) · mistral');
		expect(decodeModelChoice('ollama:mistral')).toEqual({ provider: 'ollama', model: 'mistral' });
	});
});
