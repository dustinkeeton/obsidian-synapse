import { TRANSCRIPTION_MODEL_OPTIONS } from '../settings';
import type { TranscriptionProvider } from '../settings';

/**
 * Model resolution for the transcription providers (#521). Kept as pure
 * functions rather than inline in the settings UI: the Obsidian test mock
 * no-ops `Setting.addDropdown`, so logic living in the widget callback is
 * unreachable from tests.
 */

/** The model options offered by `provider`, or `{}` when it has none. */
export function transcriptionModelOptions(
	provider: TranscriptionProvider,
): Record<string, string> {
	return TRANSCRIPTION_MODEL_OPTIONS[provider] ?? {};
}

/** Whether `provider` offers any model choice (false suppresses the dropdown). */
export function hasTranscriptionModelOptions(provider: TranscriptionProvider): boolean {
	return Object.keys(transcriptionModelOptions(provider)).length > 0;
}

/**
 * Resolve the model to use for `provider`, falling back to that provider's
 * first option when `saved` belongs to another provider (or is absent).
 * Returns `''` for a provider with no options.
 */
export function resolveTranscriptionModel(
	provider: TranscriptionProvider,
	saved: string | undefined,
): string {
	const options = transcriptionModelOptions(provider);
	if (saved && saved in options) {
		return saved;
	}
	return Object.keys(options)[0] ?? '';
}

/** Vendor labels for the transcription dropdown; local Whisper is not offered yet. */
const TRANSCRIPTION_PROVIDER_LABELS: Partial<Record<TranscriptionProvider, string>> = {
	'whisper-api': 'OpenAI',
	deepgram: 'Deepgram',
	gemini: 'Google Gemini',
};

export function encodeTranscriptionChoice(provider: TranscriptionProvider, model: string): string {
	return `${provider}:${resolveTranscriptionModel(provider, model)}`;
}

/** Inverse of {@link encodeTranscriptionChoice}; `undefined` for an unknown or hidden choice. */
export function decodeTranscriptionChoice(value: string): { provider: TranscriptionProvider; model: string } | undefined {
	const sep = value.indexOf(':');
	if (sep < 0) return undefined;
	const provider = value.slice(0, sep) as TranscriptionProvider;
	const model = value.slice(sep + 1);
	if (!(provider in TRANSCRIPTION_PROVIDER_LABELS) || !(model in transcriptionModelOptions(provider))) return undefined;
	return { provider, model };
}

/** Every offered transcription provider/model pair, labelled "Vendor · Model". */
export function transcriptionChoiceOptions(): Record<string, string> {
	const options: Record<string, string> = {};
	for (const [provider, label] of Object.entries(TRANSCRIPTION_PROVIDER_LABELS) as [TranscriptionProvider, string][]) {
		for (const [model, modelLabel] of Object.entries(transcriptionModelOptions(provider))) {
			options[encodeTranscriptionChoice(provider, model)] = `${label} · ${modelLabel}`;
		}
	}
	return options;
}

/**
 * The `response_format` to request from the OpenAI transcription endpoint.
 * Only whisper-1 accepts `verbose_json`; the GPT transcription models reject
 * it, so they fall back to plain `json` (no segment timestamps or duration).
 */
export function whisperResponseFormat(model: string): 'verbose_json' | 'json' {
	return model === 'whisper-1' ? 'verbose_json' : 'json';
}
