import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, MODEL_OPTIONS } from './settings';
import type { AIProvider } from './settings';
import { PROPOSAL_KINDS } from './views/types';

describe('autoAccept settings (#228)', () => {
	it('defines an autoAccept flag for every proposal kind', () => {
		const keys = Object.keys(DEFAULT_SETTINGS.autoAccept).sort();
		expect(keys).toEqual([...PROPOSAL_KINDS].sort());
	});

	it('defaults every auto-accept flag to false (opt-in)', () => {
		for (const kind of PROPOSAL_KINDS) {
			expect(DEFAULT_SETTINGS.autoAccept[kind]).toBe(false);
		}
	});

	it('has no extra keys beyond the known proposal kinds', () => {
		expect(Object.keys(DEFAULT_SETTINGS.autoAccept)).toHaveLength(PROPOSAL_KINDS.length);
	});

	it('exposes exactly the six expected proposal kinds', () => {
		expect([...PROPOSAL_KINDS]).toEqual([
			'elaboration',
			'enrichment',
			'organize',
			'deep-dive',
			'title',
			'rem',
		]);
	});
});

describe('Gemini provider settings (#251)', () => {
	it('offers Gemini model options including flash and pro classes', () => {
		const ids = Object.keys(MODEL_OPTIONS.gemini);
		expect(ids).toContain('gemini-3.5-flash');
		expect(ids).toContain('gemini-2.5-pro');
	});

	it('keeps a non-empty model list for every AI provider', () => {
		const providers: AIProvider[] = ['openai', 'anthropic', 'gemini', 'ollama'];
		expect(Object.keys(MODEL_OPTIONS).sort()).toEqual([...providers].sort());
		for (const provider of providers) {
			expect(Object.keys(MODEL_OPTIONS[provider]).length).toBeGreaterThan(0);
		}
	});

	it('defaults the dedicated Gemini transcription key to empty', () => {
		expect(DEFAULT_SETTINGS.audio.geminiApiKey).toBe('');
	});

	it('enables lyric auto-formatting by default (#234)', () => {
		expect(DEFAULT_SETTINGS.audio.autoFormatLyrics).toBe(true);
	});
});

describe('onboarding settings (#89)', () => {
	it('defaults hasSeenWelcome to false so the first run is greeted', () => {
		expect(DEFAULT_SETTINGS.onboarding.hasSeenWelcome).toBe(false);
	});
});

describe('exclusions settings (#307)', () => {
	it('protects .synapse and templates from every feature by default', () => {
		expect(DEFAULT_SETTINGS.exclusions).toEqual([
			{ pattern: '.synapse/**', features: 'all' },
			{ pattern: 'templates/**', features: 'all' },
		]);
	});

	it('no longer carries a per-module excludeFolders field', () => {
		const modules: Array<Record<string, unknown>> = [
			DEFAULT_SETTINGS.elaboration.detection as unknown as Record<string, unknown>,
			DEFAULT_SETTINGS.enrichment as unknown as Record<string, unknown>,
			DEFAULT_SETTINGS.summarize as unknown as Record<string, unknown>,
			DEFAULT_SETTINGS.organize as unknown as Record<string, unknown>,
			DEFAULT_SETTINGS.deepDive as unknown as Record<string, unknown>,
		];
		for (const m of modules) {
			expect(m).not.toHaveProperty('excludeFolders');
		}
	});

	it('retains per-module excludeTags', () => {
		expect(DEFAULT_SETTINGS.elaboration.detection.excludeTags).toContain('no-elaborate');
		expect(DEFAULT_SETTINGS.enrichment.excludeTags).toContain('no-enrich');
		expect(DEFAULT_SETTINGS.summarize.excludeTags).toContain('no-summarize');
		expect(DEFAULT_SETTINGS.organize.excludeTags).toContain('no-organize');
		expect(DEFAULT_SETTINGS.deepDive.excludeTags).toContain('no-deep-dive');
	});
});
