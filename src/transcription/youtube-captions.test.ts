import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
	fetchYouTubeTranscript,
	extractJsonAfterMarker,
	extractCaptionTracks,
	selectCaptionTrack,
	collectJson3Cues,
	parseChaptersFromDescription,
	formatCaptionTranscript,
} from './youtube-captions';
import type { CaptionCue } from './youtube-captions';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../__mocks__/obsidian';

/**
 * The `requestUrl` mock viewed with a precise async signature (same pattern as
 * src/shared/tweet-fetcher.test.ts): the shared mock is loosely typed, and the
 * view lets stubs return partial responses with only the fields read here.
 */
const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<
	(params: RequestUrlParam | string) => Promise<Partial<RequestUrlResponse>>
>;

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Build a player response with the given caption tracks. */
function playerResponse(
	tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }>,
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		captions: {
			playerCaptionsTracklistRenderer: { captionTracks: tracks },
		},
		videoDetails: { title: 'Test Video' },
		playabilityStatus: { status: 'OK' },
		...overrides,
	};
}

/** Wrap a player response in watch-page HTML the way YouTube embeds it. */
function watchPageHtml(player: Record<string, unknown>): string {
	return (
		'<html><head><title>Test</title></head><body>' +
		`<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script>` +
		'</body></html>'
	);
}

/** A minimal json3 timedtext payload. */
function json3(events: Array<Record<string, unknown>>): string {
	return JSON.stringify({ wireMagic: 'pb3', events });
}

