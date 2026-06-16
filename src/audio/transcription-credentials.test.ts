import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { createEl } from '../__mocks__/obsidian';
import { renderTranscriptionCredentials } from './transcription-credentials';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import type { SettingsSectionContext } from '../shared';

/**
 * Build a `body` element + a spy {@link SettingsSectionContext} for rendering
 * {@link renderTranscriptionCredentials} in isolation.
 *
 * The Obsidian mock no-ops `Setting.addDropdown`/`addText` (their callbacks
 * never run), so these tests can only assert that every conditional branch
 * renders without throwing — they cannot inspect dropdown/input DOM or fire
 * `onChange`. The combos below exercise each provider branch and the
 * AI-provider coupling (whisper-api+openai hides the Whisper key; gemini+gemini
 * hides the Gemini key).
 */
function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const rerender = vi.fn();
	const plugin = { settings, saveSettings, manifest: { version: '0.0.0-test' } };
	const body = createEl();
	const ctx = {
		containerEl: body,
		plugin: plugin as never,
		featureSection: vi.fn(() => createEl()),
		configSection: vi.fn(() => createEl()),
		rerender,
	} as unknown as SettingsSectionContext;
	return { ctx, body, plugin, saveSettings, rerender };
}

describe('renderTranscriptionCredentials', () => {
	it('renders the whisper-api provider without throwing (AI provider OpenAI hides the Whisper key)', () => {
		const { ctx, body } = makeCtx((s) => {
			s.audio.transcriptionProvider = 'whisper-api';
			s.ai.provider = 'openai';
		});
		expect(() => renderTranscriptionCredentials(body, ctx)).not.toThrow();
	});

	it('renders the whisper-api provider without throwing (non-OpenAI AI provider shows the Whisper key)', () => {
		const { ctx, body } = makeCtx((s) => {
			s.audio.transcriptionProvider = 'whisper-api';
			s.ai.provider = 'anthropic';
		});
		expect(() => renderTranscriptionCredentials(body, ctx)).not.toThrow();
	});

	it('renders the gemini provider without throwing (AI provider Gemini hides the Gemini key)', () => {
		const { ctx, body } = makeCtx((s) => {
			s.audio.transcriptionProvider = 'gemini';
			s.ai.provider = 'gemini';
		});
		expect(() => renderTranscriptionCredentials(body, ctx)).not.toThrow();
	});

	it('renders the gemini provider without throwing (non-Gemini AI provider shows the Gemini key)', () => {
		const { ctx, body } = makeCtx((s) => {
			s.audio.transcriptionProvider = 'gemini';
			s.ai.provider = 'openai';
		});
		expect(() => renderTranscriptionCredentials(body, ctx)).not.toThrow();
	});

	it('renders the deepgram provider without throwing (always shows the Deepgram key)', () => {
		const { ctx, body } = makeCtx((s) => {
			s.audio.transcriptionProvider = 'deepgram';
		});
		expect(() => renderTranscriptionCredentials(body, ctx)).not.toThrow();
	});
});
