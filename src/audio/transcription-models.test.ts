import { describe, it, expect } from 'vitest';
import {
	hasTranscriptionModelOptions,
	resolveTranscriptionModel,
	transcriptionModelOptions,
	whisperResponseFormat,
} from './transcription-models';
import { DEFAULT_SETTINGS, TRANSCRIPTION_MODEL_OPTIONS } from '../settings';
import type { TranscriptionProvider } from '../settings';

const PROVIDERS: TranscriptionProvider[] = ['whisper-api', 'deepgram', 'gemini', 'local-whisper'];

describe('TRANSCRIPTION_MODEL_OPTIONS registry shape (#521)', () => {
	it('is keyed by exactly the transcriptionProvider union members', () => {
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS).sort()).toEqual([...PROVIDERS].sort());
	});

	it('maps every model ID to a non-empty display name', () => {
		for (const provider of PROVIDERS) {
			for (const [id, label] of Object.entries(TRANSCRIPTION_MODEL_OPTIONS[provider])) {
				expect(id.length).toBeGreaterThan(0);
				expect(label.length).toBeGreaterThan(0);
			}
		}
	});

	it('offers models for every implemented provider and none for local-whisper', () => {
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS['whisper-api']).length).toBeGreaterThan(0);
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS.deepgram).length).toBeGreaterThan(0);
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS.gemini).length).toBeGreaterThan(0);
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS['local-whisper'])).toEqual([]);
	});

	it('lists the default transcriptionModel under the default provider', () => {
		const options = TRANSCRIPTION_MODEL_OPTIONS[DEFAULT_SETTINGS.audio.transcriptionProvider];
		expect(Object.keys(options)).toContain(DEFAULT_SETTINGS.audio.transcriptionModel);
	});

	it('pins an explicit Deepgram model so requests never ride the vendor default', () => {
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS.deepgram)).toContain('nova-3-general');
	});

	it('excludes gemini-3.5-transcribe, which needs the Interactions API not generateContent', () => {
		expect(Object.keys(TRANSCRIPTION_MODEL_OPTIONS.gemini)).not.toContain('gemini-3.5-transcribe');
	});
});

describe('transcriptionModelOptions / hasTranscriptionModelOptions (#521)', () => {
	it('returns the registry block for a provider', () => {
		expect(transcriptionModelOptions('gemini')).toBe(TRANSCRIPTION_MODEL_OPTIONS.gemini);
	});

	it('reports local-whisper as having no options so the dropdown is suppressed', () => {
		expect(hasTranscriptionModelOptions('local-whisper')).toBe(false);
		expect(hasTranscriptionModelOptions('whisper-api')).toBe(true);
		expect(hasTranscriptionModelOptions('deepgram')).toBe(true);
		expect(hasTranscriptionModelOptions('gemini')).toBe(true);
	});
});

describe('resolveTranscriptionModel (#521)', () => {
	it('keeps a saved model that belongs to the active provider', () => {
		expect(resolveTranscriptionModel('deepgram', 'nova-2-meeting')).toBe('nova-2-meeting');
	});

	it('falls back to the first option when the saved model belongs to another provider', () => {
		const first = Object.keys(TRANSCRIPTION_MODEL_OPTIONS.deepgram)[0];
		expect(resolveTranscriptionModel('deepgram', 'whisper-1')).toBe(first);
	});

	it('falls back to the first option when no model is saved', () => {
		expect(resolveTranscriptionModel('whisper-api', undefined)).toBe('whisper-1');
		expect(resolveTranscriptionModel('whisper-api', '')).toBe('whisper-1');
	});

	it('resolves the incumbent Gemini pin by default', () => {
		expect(resolveTranscriptionModel('gemini', undefined)).toBe('gemini-3.5-flash');
	});

	it('returns an empty string for a provider with no options', () => {
		expect(resolveTranscriptionModel('local-whisper', 'whisper-1')).toBe('');
	});
});

describe('whisperResponseFormat (#521)', () => {
	it('asks for verbose_json only for whisper-1, which alone returns segments', () => {
		expect(whisperResponseFormat('whisper-1')).toBe('verbose_json');
	});

	it('falls back to json for the GPT transcription models, which reject verbose_json', () => {
		expect(whisperResponseFormat('gpt-transcribe')).toBe('json');
		expect(whisperResponseFormat('gpt-4o-transcribe')).toBe('json');
		expect(whisperResponseFormat('gpt-4o-mini-transcribe')).toBe('json');
	});
});