const SIMPLE_EVENTS = [
	{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world' }] },
	{ tStartMs: 2000, aAppend: 1, segs: [{ utf8: ' world' }] },
	{ tStartMs: 4000, dDurationMs: 1000 },
	{ tStartMs: 5000, segs: [{ utf8: 'it&#39;s fine' }] },
];

/** Stub the two requests of a successful Innertube-primary run. */
function stubInnertubeSuccess(
	player: Record<string, unknown>,
	trackBody: string
): void {
	mockRequestUrl.mockImplementation((params) => {
		const url = typeof params === 'string' ? params : params.url;
		if (url.includes('/youtubei/v1/player')) {
			return Promise.resolve({ status: 200, text: JSON.stringify(player) });
		}
		return Promise.resolve({ status: 200, text: trackBody });
	});
}

beforeEach(() => {
	mockRequestUrl.mockReset();
});

describe('fetchYouTubeTranscript', () => {
	it('returns a cleaned transcript via the primary Innertube ANDROID attempt', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en', kind: 'asr' },
		]);
		stubInnertubeSuccess(player, json3(SIMPLE_EVENTS));

		const result = await fetchYouTubeTranscript(WATCH_URL, ['en']);

		// The 3s silence between the cues becomes a paragraph break.
		expect(result).toEqual({
			text: "hello world\n\nit's fine",
			language: 'en',
			auto: true,
			title: 'Test Video',
			structured: false,
		});
		const innertubeCall = mockRequestUrl.mock.calls.find(([params]) => {
			const url = typeof params === 'string' ? params : params.url;
			return url.includes('/youtubei/v1/player');
		});
		const body = JSON.parse((innertubeCall![0] as RequestUrlParam).body as string) as {
			videoId: string;
			context: { client: { clientName: string } };
		};
		expect(body.videoId).toBe('dQw4w9WgXcQ');
		expect(body.context.client.clientName).toBe('ANDROID');
	});

	it('requests the track in json3 format', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
		]);
		stubInnertubeSuccess(player, json3(SIMPLE_EVENTS));

		await fetchYouTubeTranscript(WATCH_URL, ['en']);

		const trackCall = mockRequestUrl.mock.calls
			.map(([params]) => (typeof params === 'string' ? params : params.url))
			.find((url) => url.includes('timedtext'));
		expect(trackCall).toContain('fmt=json3');
	});

	it('falls back to the watch page when Innertube rejects (retired client version)', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
		]);
		mockRequestUrl.mockImplementation((params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('/youtubei/v1/player')) {
				return Promise.reject(new Error('400 FAILED_PRECONDITION'));
			}
			if (url.includes('/watch?v=')) {
				return Promise.resolve({ status: 200, text: watchPageHtml(player) });
			}
			return Promise.resolve({ status: 200, text: json3(SIMPLE_EVENTS) });
		});

		const result = await fetchYouTubeTranscript(WATCH_URL, ['en']);
		expect(result?.text).toBe("hello world\n\nit's fine");
	});

	it('falls back to the watch page when Innertube returns an error payload without tracks', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
		]);
		mockRequestUrl.mockImplementation((params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('/youtubei/v1/player')) {
				return Promise.resolve({ status: 200, text: '{"error":{"code":400}}' });
			}
			if (url.includes('/watch?v=')) {
				return Promise.resolve({ status: 200, text: watchPageHtml(player) });
			}
			return Promise.resolve({ status: 200, text: json3(SIMPLE_EVENTS) });
		});

		const result = await fetchYouTubeTranscript(WATCH_URL, ['en']);
		expect(result?.text).toBe("hello world\n\nit's fine");
	});

	it('returns null when neither attempt yields caption tracks', async () => {
		const noTracks = playerResponse([], { playabilityStatus: { status: 'LOGIN_REQUIRED' } });
		mockRequestUrl.mockImplementation((params) => {
			const url = typeof params === 'string' ? params : params.url;
			if (url.includes('/watch?v=')) {
				return Promise.resolve({ status: 200, text: watchPageHtml(noTracks) });
			}
			return Promise.resolve({ status: 200, text: JSON.stringify(noTracks) });
		});

		expect(await fetchYouTubeTranscript(WATCH_URL, ['en'])).toBeNull();
	});

	it('returns null on an empty timedtext body (POT enforcement)', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
		]);
		stubInnertubeSuccess(player, '');

		expect(await fetchYouTubeTranscript(WATCH_URL, ['en'])).toBeNull();
	});

	it('returns null on a malformed timedtext body', async () => {
		const player = playerResponse([
			{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
		]);
		stubInnertubeSuccess(player, '<transcript>not json</transcript>');

		expect(await fetchYouTubeTranscript(WATCH_URL, ['en'])).toBeNull();
	});

	it('returns null for a non-YouTube URL without any request', async () => {
		expect(
			await fetchYouTubeTranscript('https://www.tiktok.com/@user/video/123', ['en'])
		).toBeNull();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('throws on a URL rejected by sanitizeUrl', async () => {
		await expect(fetchYouTubeTranscript('not-a-url', ['en'])).rejects.toThrow();
	});
});

describe('extractJsonAfterMarker', () => {
	it('extracts a nested object with braces and escapes inside strings', () => {
		const html = 'var ytInitialPlayerResponse = {"a":{"b":"};\\" tricky"},"c":1};var x = 2;';
		expect(extractJsonAfterMarker(html, 'ytInitialPlayerResponse')).toEqual({
			a: { b: '};" tricky' },
			c: 1,
		});
	});

	it('returns null when the marker is absent', () => {
		expect(extractJsonAfterMarker('<html></html>', 'ytInitialPlayerResponse')).toBeNull();
	});

	it('returns null on an unbalanced object', () => {
		expect(extractJsonAfterMarker('ytInitialPlayerResponse = {"a": {', 'ytInitialPlayerResponse')).toBeNull();
	});
});

describe('extractCaptionTracks', () => {
	it('reads well-formed tracks and drops malformed entries', () => {
		const player = playerResponse([
			{ baseUrl: 'https://x/1', languageCode: 'en', kind: 'asr' },
		]);
		const renderer = (player.captions as Record<string, unknown>)
			.playerCaptionsTracklistRenderer as Record<string, unknown>;
		(renderer.captionTracks as unknown[]).push({ languageCode: 'de' }, 'junk', null);

		expect(extractCaptionTracks(player)).toEqual([
			{ baseUrl: 'https://x/1', languageCode: 'en', kind: 'asr' },
		]);
	});

	it('returns [] for shapes without captions', () => {
		expect(extractCaptionTracks(null)).toEqual([]);
		expect(extractCaptionTracks({})).toEqual([]);
		expect(extractCaptionTracks({ captions: {} })).toEqual([]);
	});
});

describe('selectCaptionTrack', () => {
	const manualEn = { baseUrl: 'm-en', languageCode: 'en' };
	const manualDe = { baseUrl: 'm-de', languageCode: 'de' };
	const asrEn = { baseUrl: 'a-en', languageCode: 'en', kind: 'asr' };
	const asrEs = { baseUrl: 'a-es', languageCode: 'es', kind: 'asr' };

	it('prefers a manual track in the preferred language', () => {
		expect(selectCaptionTrack([asrEn, manualDe, manualEn], ['en'])).toBe(manualEn);
	});

	it('prefers a preferred-language ASR track over a wrong-language manual track', () => {
		expect(selectCaptionTrack([asrEn, manualDe], ['en'])).toBe(asrEn);
	});

	it('falls back to any manual track when no language matches', () => {
		expect(selectCaptionTrack([asrEs, manualDe], ['fr'])).toBe(manualDe);
	});

	it('falls back to a preferred-language ASR track', () => {
		expect(selectCaptionTrack([asrEs, asrEn], ['en'])).toBe(asrEn);
	});

	it('falls back to the first track when nothing matches', () => {
		expect(selectCaptionTrack([asrEs], ['fr'])).toBe(asrEs);
	});

	it('matches regional variants in both directions', () => {
		const enUs = { baseUrl: 'm-en-us', languageCode: 'en-US' };
		expect(selectCaptionTrack([manualDe, enUs], ['en'])).toBe(enUs);
		expect(selectCaptionTrack([manualDe, manualEn], ['en-GB'])).toBe(manualEn);
	});

	it('walks the preference list in order', () => {
		expect(selectCaptionTrack([manualDe, manualEn], ['', 'de', 'en'])).toBe(manualDe);
	});
});

describe('collectJson3Cues', () => {
	it('produces timed cues, skipping append and blank filler events', () => {
		const payload = JSON.parse(json3(SIMPLE_EVENTS)) as unknown;
		expect(collectJson3Cues(payload)).toEqual([
			{ startMs: 0, endMs: 2000, text: 'hello world' },
			{ startMs: 5000, endMs: 5000, text: "it's fine" },
		]);
	});

	it('decodes entities and collapses whitespace/newline segments', () => {
		const payload = {
			events: [
				{ tStartMs: 10, dDurationMs: 5, segs: [{ utf8: 'line one\n' }, { utf8: '  line &amp; two ' }] },
				{ tStartMs: 20, dDurationMs: 5, segs: [{ utf8: '\n' }] },
			],
		};
		expect(collectJson3Cues(payload)).toEqual([
			{ startMs: 10, endMs: 15, text: 'line one line & two' },
		]);
	});

	it('returns [] for non-json3 shapes', () => {
		expect(collectJson3Cues(null)).toEqual([]);
		expect(collectJson3Cues({})).toEqual([]);
		expect(collectJson3Cues({ events: 'nope' })).toEqual([]);
	});
});

describe('parseChaptersFromDescription', () => {
	const DESCRIPTION = [
		'Kara and Scott discuss the week.',
		'',
		'00:00 Intro',
		'05:11 First Topic',
		'1:01:30 - Late Topic',
		'',
		'Follow us at https://example.com',
	].join('\n');

	it('parses MM:SS and H:MM:SS chapter lines', () => {
		expect(parseChaptersFromDescription(DESCRIPTION)).toEqual([
			{ title: 'Intro', startMs: 0 },
			{ title: 'First Topic', startMs: 311_000 },
			{ title: 'Late Topic', startMs: 3_690_000 },
		]);
	});

	it('requires at least two chapters', () => {
		expect(parseChaptersFromDescription('00:00 Only one')).toEqual([]);
		expect(parseChaptersFromDescription('no chapters here')).toEqual([]);
	});

	it('rejects non-ascending timestamps (not a chapter list)', () => {
		expect(
			parseChaptersFromDescription('05:00 Later\n00:30 Earlier')
		).toEqual([]);
	});
});

describe('formatCaptionTranscript', () => {
	const VIDEO_ID = 'dQw4w9WgXcQ';

	function cue(startMs: number, text: string, durationMs = 1000): CaptionCue {
		return { startMs, endMs: startMs + durationMs, text };
	}

	it('splits >> speaker markers into turn paragraphs (structured)', () => {
		const cues = [
			cue(0, "This isn't a story about Mitch McConnell."),
			cue(2000, '>> Hi everyone, this is Pivot. >> And'),
			cue(4000, "I'm Scott Galloway."),
		];
		const { text, structured } = formatCaptionTranscript(cues, [], VIDEO_ID);
		expect(structured).toBe(true);
		expect(text).toBe(
			"This isn't a story about Mitch McConnell.\n\n" +
				'Hi everyone, this is Pivot.\n\n' +
				"And I'm Scott Galloway."
		);
	});

	it('weaves chapter headings in as timestamp links', () => {
		const cues = [
			cue(0, '>> Welcome back. >> Glad to be here.'),
			cue(310_000, '>> Now the big story.'),
		];
		const chapters = [
			{ title: 'Intro', startMs: 0 },
			{ title: 'Big [Story]', startMs: 305_000 },
		];
		const { text, structured } = formatCaptionTranscript(cues, chapters, VIDEO_ID);
		expect(structured).toBe(true);
		expect(text).toContain('### [Intro](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0)');
		expect(text).toContain('### [Big Story](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=305)');
		expect(text.indexOf('Big Story')).toBeGreaterThan(text.indexOf('Glad to be here.'));
		expect(text.indexOf('Now the big story.')).toBeGreaterThan(text.indexOf('Big Story'));
	});

	it('paragraphs marker-less ASR at pauses (not structured)', () => {
		const cues = [
			cue(0, 'first thought', 2000),
			cue(2100, 'continues here', 1000),
			cue(6000, 'after a long pause'),
		];
		const { text, structured } = formatCaptionTranscript(cues, [], VIDEO_ID);
		expect(structured).toBe(false);
		expect(text).toBe('first thought continues here\n\nafter a long pause');
	});

	it('force-breaks unreadably long marker-less paragraphs at a cue boundary', () => {
		const long = 'x'.repeat(400);
		const cues = [cue(0, long), cue(1100, long), cue(2200, 'tail')];
		const { text } = formatCaptionTranscript(cues, [], VIDEO_ID);
		expect(text.split('\n\n').length).toBe(2);
		expect(text.endsWith('tail')).toBe(true);
	});

	it('a single stray >> is not treated as dialogue', () => {
		const cues = [cue(0, 'plain text >> once only')];
		const { structured } = formatCaptionTranscript(cues, [], VIDEO_ID);
		expect(structured).toBe(false);
	});
});
