import { UrlDetectionResult } from './types';

const YOUTUBE_REGEX =
	/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/;
const TIKTOK_REGEX =
	/tiktok\.com\/@[\w.-]+\/video\/(\d+)/;

export function detectPlatform(url: string): UrlDetectionResult | null {
	const ytMatch = url.match(YOUTUBE_REGEX);
	if (ytMatch) {
		return { platform: 'youtube', videoId: ytMatch[1], url };
	}

	const ttMatch = url.match(TIKTOK_REGEX);
	if (ttMatch) {
		return { platform: 'tiktok', videoId: ttMatch[1], url };
	}

	return null;
}

export function isSupportedUrl(url: string): boolean {
	return detectPlatform(url) !== null;
}
