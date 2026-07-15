import { describe, it, expect, vi } from 'vitest';

// The post-processor is mocked at the module boundary (same pattern as
// lyrics-reformat.test.ts); schema reformat stays inert because the text
// below never matches the lyrics schema.
vi.mock('./post-processor', () => ({
	PostProcessor: class {
		process = vi.fn(async (t: string) => (t.includes('fail') ? Promise.reject(new Error('no AI key')) : `cleaned: ${t}`));
	},
}));

import { AudioModule } from './index';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

function makeModule(): AudioModule {
	return new AudioModule(
		{} as never,
		() => ({ audio: { autoFormatLyrics: false, transcriptionProvider: 'whisper-api' } }) as never,
		{ info: vi.fn() } as never,
		createMockCheckpointManager() as never,
		undefined
	);
}

describe('AudioModule.processTranscriptText (#184)', () => {
	it('runs a transcript string through the post-processing pipeline', async () => {
		const result = await makeModule().processTranscriptText('caption text');
		expect(result.text).toBe('cleaned: caption text');
		expect(result.reformatted).toBeUndefined();
	});

	it('propagates post-processing failures (callers choose the fallback)', async () => {
		await expect(makeModule().processTranscriptText('this will fail')).rejects.toThrow('no AI key');
	});
});
