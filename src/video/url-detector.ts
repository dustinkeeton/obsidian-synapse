import { UrlDetectionResult } from './types';

const YOUTUBE_REGEX =
	/(?:youtube\.com\/watch\?(?:[^#\s]*?&)?v=|youtu\.be\/|youtube\.com\/(?:shorts|embed|live)\/)([a-zA-Z0-9_-]+)/;
// Full TikTok URL: tiktok.com/@user/video/123 (with optional locale prefix like /en/)
const TIKTOK_VIDEO_REGEX =
	/tiktok\.com\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?@[\w.-]+\/video\/(\d+)/;
// Short/share TikTok URLs: tiktok.com/t/..., vm.tiktok.com/..., vt.tiktok.com/...
const TIKTOK_SHORT_REGEX =
	/(?:vm\.|vt\.)?tiktok\.com\/(?:t\/)?[\w.-]+/;
// Instagram Reels / posts: instagram.com/reel/CODE, /reels/CODE, /p/CODE
const INSTAGRAM_REGEX =
	/instagram\.com\/(?:reel|reels|p)\/([\w-]+)/;
// Twitter/X.com status URLs: twitter.com/<user>/status/<id>, x.com/<user>/status/<id>,
// twitter.com/i/web/status/<id>, with optional www./mobile. prefix
const TWITTER_REGEX =
	/(?:mobile\.)?(?:twitter\.com|x\.com)\/(?:[\w]+\/status|i\/web\/status)\/(\d+)/;

/**
 * Strip query parameters and fragment from TikTok URLs so the canonical
 * form is the bare path (e.g. `https://www.tiktok.com/@user/video/123`).
 */
function stripTikTokParams(url: string): string {
	return url.replace(/[?#].*$/, '');
}

/**
 * Strip query parameters and fragment from Twitter/X.com URLs so the canonical
 * form is the bare path (e.g. `https://x.com/user/status/123`).
 */
function stripTwitterParams(url: string): string {
	return url.replace(/[?#].*$/, '');
}

export function detectPlatform(url: string): UrlDetectionResult | null {
	const ytMatch = url.match(YOUTUBE_REGEX);
	if (ytMatch) {
		return { platform: 'youtube', videoId: ytMatch[1], url };
	}

	const ttVideoMatch = url.match(TIKTOK_VIDEO_REGEX);
	if (ttVideoMatch) {
		return { platform: 'tiktok', videoId: ttVideoMatch[1], url: stripTikTokParams(url) };
	}

	// Short URLs don't contain a video ID — yt-dlp resolves the redirect
	const ttShortMatch = url.match(TIKTOK_SHORT_REGEX);
	if (ttShortMatch) {
		return { platform: 'tiktok', videoId: 'short-url', url: stripTikTokParams(url) };
	}

	const igMatch = url.match(INSTAGRAM_REGEX);
	if (igMatch) {
		return { platform: 'instagram', videoId: igMatch[1], url };
	}

	const twMatch = url.match(TWITTER_REGEX);
	if (twMatch) {
		return { platform: 'twitter', videoId: twMatch[1], url: stripTwitterParams(url) };
	}

	return null;
}

export function isSupportedUrl(url: string): boolean {
	const result = detectPlatform(url);
	return result !== null && result.platform !== 'twitter';
}
