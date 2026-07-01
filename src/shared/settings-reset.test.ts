import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { sectionHasReset, applySectionReset, applyResetAll } from './settings-reset';

/** A fresh, independent copy of shipped defaults to mutate per test. */
function freshSettings(): SynapseSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

describe('sectionHasReset', () => {
	it('is true for every section key except about', () => {
		const withReset = [
			'ai', 'autoAccept', 'exclusions', 'general', 'elaboration', 'intake',
			'image', 'audio', 'video', 'enrichment', 'summarize', 'tidy', 'organize',
			'deepDive', 'title', 'rem',
		];
		for (const key of withReset) {
			expect(sectionHasReset(key)).toBe(true);
		}
	});

	it('is false for the about section (it hosts the global reset instead)', () => {
		expect(sectionHasReset('about')).toBe(false);
	});
});

describe('applySectionReset — 1:1 top-level subtrees', () => {
	it('restores a feature subtree wholesale (elaboration)', () => {
		const s = freshSettings();
		s.elaboration.enabled = false;
		s.elaboration.proposalFolderPath = 'custom/path';
		s.elaboration.detection.minWordThreshold = 999;

		applySectionReset(s, 'elaboration');

		expect(s.elaboration).toEqual(DEFAULT_SETTINGS.elaboration);
	});

	it('maps the deepDive key to the deepDive subtree', () => {
		const s = freshSettings();
		s.deepDive.maxDepth = 99;
		s.deepDive.nestingMode = 'flat';

		applySectionReset(s, 'deepDive');

		expect(s.deepDive).toEqual(DEFAULT_SETTINGS.deepDive);
	});

	it('restores the global config subtrees (autoAccept, exclusions)', () => {
		const s = freshSettings();
		s.autoAccept.rem = true;
		s.exclusions = [{ pattern: 'Archive/**', features: 'all' }];

		applySectionReset(s, 'autoAccept');
		applySectionReset(s, 'exclusions');

		expect(s.autoAccept).toEqual(DEFAULT_SETTINGS.autoAccept);
		expect(s.exclusions).toEqual(DEFAULT_SETTINGS.exclusions);
	});

	it('does not alias DEFAULT_SETTINGS (mutating a reset result is safe)', () => {
		const s = freshSettings();
		s.elaboration.enabled = false;

		applySectionReset(s, 'elaboration');
		// Mutate the freshly-restored subtree in place…
		s.elaboration.detection.excludeTags.push('mutated');
		s.elaboration.enabled = false;

		// …the shared DEFAULT_SETTINGS constant is untouched.
		expect(DEFAULT_SETTINGS.elaboration.detection.excludeTags).toEqual(['no-elaborate']);
		expect(DEFAULT_SETTINGS.elaboration.enabled).toBe(true);
	});
});

describe('applySectionReset — audio (scoped: keep credentials)', () => {
	it('restores the four behavior fields but PRESERVES the six credential/provider fields', () => {
		const s = freshSettings();
		// Behavior customizations (owned by the Audio section)…
		s.audio.enabled = false;
		s.audio.language = 'es';
		s.audio.autoFormatLyrics = false;
		s.audio.postProcessing.removeFiller = false;
		// …and credential/provider customizations (owned by AI configuration).
		s.audio.transcriptionProvider = 'deepgram';
		s.audio.whisperApiKey = 'sk-whisper';
		s.audio.deepgramApiKey = 'dg-key';
		s.audio.geminiApiKey = 'gm-key';
		s.audio.whisperModel = 'whisper-large';
		s.audio.localWhisperPath = '/opt/whisper';

		applySectionReset(s, 'audio');

		// Behavior restored to defaults…
		expect(s.audio.enabled).toBe(DEFAULT_SETTINGS.audio.enabled);
		expect(s.audio.language).toBe(DEFAULT_SETTINGS.audio.language);
		expect(s.audio.autoFormatLyrics).toBe(DEFAULT_SETTINGS.audio.autoFormatLyrics);
		expect(s.audio.postProcessing).toEqual(DEFAULT_SETTINGS.audio.postProcessing);
		// …credentials/provider left exactly as the user set them.
		expect(s.audio.transcriptionProvider).toBe('deepgram');
		expect(s.audio.whisperApiKey).toBe('sk-whisper');
		expect(s.audio.deepgramApiKey).toBe('dg-key');
		expect(s.audio.geminiApiKey).toBe('gm-key');
		expect(s.audio.whisperModel).toBe('whisper-large');
		expect(s.audio.localWhisperPath).toBe('/opt/whisper');
	});

	it('clones postProcessing so the reset result does not alias DEFAULT_SETTINGS', () => {
		const s = freshSettings();
		s.audio.postProcessing.customPrompt = 'x';

		applySectionReset(s, 'audio');
		s.audio.postProcessing.customPrompt = 'mutated';

		expect(DEFAULT_SETTINGS.audio.postProcessing.customPrompt).toBe('');
	});
});

