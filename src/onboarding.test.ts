import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import type { SynapseSettings, AIProvider } from './settings';
import {
	needsApiKey,
	planFirstRun,
	applyApiKeyEmphasis,
	WELCOME_MESSAGE,
	REQUIRED_FIELD_CLASS,
	API_KEY_DESC,
	API_KEY_REQUIRED_DESC,
	API_KEY_NO_SUBSCRIPTION_NOTE,
} from './onboarding';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	return settings;
}

describe('needsApiKey (#89)', () => {
	it('is true for a hosted provider with no key', () => {
		const s = makeSettings((s) => {
			s.ai.provider = 'openai';
			s.ai.apiKey = '';
		});
		expect(needsApiKey(s)).toBe(true);
	});

	it('treats a whitespace-only key as missing', () => {
		const s = makeSettings((s) => {
			s.ai.provider = 'anthropic';
			s.ai.apiKey = '   ';
		});
		expect(needsApiKey(s)).toBe(true);
	});

	it('is false once a hosted provider has a key', () => {
		const s = makeSettings((s) => {
			s.ai.provider = 'gemini';
			s.ai.apiKey = 'real-key';
		});
		expect(needsApiKey(s)).toBe(false);
	});

	it('is false for Ollama even with no key (runs locally)', () => {
		const s = makeSettings((s) => {
			s.ai.provider = 'ollama';
			s.ai.apiKey = '';
		});
		expect(needsApiKey(s)).toBe(false);
	});

	it('flags every hosted provider but never Ollama when the key is empty', () => {
		const hosted: AIProvider[] = ['openai', 'anthropic', 'gemini'];
		for (const provider of hosted) {
			expect(needsApiKey(makeSettings((s) => { s.ai.provider = provider; s.ai.apiKey = ''; }))).toBe(true);
		}
		expect(needsApiKey(makeSettings((s) => { s.ai.provider = 'ollama'; s.ai.apiKey = ''; }))).toBe(false);
	});
});

describe('planFirstRun (#89)', () => {
	it('greets a genuine fresh install that has not seen the welcome', () => {
		const s = makeSettings((s) => { s.onboarding.hasSeenWelcome = false; });
		expect(planFirstRun(s, true)).toEqual({ showWelcome: true, markSeen: true });
	});

	it('marks an upgrading user seen WITHOUT greeting them (has saved data)', () => {
		const s = makeSettings((s) => { s.onboarding.hasSeenWelcome = false; });
		expect(planFirstRun(s, false)).toEqual({ showWelcome: false, markSeen: true });
	});

	it('does nothing once the welcome has already been seen', () => {
		const s = makeSettings((s) => { s.onboarding.hasSeenWelcome = true; });
		expect(planFirstRun(s, true)).toEqual({ showWelcome: false, markSeen: false });
		expect(planFirstRun(s, false)).toEqual({ showWelcome: false, markSeen: false });
	});
});

describe('applyApiKeyEmphasis (#89)', () => {
	function makeTarget() {
		return {
			settingEl: { toggleClass: vi.fn() },
			setDesc: vi.fn(),
		};
	}

	it('adds the required class and emphasised desc when a key is needed', () => {
		const target = makeTarget();
		applyApiKeyEmphasis(target, makeSettings((s) => { s.ai.provider = 'openai'; s.ai.apiKey = ''; }));
		expect(target.settingEl.toggleClass).toHaveBeenCalledWith(REQUIRED_FIELD_CLASS, true);
		expect(target.setDesc).toHaveBeenCalledWith(API_KEY_REQUIRED_DESC);
	});

	it('clears the required class and restores the neutral desc when satisfied', () => {
		const target = makeTarget();
		applyApiKeyEmphasis(target, makeSettings((s) => { s.ai.provider = 'openai'; s.ai.apiKey = 'sk-123'; }));
		expect(target.settingEl.toggleClass).toHaveBeenCalledWith(REQUIRED_FIELD_CLASS, false);
		expect(target.setDesc).toHaveBeenCalledWith(API_KEY_DESC);
	});

	it('never emphasises for the local Ollama provider', () => {
		const target = makeTarget();
		applyApiKeyEmphasis(target, makeSettings((s) => { s.ai.provider = 'ollama'; s.ai.apiKey = ''; }));
		expect(target.settingEl.toggleClass).toHaveBeenCalledWith(REQUIRED_FIELD_CLASS, false);
	});
});

describe('WELCOME_MESSAGE copy (#89)', () => {
	it('omits the "Synapse" brand name (NotificationManager prefixes it)', () => {
		expect(WELCOME_MESSAGE).not.toMatch(/synapse/i);
	});

	it('points the user at the settings and the API key, charged but unhyped', () => {
		expect(WELCOME_MESSAGE.toLowerCase()).toContain('api key');
		expect(WELCOME_MESSAGE.toLowerCase()).toContain('settings');
		// Brand voice: no exclamation points, no emoji (an em dash is fine).
		expect(WELCOME_MESSAGE).not.toContain('!');
		expect(WELCOME_MESSAGE).not.toMatch(/\p{Extended_Pictographic}/u);
	});
});

describe('API_KEY_NO_SUBSCRIPTION_NOTE copy (#364)', () => {
	it('names the three subscription products it rules out', () => {
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).toMatch(/Pro\/Max/);
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).toMatch(/ChatGPT Plus/);
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).toMatch(/Gemini Advanced/);
	});

	it('points to both supported paths — an API key and Ollama', () => {
		expect(API_KEY_NO_SUBSCRIPTION_NOTE.toLowerCase()).toContain('api key');
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).toContain('Ollama');
	});

	it('stays in brand voice: no exclamation points, no emoji', () => {
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).not.toContain('!');
		expect(API_KEY_NO_SUBSCRIPTION_NOTE).not.toMatch(/\p{Extended_Pictographic}/u);
	});
});
