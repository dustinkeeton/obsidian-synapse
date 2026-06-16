import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the transcriber mock factory (lifted above imports) can use it.
const fixtures = vi.hoisted(() => ({
	LYRICS: [
		'[Verse 1]',
		'City lights are calling out my name',
		'Walking down these empty streets again',
		'But I keep moving on',
		'',
		'[Chorus]',
		'We were running through the night',
		'Holding on to something that felt right',
		'We were running through the night',
		'Chasing every star in sight',
		'',
		'[Chorus]',
		'We were running through the night',
		'Holding on to something that felt right',
		'We were running through the night',
		'Chasing every star in sight',
	].join('\n'),
}));

// Transcriber returns a song; post-processor passes the text through unchanged
// so the reformat step sees the lyrics as its input. No network/API calls.
vi.mock('./transcriber', () => ({
	Transcriber: class {
		transcribe = vi.fn(async () => ({ raw: fixtures.LYRICS, sourceName: 'song' }));
	},
	GEMINI_MAX_INLINE_AUDIO_BYTES: 15 * 1024 * 1024,
}));
vi.mock('./post-processor', () => ({
	PostProcessor: class {
		process = vi.fn(async (t: string) => t);
	},
}));

import { AudioModule } from './index';
import { AIClient } from '../shared';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

const REFORMATTED =
	'## Untitled\n**Artist:** Not specified\n\n> [!verse] Verse 1\n> City lights are calling out my name';

function makeModule(autoFormatLyrics: boolean): AudioModule {
	return new AudioModule(
		{} as never,
		() => ({ audio: { autoFormatLyrics, transcriptionProvider: 'whisper-api' } }) as never,
		{ info: vi.fn() } as never,
		createMockCheckpointManager() as never,
		undefined
	);
}

describe('AudioModule.transcribe lyrics reformatting (#234)', () => {
	let completeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		completeSpy = vi.spyOn(AIClient.prototype, 'complete').mockResolvedValue(REFORMATTED);
	});
	afterEach(() => { vi.restoreAllMocks(); });

	it('reformats a detected song and tags the result as lyrics when enabled', async () => {
		const module = makeModule(true);

		const result = await module.transcribe(new ArrayBuffer(8), 'song.mp3');

		// The reformat fired exactly once, driven by the lyrics prompt (system arg).
		expect(completeSpy).toHaveBeenCalledTimes(1);
		expect(completeSpy.mock.calls[0][1]).toContain('[!verse]');
		// processed now holds the reformatted lyrics, tagged for the lyrics callout.
		expect(result.processed).toContain('> [!verse] Verse 1');
		expect(result.reformatted).toBe(true);
		expect(result.schemaId).toBe('lyrics');
	});

	it('does not reformat when autoFormatLyrics is disabled', async () => {
		const module = makeModule(false);

		const result = await module.transcribe(new ArrayBuffer(8), 'song.mp3');

		expect(completeSpy).not.toHaveBeenCalled();
		expect(result.reformatted).toBeUndefined();
		expect(result.schemaId).toBeUndefined();
		// Falls back to the (post-processed) transcript unchanged.
		expect(result.processed).toBe(fixtures.LYRICS);
	});
});
