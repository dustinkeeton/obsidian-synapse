import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from '../__mocks__/obsidian';
import {
	UrlTranscriptionRouter,
	NoTranscriptionPathError,
	buildUrlTranscriptBlock,
} from './url-transcription';
import type { UrlTranscript, UrlTranscriptionStrategy } from './url-transcription';

const URL = 'https://www.youtube.com/watch?v=abc123xyz00';

function transcript(overrides: Partial<UrlTranscript> = {}): UrlTranscript {
	return {
		text: 'processed text',
		raw: 'raw text',
		source: 'captions',
		...overrides,
	};
}

function strategy(
	id: string,
	behavior: {
		canHandle?: boolean;
		result?: UrlTranscript | null;
		error?: Error;
	}
): UrlTranscriptionStrategy & { transcribe: ReturnType<typeof vi.fn> } {
	return {
		id,
		canHandle: () => behavior.canHandle ?? true,
		transcribe: vi.fn(() =>
			behavior.error
				? Promise.reject(behavior.error)
				: Promise.resolve(behavior.result ?? null)
		),
	};
}

afterEach(() => {
	Platform.isDesktop = true;
	Platform.isMobile = false;
});

describe('UrlTranscriptionRouter', () => {
	it('returns the first strategy result and never calls later tiers', async () => {
		const first = strategy('captions', { result: transcript() });
		const second = strategy('local-extraction', { result: transcript({ source: 'local-extraction' }) });
		const router = new UrlTranscriptionRouter([first, second]);

		const result = await router.transcribe(URL);

		expect(result.source).toBe('captions');
		expect(second.transcribe).not.toHaveBeenCalled();
	});

	it('falls through on null and on canHandle=false', async () => {
		const inapplicable = strategy('captions', { canHandle: false });
		const empty = strategy('middle', { result: null });
		const winner = strategy('local-extraction', { result: transcript({ source: 'local-extraction' }) });
		const router = new UrlTranscriptionRouter([inapplicable, empty, winner]);

		const result = await router.transcribe(URL);

		expect(result.source).toBe('local-extraction');
		expect(inapplicable.transcribe).not.toHaveBeenCalled();
		expect(empty.transcribe).toHaveBeenCalledOnce();
	});

	it('propagates a strategy throw unchanged (typed errors keep their UX)', async () => {
		const boom = new Error('yt-dlp not found');
		boom.name = 'DependencyMissingError';
		const failing = strategy('local-extraction', { error: boom });
		const never = strategy('after', { result: transcript() });
		const router = new UrlTranscriptionRouter([failing, never]);

		await expect(router.transcribe(URL)).rejects.toBe(boom);
		expect(never.transcribe).not.toHaveBeenCalled();
	});

	it('throws NoTranscriptionPathError with per-tier attempts when exhausted', async () => {
		const inapplicable = strategy('captions', { canHandle: false });
		const empty = strategy('local-extraction', { result: null });
		const router = new UrlTranscriptionRouter([inapplicable, empty]);

		const error = await router.transcribe(URL).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NoTranscriptionPathError);
		const typed = error as NoTranscriptionPathError;
		expect(typed.url).toBe(URL);
		expect(typed.attempts).toEqual([
			'captions: not applicable',
			'local-extraction: unavailable for this video',
		]);
	});

	it('passes options (timeRange, update) through to strategies', async () => {
		const only = strategy('captions', { result: transcript() });
		const router = new UrlTranscriptionRouter([only]);
		const update = vi.fn();
		const timeRange = { startSeconds: 1, endSeconds: 2 };

		await router.transcribe(URL, { timeRange, update });

		expect(only.transcribe).toHaveBeenCalledWith(URL, { timeRange, update });
	});
});

describe('NoTranscriptionPathError', () => {
	it('names the desktop failure with attempt detail', () => {
		Platform.isDesktop = true;
		const error = new NoTranscriptionPathError(URL, ['captions: not applicable']);
		expect(error.message).toContain('No transcription path available');
		expect(error.message).toContain(URL);
		expect(error.message).toContain('captions: not applicable');
	});

	it('explains the desktop/sync handoff on mobile', () => {
		Platform.isDesktop = false;
		Platform.isMobile = true;
		const error = new NoTranscriptionPathError(URL, []);
		expect(error.message).toContain('mobile');
		expect(error.message).toContain('desktop app');
		expect(error.name).toBe('NoTranscriptionPathError');
	});
});

describe('buildUrlTranscriptBlock', () => {
	it('mirrors the desktop VideoModule block shape (embed + collapsed callout)', () => {
		const block = buildUrlTranscriptBlock(
			transcript({ videoVaultPath: 'Media/2026-07-14-video.mp4' }),
			URL,
			true
		);

		expect(block).toBe(
			'\n![[2026-07-14-video.mp4]]\n\n\n' +
				`> [!synapse-transcription]- Transcription of ${URL}\n` +
				'> processed text\n'
		);
	});

	it('omits the embed when disabled or when there is no vault video', () => {
		const withPath = buildUrlTranscriptBlock(
			transcript({ videoVaultPath: 'Media/x.mp4' }),
			URL,
			false
		);
		const withoutPath = buildUrlTranscriptBlock(transcript(), URL, true);

		expect(withPath).not.toContain('![[');
		expect(withoutPath).not.toContain('![[');
	});

	it('appends the time range to the callout title', () => {
		const block = buildUrlTranscriptBlock(transcript(), URL, false, {
			startSeconds: 60,
			endSeconds: 120,
		});
		expect(block).toContain(`Transcription of ${URL} [01:00 – 02:00]`);
	});

	it('emits the lyrics callout for schema-reformatted transcripts', () => {
		const block = buildUrlTranscriptBlock(
			transcript({ reformatted: true, schemaId: 'lyrics' }),
			URL,
			false
		);
		expect(block).toContain(`> [!synapse-lyrics]- Lyrics of ${URL}`);
	});
});
