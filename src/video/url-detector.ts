import { UrlDetectionResult } from './types';

const YOUTUBE_REGEX =
	/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/;
// Full TikTok URL: tiktok.com/@user/video/123
const TIKTOK_VIDEO_REGEX =
	/tiktok\.com\/@[\w.-]+\/video\/(\d+)/;
// Short/share TikTok URLs: tiktok.com/t/..., vm.tiktok.com/..., vt.tiktok.com/...
const TIKTOK_SHORT_REGEX =
	/(?:vm\.|vt\.)?tiktok\.com\/(?:t\/)?[\w.-]+/;

/**
 * Strip query parameters and fragment from TikTok URLs so the canonical
 * form is the bare path (e.g. `https://www.tiktok.com/@user/video/123`).
 */
function stripTikTokParams(url: string): string {
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

	return null;
}

export function isSupportedUrl(url: string): boolean {
	return detectPlatform(url) !== null;
}
