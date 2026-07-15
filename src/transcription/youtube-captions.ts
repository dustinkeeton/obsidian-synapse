import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { detectPlatform, isRecord, parseJson, redactError, sanitizeUrl } from '../shared';

/**
 * YouTube caption extraction (#184) — fetch a video's caption/subtitle track
 * over plain HTTP and clean it into a transcript. Zero external dependencies,
 * so it works identically on desktop and mobile; this is the Tier-1 strategy
 * of URL transcription (see url-transcription.ts).
 *
 * Two attempts, both parsing the same `playerResponse` shape:
 *   A. POST the Innertube `/youtubei/v1/player` endpoint with the ANDROID
 *      client context. This is the PRIMARY attempt: its caption-track URLs
 *      currently work without the proof-of-origin (POT) tokens, whereas the
 *      web watch page's track URLs are POT-gated and return empty bodies
 *      (verified live 2026-07-14).
 *   B. GET the watch page and extract the embedded `ytInitialPlayerResponse`
 *      — the fallback when the pinned ANDROID client version is retired
 *      (YouTube then answers 400 FAILED_PRECONDITION).
 *
 * YouTube's internals are an accepted maintenance surface: every failure mode
 * short of an invalid URL returns `null` (with a console.warn diagnostic) so
 * callers fall through to the next transcription tier — on desktop the yt-dlp
 * pipeline takes over invisibly.
 */

export interface YouTubeTranscript {
	/** Cleaned caption text (timing stripped, segments merged). */
	text: string;
	/** BCP-47 language code of the selected track (e.g. `en`, `en-US`). */
	language: string;
	/** True when the track is YouTube's auto-generated (ASR) captions. */
	auto: boolean;
	/** Video title from the player response, when present. */
	title?: string;
}

/** A caption track as advertised by the player response. */
interface CaptionTrack {
	baseUrl: string;
	languageCode: string;
	/** `'asr'` marks an auto-generated track; manual tracks omit it. */
	kind?: string;
}

/** Hard timeout for each caption-related HTTP request. */
const CAPTION_FETCH_TIMEOUT_MS = 30_000;

/** Browser-like User-Agent so the watch page returns real HTML. */
const WATCH_PAGE_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Consent cookies sent with the watch-page request. In consent-wall regions
 * (notably the EU) youtube.com otherwise responds with an interstitial that
 * carries no player response. `requestUrl` has no cookie jar, so the cookies
 * are sent unconditionally — they are inert where no consent wall exists.
 */
const CONSENT_COOKIE = 'CONSENT=YES+cb.20210328-17-p0.en+FX+678; SOCS=CAI';

/**
 * Pinned Innertube ANDROID client identity — the single place to bump when
 * YouTube retires this client version (the symptom is a 400
 * FAILED_PRECONDITION from the player endpoint). The ANDROID client is used
 * because its caption-track URLs work without proof-of-origin (POT) tokens.
 */
export const INNERTUBE_ANDROID_CLIENT = {
	clientName: 'ANDROID',
	clientVersion: '20.10.38',
	androidSdkVersion: 30,
	userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
} as const;

/** Innertube player endpoint (attempt B). */
const INNERTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

/**
 * Fetch and clean the caption transcript for a YouTube URL.
 *
 * @param url                A YouTube watch/short/embed URL.
 * @param preferredLanguages Language codes in preference order (e.g. the
 *                           user's `audio.language` setting, then `'en'`).
 * @returns The transcript, or `null` when the video has no usable captions or
 *          any fetch/parse step fails. Throws ONLY when `url` fails
 *          {@link sanitizeUrl} validation.
 */
