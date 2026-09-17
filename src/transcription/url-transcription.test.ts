import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from '../__mocks__/obsidian';
import {
	UrlTranscriptionRouter,
	NoTranscriptionPathError,
	buildUrlTranscriptBlock,
} from './url-transcription';
import type { UrlTranscript, UrlTranscriptionStrategy, TranscriptStore } from './url-transcription';
import { NoSpeechDetectedError } from '../shared';
import type { TranscriptCacheEntry } from '../shared';

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

function store(seed: Record<string, TranscriptCacheEntry> = {}): TranscriptStore & {
	get: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
} {
	const entries = new Map(Object.entries(seed));
	return {
		get: vi.fn((url: string, range?: { startSeconds: number; endSeconds: number }) =>
			Promise.resolve(entries.get(range ? `${url}#${range.startSeconds}` : url) ?? null)
		),
		put: vi.fn((url: string, t: Omit<TranscriptCacheEntry, 'url' | 'fetchedAt' | 'lastUsedAt'>, range?: { startSeconds: number }) => {
			entries.set(range ? `${url}#${range.startSeconds}` : url, { ...t, url, fetchedAt: 1, lastUsedAt: 1 });
			return Promise.resolve();
		}),
	};
}

describe('UrlTranscriptionRouter transcript store (#488)', () => {
	it('writes a tier result through to the store', async () => {
		const cache = store();
		const router = new UrlTranscriptionRouter([strategy('captions', { result: transcript({ title: 'T' }) })], cache);

		await router.transcribe(URL);

		expect(cache.put).toHaveBeenCalledWith(
			URL,
			expect.objectContaining({ text: 'processed text', raw: 'raw text', source: 'captions', title: 'T' }),
			undefined
		);
	});

	it('serves a stored transcript without calling any tier', async () => {
		const tier = strategy('captions', { result: transcript() });
		const cache = store();
		const first = new UrlTranscriptionRouter([tier], cache);
		await first.transcribe(URL);
		const update = vi.fn();

		const result = await new UrlTranscriptionRouter([tier], cache).transcribe(URL, { update });

		expect(tier.transcribe).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ text: 'processed text', source: 'captions', cached: true });
		expect(update).toHaveBeenCalledWith('Using cached transcript');
	});

	it('forceRefresh bypasses the store and overwrites the entry', async () => {
		const tier = strategy('captions', { result: transcript({ text: 'fresh' }) });
		const cache = store({ [URL]: { url: URL, text: 'stale', raw: 'stale', source: 'captions', fetchedAt: 1, lastUsedAt: 1 } });
		const router = new UrlTranscriptionRouter([tier], cache);

		const result = await router.transcribe(URL, { forceRefresh: true });

		expect(tier.transcribe).toHaveBeenCalledOnce();
		expect(result.text).toBe('fresh');
		expect(result.cached).toBeUndefined();
		expect(cache.put).toHaveBeenCalledWith(URL, expect.objectContaining({ text: 'fresh' }), undefined);
	});

	it('keys clipped requests on the time range', async () => {
		const tier = strategy('local-extraction', { result: transcript({ source: 'local-extraction' }) });
		const cache = store({ [URL]: { url: URL, text: 'full', raw: 'full', source: 'captions', fetchedAt: 1, lastUsedAt: 1 } });
		const timeRange = { startSeconds: 1, endSeconds: 2 };

		await new UrlTranscriptionRouter([tier], cache).transcribe(URL, { timeRange });

		expect(tier.transcribe).toHaveBeenCalledOnce();
		expect(cache.put).toHaveBeenCalledWith(URL, expect.anything(), timeRange);
	});

	it('stores nothing when a tier reports no speech (#524)', async () => {
		const cache = store();
		const noSpeech = new NoSpeechDetectedError();
		const router = new UrlTranscriptionRouter([strategy('local-extraction', { error: noSpeech })], cache);

		await expect(router.transcribe(URL)).rejects.toBe(noSpeech);
		expect(cache.put).not.toHaveBeenCalled();
	});

	it('never stores or returns text invented over a blank raw transcript (#524)', async () => {
		const cache = store();
		const fabricated = transcript({ raw: '  ', text: 'Quarterly business review: revenue grew 12%.' });
		const router = new UrlTranscriptionRouter([strategy('local-extraction', { result: fabricated })], cache);

		await expect(router.transcribe(URL)).rejects.toBeInstanceOf(NoSpeechDetectedError);
		expect(cache.put).not.toHaveBeenCalled();
	});

	it('ignores a stored entry whose raw transcript is blank (#524)', async () => {
		const tier = strategy('captions', { result: transcript({ text: 'fresh' }) });
		const cache = store({ [URL]: { url: URL, text: 'invented', raw: '', source: 'local-extraction', fetchedAt: 1, lastUsedAt: 1 } });

		const result = await new UrlTranscriptionRouter([tier], cache).transcribe(URL);

		expect(tier.transcribe).toHaveBeenCalledOnce();
		expect(result.text).toBe('fresh');
	});

	it('stores nothing when every tier is exhausted', async () => {
		const cache = store();
		const router = new UrlTranscriptionRouter([strategy('captions', { result: null })], cache);

		await expect(router.transcribe(URL)).rejects.toBeInstanceOf(NoTranscriptionPathError);
		expect(cache.put).not.toHaveBeenCalled();
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
