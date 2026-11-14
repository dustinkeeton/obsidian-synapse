import { describe, it, expect, vi } from 'vitest';
import { createEl } from '../__mocks__/obsidian';
import { renderTranscriptionSetting } from './transcription-setting';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import type { SettingsSectionContext } from '../shared';

function makeCtx(mutate?: (s: SynapseSettings) => void) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	const plugin = { settings, saveSettings: vi.fn().mockResolvedValue(undefined), manifest: { version: '0.0.0-test' } };
	const body = createEl();
	const ctx = { containerEl: body, plugin: plugin as never, rerender: vi.fn() } as unknown as SettingsSectionContext;
	return { ctx, body };
}

describe('renderTranscriptionSetting', () => {
	it.each(['whisper-api', 'deepgram', 'gemini', 'local-whisper'] as const)('renders for %s without throwing', (provider) => {
		const { ctx, body } = makeCtx((s) => { s.audio.transcriptionProvider = provider; });
		expect(() => renderTranscriptionSetting(body, ctx)).not.toThrow();
	});
});