export async function fetchYouTubeTranscript(
	url: string,
	preferredLanguages: string[]
): Promise<YouTubeTranscript | null> {
	const validatedUrl = sanitizeUrl(url);
	const detected = detectPlatform(validatedUrl);
	if (!detected || detected.platform !== 'youtube') {
		return null;
	}

	try {
		// Attempt A: Innertube ANDROID client (primary — its track URLs are
		// not POT-gated). Its failure must never block attempt B.
		let player = await attempt('Innertube player', () =>
			fetchInnertubePlayer(detected.videoId)
		);
		let tracks = extractCaptionTracks(player);

		// Attempt B: watch page. Only useful when A breaks (retired client
		// version); note its track URLs may be POT-gated and fetch empty.
		if (tracks.length === 0) {
			const fallback = await attempt('watch page', () =>
				fetchWatchPagePlayer(detected.videoId)
			);
			const fallbackTracks = extractCaptionTracks(fallback);
			if (fallbackTracks.length > 0) {
				player = fallback;
				tracks = fallbackTracks;
			}
		}

		if (tracks.length === 0) {
			console.warn(
				`[Synapse] No caption tracks for YouTube video ${detected.videoId}` +
					playabilityDiagnostic(player)
			);
			return null;
		}

		const track = selectCaptionTrack(tracks, preferredLanguages);
		const text = await fetchCaptionText(track.baseUrl);
		if (!text) {
			// The known POT-enforcement failure mode is a 200 with an empty body.
			console.warn(`[Synapse] Empty caption track for YouTube video ${detected.videoId}`);
			return null;
		}

		return {
			text,
			language: track.languageCode,
			auto: track.kind === 'asr',
			title: extractVideoTitle(player),
		};
	} catch (error) {
		console.warn('[Synapse] YouTube caption fetch failed:', redactError(error));
		return null;
	}
}

/** Run one fetch attempt, downgrading its failure to a warn + null. */
async function attempt(
	label: string,
	fn: () => Promise<unknown>
): Promise<unknown> {
	try {
		return await fn();
	} catch (error) {
		console.warn(`[Synapse] YouTube caption ${label} attempt failed:`, redactError(error));
		return null;
	}
}

/** requestUrl with the shared hard timeout (mirrors content-fetcher.ts). */
async function fetchWithTimeout(params: RequestUrlParam): Promise<RequestUrlResponse> {
	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(
			() => reject(new Error('Caption fetch timed out')),
			CAPTION_FETCH_TIMEOUT_MS
		)
	);
	return Promise.race([requestUrl(params), timeout]);
}

/** Attempt A: GET the watch page and extract `ytInitialPlayerResponse`. */
async function fetchWatchPagePlayer(videoId: string): Promise<unknown> {
	const response = await fetchWithTimeout({
		url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
		method: 'GET',
		headers: {
			'User-Agent': WATCH_PAGE_USER_AGENT,
			'Accept': 'text/html,application/xhtml+xml',
			'Accept-Language': 'en-US,en;q=0.9',
			'Cookie': CONSENT_COOKIE,
		},
	});
	return extractJsonAfterMarker(response.text, 'ytInitialPlayerResponse');
}

/** Attempt B: POST the Innertube player endpoint as the ANDROID client. */
async function fetchInnertubePlayer(videoId: string): Promise<unknown> {
	const { clientName, clientVersion, androidSdkVersion, userAgent } = INNERTUBE_ANDROID_CLIENT;
	const response = await fetchWithTimeout({
		url: INNERTUBE_PLAYER_URL,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': userAgent,
			'X-Youtube-Client-Name': '3',
			'X-Youtube-Client-Version': clientVersion,
		},
		body: JSON.stringify({
			videoId,
			context: {
				client: { clientName, clientVersion, androidSdkVersion, hl: 'en' },
			},
			contentCheckOk: true,
			racyCheckOk: true,
		}),
	});
	return parseJson(response.text);
}

/**
 * Extract the JSON object assigned right after `marker` in a script-bearing
 * HTML page by balanced-brace scanning (string- and escape-aware). A greedy
 * regex is not safe here: the player response is a huge object with nested
 * braces and embedded `};` sequences inside string values.
 */
