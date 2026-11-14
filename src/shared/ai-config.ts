import { EFFORT_OPTIONS } from '../settings';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './safe-request';
import type { AIFeatureId, AIModelOverride, AIProvider, EffortLevel, EffortWireMap, KeyedProvider, SynapseSettings, TranscriptionProvider } from '../settings';

/**
 * Anthropic requires `max_tokens`; other providers get no cap. Non-streaming requests
 * expected to run past 10 minutes are refused (~21k output tokens), so High and Max
 * stop just under that and the rest stay lower.
 */
export function anthropicMaxTokens(effort: EffortLevel | undefined): number {
	return effort === 'high' || effort === 'max' ? 21333 : 16384;
}

/** High and Max can run up to Anthropic's 10-minute non-streaming limit; the rest keep the 2-minute default. */
export const LONG_AI_REQUEST_TIMEOUT_MS = 600_000;

/** Client-side timeout for one chat request, keyed on effort rather than model. */
export function aiRequestTimeoutMs(effort: EffortLevel | undefined): number {
	return effort === 'high' || effort === 'max' ? LONG_AI_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

/** Every effort step, lowest first. */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'];

/** Every feature that calls the generative AI client, in settings-UI order. */
export const AI_FEATURE_IDS: readonly AIFeatureId[] = [
	'elaboration',
	'enrichment',
	'summarize',
	'tidy',
	'organize',
	'deep-dive',
	'title',
	'rem',
	'illustrate',
	'audio',
	'image',
];

/** The provider, model and credentials one AI call resolves to. */
export interface ResolvedAIConfig {
	provider: AIProvider;
	model: string;
	apiKey: string;
	ollamaEndpoint: string;
	/** Absent when the user chose the model default or the model takes no effort parameter. */
	effort?: EffortLevel;
}

function effortMap(provider: AIProvider, model: string): EffortWireMap | undefined {
	return EFFORT_OPTIONS[provider]?.[model];
}

/** Whether `model` has an effort control; without one, every step sends nothing. */
export function hasEffortControl(provider: AIProvider, model: string): boolean {
	return effortMap(provider, model) !== undefined;
}

/** `effort` when `model` has an effort control, else `undefined` (Default). */
export function effortFor(provider: AIProvider, model: string, effort: EffortLevel | '' | undefined): EffortLevel | undefined {
	return effort && hasEffortControl(provider, model) ? effort : undefined;
}

/** The value to send for `effort` on `model`; `undefined` means omit the field. */
export function effortWireValue(provider: AIProvider, model: string, effort: EffortLevel | undefined): string | false | undefined {
	return effort ? effortMap(provider, model)?.[effort] : undefined;
}

/** The feature's override, or `undefined` when it uses the default provider and model. */
export function aiOverrideFor(settings: SynapseSettings, feature: AIFeatureId | undefined): AIModelOverride | undefined {
	if (!feature) return undefined;
	const override = settings.ai.overrides?.[feature];
	return override && override.provider && override.model ? override : undefined;
}

/** API key for `provider`: the main key when it is the default provider, else its own key. */
export function apiKeyForProvider(settings: SynapseSettings, provider: AIProvider | KeyedProvider): string {
	const { ai } = settings;
	if (provider === ai.provider) return ai.apiKey;
	if (provider === 'ollama') return '';
	return ai.providerKeys?.[provider] ?? '';
}

/** Resolve the provider, model and key a feature's AI calls use. */
export function resolveAIConfig(settings: SynapseSettings, feature?: AIFeatureId): ResolvedAIConfig {
	const { ai } = settings;
	const override = aiOverrideFor(settings, feature);
	const provider = override?.provider ?? ai.provider;
	const model = override?.model ?? ai.model;
	return {
		provider,
		model,
		apiKey: apiKeyForProvider(settings, provider),
		ollamaEndpoint: ai.ollamaEndpoint,
		effort: effortFor(provider, model, override ? override.effort : ai.effort),
	};
}

/** Per-call vision model; an `image` override supersedes the legacy `image.visionModel` setting. */
export function visionModelOverride(settings: SynapseSettings): string | undefined {
	if (aiOverrideFor(settings, 'image')) return undefined;
	return settings.image.visionModel || undefined;
}

/** The vendor whose key a transcription provider uses; `undefined` for local Whisper. */
export function transcriptionKeyProvider(provider: TranscriptionProvider): KeyedProvider | undefined {
	switch (provider) {
		case 'whisper-api': return 'openai';
		case 'gemini': return 'gemini';
		case 'deepgram': return 'deepgram';
		default: return undefined;
	}
}

/** Non-default vendors that a feature override or transcription uses; each needs its own key (or the endpoint, for Ollama). */
export function extraProviders(settings: SynapseSettings): (KeyedProvider | 'ollama')[] {
	const used = new Set<KeyedProvider | 'ollama'>();
	for (const feature of AI_FEATURE_IDS) {
		const override = aiOverrideFor(settings, feature);
		if (override && override.provider !== settings.ai.provider) used.add(override.provider);
	}
	const transcription = transcriptionKeyProvider(settings.audio.transcriptionProvider);
	if (transcription && transcription !== settings.ai.provider) used.add(transcription);
	return [...used];
}