describe('applySectionReset — ai (restores ai + audio credentials)', () => {
	it('restores the ai group and the six audio credential/provider fields', () => {
		const s = freshSettings();
		s.ai.provider = 'anthropic';
		s.ai.apiKey = 'sk-ai';
		s.ai.temperature = 0.1;
		s.audio.transcriptionProvider = 'deepgram';
		s.audio.whisperApiKey = 'sk-whisper';
		s.audio.deepgramApiKey = 'dg-key';
		s.audio.geminiApiKey = 'gm-key';
		s.audio.whisperModel = 'whisper-large';
		s.audio.localWhisperPath = '/opt/whisper';
		// A behavior field the AI reset must NOT touch.
		s.audio.language = 'es';

		applySectionReset(s, 'ai');

		expect(s.ai).toEqual(DEFAULT_SETTINGS.ai);
		expect(s.audio.transcriptionProvider).toBe(DEFAULT_SETTINGS.audio.transcriptionProvider);
		expect(s.audio.whisperApiKey).toBe('');
		expect(s.audio.deepgramApiKey).toBe('');
		expect(s.audio.geminiApiKey).toBe('');
		expect(s.audio.whisperModel).toBe(DEFAULT_SETTINGS.audio.whisperModel);
		expect(s.audio.localWhisperPath).toBe('');
		// Audio behavior is out of scope for an AI reset.
		expect(s.audio.language).toBe('es');
	});

	it('does not alias DEFAULT_SETTINGS.ai', () => {
		const s = freshSettings();
		applySectionReset(s, 'ai');
		s.ai.apiKey = 'mutated';
		expect(DEFAULT_SETTINGS.ai.apiKey).toBe('');
	});
});

describe('applySectionReset — general (two cross-cutting fields only)', () => {
	it('restores autoFoldProperties and enableUpdateNotifications, nothing else', () => {
		const s = freshSettings();
		s.ui.autoFoldProperties = true;
		s.updates.enableUpdateNotifications = false;
		// Bookkeeping the general reset must leave alone.
		s.ui.collapsedSections = { audio: true };
		s.updates.lastUpdateCheck = 12345;
		s.updates.dismissedUpdateVersion = '9.9.9';

		applySectionReset(s, 'general');

		expect(s.ui.autoFoldProperties).toBe(DEFAULT_SETTINGS.ui.autoFoldProperties);
		expect(s.updates.enableUpdateNotifications).toBe(
			DEFAULT_SETTINGS.updates.enableUpdateNotifications,
		);
		// Untouched:
		expect(s.ui.collapsedSections).toEqual({ audio: true });
		expect(s.updates.lastUpdateCheck).toBe(12345);
		expect(s.updates.dismissedUpdateVersion).toBe('9.9.9');
	});
});

describe('applyResetAll', () => {
	it('restores every subtree to defaults', () => {
		const s = freshSettings();
		s.ai.apiKey = 'sk';
		s.elaboration.enabled = false;
		s.audio.deepgramApiKey = 'dg';
		s.exclusions = [];

		const result = applyResetAll(s);

		expect(result.ai).toEqual(DEFAULT_SETTINGS.ai);
		expect(result.elaboration).toEqual(DEFAULT_SETTINGS.elaboration);
		expect(result.audio).toEqual(DEFAULT_SETTINGS.audio);
		expect(result.exclusions).toEqual(DEFAULT_SETTINGS.exclusions);
	});

	it('preserves the five install-bookkeeping fields', () => {
		const s = freshSettings();
		s.settingsVersion = 3;
		s.onboarding.hasSeenWelcome = true;
		s.ui.collapsedSections = { audio: true, ai: false };
		s.updates.lastUpdateCheck = 999;
		s.updates.dismissedUpdateVersion = '2.0.0';
		// A non-bookkeeping updates field that must be reset.
		s.updates.enableUpdateNotifications = false;

		const result = applyResetAll(s);

		expect(result.settingsVersion).toBe(3);
		expect(result.onboarding.hasSeenWelcome).toBe(true);
		expect(result.ui.collapsedSections).toEqual({ audio: true, ai: false });
		expect(result.updates.lastUpdateCheck).toBe(999);
		expect(result.updates.dismissedUpdateVersion).toBe('2.0.0');
		expect(result.updates.enableUpdateNotifications).toBe(
			DEFAULT_SETTINGS.updates.enableUpdateNotifications,
		);
	});

	it('omits the optional updates fields when the source lacks them', () => {
		// DEFAULT_SETTINGS.updates omits lastUpdateCheck / dismissedUpdateVersion.
		const result = applyResetAll(freshSettings());
		expect(result.updates.lastUpdateCheck).toBeUndefined();
		expect(result.updates.dismissedUpdateVersion).toBeUndefined();
	});

	it('does not mutate the source settings', () => {
		const s = freshSettings();
		s.ai.apiKey = 'sk';
		applyResetAll(s);
		expect(s.ai.apiKey).toBe('sk');
	});

	it('does not alias DEFAULT_SETTINGS', () => {
		const result = applyResetAll(freshSettings());
		result.ai.apiKey = 'mutated';
		result.ui.collapsedSections['x'] = true;
		expect(DEFAULT_SETTINGS.ai.apiKey).toBe('');
		expect(DEFAULT_SETTINGS.ui.collapsedSections).toEqual({});
	});

	it('clones collapsedSections so later edits do not reach the source', () => {
		const s = freshSettings();
		s.ui.collapsedSections = { audio: true };
		const result = applyResetAll(s);
		result.ui.collapsedSections['audio'] = false;
		expect(s.ui.collapsedSections).toEqual({ audio: true });
	});
});