export function extractJsonAfterMarker(source: string, marker: string): unknown {
	const markerIdx = source.indexOf(marker);
	if (markerIdx === -1) return null;
	const start = source.indexOf('{', markerIdx);
	if (start === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < source.length; i++) {
		const ch = source[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				try {
					return parseJson(source.slice(start, i + 1));
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/** Read `captions.playerCaptionsTracklistRenderer.captionTracks` defensively. */
export function extractCaptionTracks(player: unknown): CaptionTrack[] {
	if (!isRecord(player)) return [];
	const captions = player.captions;
	if (!isRecord(captions)) return [];
	const renderer = captions.playerCaptionsTracklistRenderer;
	if (!isRecord(renderer)) return [];
	const rawTracks: unknown = renderer.captionTracks;
	if (!Array.isArray(rawTracks)) return [];

	const tracks: CaptionTrack[] = [];
	for (const raw of rawTracks as unknown[]) {
		if (!isRecord(raw)) continue;
		const { baseUrl, languageCode, kind } = raw;
		if (typeof baseUrl !== 'string' || typeof languageCode !== 'string') continue;
		tracks.push({
			baseUrl,
			languageCode,
			kind: typeof kind === 'string' ? kind : undefined,
		});
	}
	return tracks;
}

/** `videoDetails.title`, when the player response carries it. */
function extractVideoTitle(player: unknown): string | undefined {
	if (!isRecord(player)) return undefined;
	const details = player.videoDetails;
	if (!isRecord(details)) return undefined;
	return typeof details.title === 'string' ? details.title : undefined;
}

/**
 * Human-readable `playabilityStatus` fragment for the no-tracks diagnostic —
 * e.g. LOGIN_REQUIRED (age restriction) or UNPLAYABLE, which explain why no
 * captions came back.
 */
function playabilityDiagnostic(player: unknown): string {
	if (!isRecord(player)) return '';
	const status = player.playabilityStatus;
	if (!isRecord(status) || typeof status.status !== 'string') return '';
	return ` (playability: ${status.status})`;
}

/**
 * Pick the best track: a manually-authored track in a preferred language,
 * then an auto-generated (ASR) track in a preferred language, then any manual
 * track, then any ASR track. Language match outranks manual-ness — an ASR
 * transcript the user can read beats a manual one they can't. `tracks` must
 * be non-empty.
 */
export function selectCaptionTrack(
	tracks: CaptionTrack[],
	preferredLanguages: string[]
): CaptionTrack {
	const preferred = preferredLanguages
		.map((lang) => lang.trim().toLowerCase())
		.filter((lang) => lang.length > 0);
	const manual = tracks.filter((t) => t.kind !== 'asr');
	const asr = tracks.filter((t) => t.kind === 'asr');

	for (const pool of [manual, asr]) {
		for (const lang of preferred) {
			const match = pool.find((t) => languageMatches(t.languageCode, lang));
			if (match) return match;
		}
	}
	return manual[0] ?? asr[0] ?? tracks[0];
}

/** `en` matches `en`, `en-US`, `en-GB`; `pt-BR` also matches a bare `pt`. */
function languageMatches(trackLanguage: string, preferred: string): boolean {
	const track = trackLanguage.toLowerCase();
	return (
		track === preferred ||
		track.startsWith(`${preferred}-`) ||
		preferred.startsWith(`${track}-`)
	);
}

/** Fetch a caption track in json3 format and clean it into transcript text. */
async function fetchCaptionText(baseUrl: string): Promise<string | null> {
	const trackUrl = buildTrackUrl(baseUrl);
	if (!trackUrl) return null;

	const response = await fetchWithTimeout({
		url: trackUrl,
		method: 'GET',
		headers: { 'User-Agent': WATCH_PAGE_USER_AGENT },
	});
	if (!response.text || response.text.trim().length === 0) return null;

	let parsed: unknown;
	try {
		parsed = parseJson(response.text);
	} catch {
		return null;
	}
	const text = collectJson3Text(parsed);
	return text.length > 0 ? text : null;
}

/** Force `fmt=json3` onto a track URL; tolerate a protocol-relative/path base. */
function buildTrackUrl(baseUrl: string): string | null {
	const absolute = baseUrl.startsWith('/')
		? `https://www.youtube.com${baseUrl}`
		: baseUrl;
	try {
		const url = new URL(absolute);
		url.searchParams.set('fmt', 'json3');
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Flatten a json3 timedtext payload (`events[].segs[].utf8`) into clean text.
 * Skips `aAppend` continuation events (they duplicate the previous window's
 * trailing text in rolling ASR captions) and events with no segments.
 */
export function collectJson3Text(payload: unknown): string {
	if (!isRecord(payload) || !Array.isArray(payload.events)) return '';

	const parts: string[] = [];
	for (const event of payload.events as unknown[]) {
		if (!isRecord(event)) continue;
		if (event.aAppend === 1) continue;
		if (!Array.isArray(event.segs)) continue;
		let eventText = '';
		for (const seg of event.segs as unknown[]) {
			if (isRecord(seg) && typeof seg.utf8 === 'string') {
				eventText += seg.utf8;
			}
		}
		if (eventText.trim().length > 0) {
			parts.push(eventText);
		}
	}
	return cleanCaptionText(parts.join(' '));
}

/** Decode the entities YouTube emits and collapse whitespace runs. */
function cleanCaptionText(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
