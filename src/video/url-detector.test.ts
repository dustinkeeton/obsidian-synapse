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
