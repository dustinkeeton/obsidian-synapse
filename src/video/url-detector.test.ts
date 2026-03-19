import { describe, it, expect } from 'vitest';
import { detectPlatform, isSupportedUrl } from './url-detector';

describe('detectPlatform', () => {
	describe('YouTube URLs', () => {
		it('matches standard watch URL', () => {
			const result = detectPlatform('https://youtube.com/watch?v=dQw4w9WgXcQ');
			expect(result).toEqual({
				platform: 'youtube',
				videoId: 'dQw4w9WgXcQ',
				url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
			});
		});

		it('matches short URL', () => {
			const result = detectPlatform('https://youtu.be/dQw4w9WgXcQ');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches Shorts URL', () => {
			const result = detectPlatform('https://youtube.com/shorts/dQw4w9WgXcQ');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches URL with extra query params', () => {
			const result = detectPlatform('https://youtube.com/watch?v=dQw4w9WgXcQ&t=120');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches video ID with hyphens and underscores', () => {
			const result = detectPlatform('https://youtube.com/watch?v=abc_DEF-123');
			expect(result?.videoId).toBe('abc_DEF-123');
		});

		it('matches when v= is not the first query param', () => {
			const result = detectPlatform('https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches when v= is after multiple query params', () => {
			const result = detectPlatform('https://youtube.com/watch?list=PLxxx&index=3&v=abc123');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('abc123');
		});

		it('matches embed URL', () => {
			const result = detectPlatform('https://youtube.com/embed/dQw4w9WgXcQ');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches live URL', () => {
			const result = detectPlatform('https://youtube.com/live/dQw4w9WgXcQ');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('dQw4w9WgXcQ');
		});

		it('matches www.youtube.com embed URL', () => {
			const result = detectPlatform('https://www.youtube.com/embed/abc_DEF-123');
			expect(result?.platform).toBe('youtube');
			expect(result?.videoId).toBe('abc_DEF-123');
		});
	});

	describe('TikTok URLs', () => {
		it('matches full video URL', () => {
			const result = detectPlatform('https://www.tiktok.com/@username/video/1234567890123456789');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('1234567890123456789');
		});

		it('matches username with dots and hyphens', () => {
			const result = detectPlatform('https://tiktok.com/@user.name-123/video/9876543210');
			expect(result?.platform).toBe('tiktok');
		});

		it('matches short share URL (/t/)', () => {
			const result = detectPlatform('https://www.tiktok.com/t/ZTh7nJafa/');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('short-url');
		});

		it('matches vm.tiktok.com short URL', () => {
			const result = detectPlatform('https://vm.tiktok.com/ZMxxxxxxx/');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('short-url');
		});

		it('matches vt.tiktok.com short URL', () => {
			const result = detectPlatform('https://vt.tiktok.com/ZSxxxxxxx/');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('short-url');
		});

		it('strips query params from full video URL', () => {
			const result = detectPlatform(
				'https://www.tiktok.com/@username/video/1234567890123456789?is_from_webapp=1&sender_device=pc&web_id=7890'
			);
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('1234567890123456789');
			expect(result?.url).toBe('https://www.tiktok.com/@username/video/1234567890123456789');
		});

		it('strips query params from short share URL', () => {
			const result = detectPlatform(
				'https://www.tiktok.com/t/ZTh7nJafa/?refer=creator'
			);
			expect(result?.platform).toBe('tiktok');
			expect(result?.url).toBe('https://www.tiktok.com/t/ZTh7nJafa/');
		});

		it('strips fragment from TikTok URL', () => {
			const result = detectPlatform(
				'https://www.tiktok.com/@user/video/123456789#some-fragment'
			);
			expect(result?.url).toBe('https://www.tiktok.com/@user/video/123456789');
		});

		it('strips query params from vm.tiktok.com URL', () => {
			const result = detectPlatform(
				'https://vm.tiktok.com/ZMxxxxxxx/?sender_device=mobile'
			);
			expect(result?.url).toBe('https://vm.tiktok.com/ZMxxxxxxx/');
		});

		it('matches URL with locale prefix', () => {
			const result = detectPlatform('https://www.tiktok.com/en/@user/video/1234567890');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('1234567890');
		});

		it('matches URL with locale-country prefix', () => {
			const result = detectPlatform('https://www.tiktok.com/es-MX/@user/video/1234567890');
			expect(result?.platform).toBe('tiktok');
			expect(result?.videoId).toBe('1234567890');
		});
	});

	describe('unsupported URLs', () => {
		it('returns null for vimeo', () => {
			expect(detectPlatform('https://vimeo.com/123456')).toBeNull();
		});

		it('returns null for generic URL', () => {
			expect(detectPlatform('https://example.com')).toBeNull();
		});

		it('returns null for empty string', () => {
			expect(detectPlatform('')).toBeNull();
		});

		it('returns null for non-URL', () => {
			expect(detectPlatform('not-a-url')).toBeNull();
		});

		it('returns null for YouTube channel (no video)', () => {
			expect(detectPlatform('https://youtube.com/channel/UCxxxx')).toBeNull();
		});
	});
});

describe('isSupportedUrl', () => {
	it('returns true for supported URLs', () => {
		expect(isSupportedUrl('https://youtube.com/watch?v=abc123')).toBe(true);
		expect(isSupportedUrl('https://tiktok.com/t/ZTxxxxx/')).toBe(true);
	});

	it('returns false for unsupported URLs', () => {
		expect(isSupportedUrl('https://example.com')).toBe(false);
		expect(isSupportedUrl('')).toBe(false);
	});
});
