import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from '../__mocks__/obsidian';
import { LocalExtractionStrategy } from './local-extraction-strategy';
import type { TranscriptionResult } from '../audio';

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=abc123xyz00';
const TIKTOK_URL = 'https://www.tiktok.com/@user/video/123';

function extractionResult(
	overrides: Partial<TranscriptionResult & { videoVaultPath?: string }> = {}
): TranscriptionResult & { videoVaultPath?: string } {
	return {
		raw: 'raw transcript',
		processed: 'processed transcript',
		sourceName: 'A Video',
		language: 'en',
		...overrides,
	};
}

afterEach(() => {
	Platform.isDesktop = true;
	Platform.isMobile = false;
});

describe('LocalExtractionStrategy.canHandle', () => {
	it('accepts supported URLs on desktop', () => {
		const strategy = new LocalExtractionStrategy(vi.fn());
		expect(strategy.canHandle(YOUTUBE_URL)).toBe(true);
		expect(strategy.canHandle(TIKTOK_URL)).toBe(true);
	});

	it('declines everything on mobile', () => {
		Platform.isDesktop = false;
		Platform.isMobile = true;
		const strategy = new LocalExtractionStrategy(vi.fn());
		expect(strategy.canHandle(YOUTUBE_URL)).toBe(false);
	});

	it('declines unsupported URLs', () => {
		const strategy = new LocalExtractionStrategy(vi.fn());
		expect(strategy.canHandle('https://open.spotify.com/track/xyz')).toBe(false);
	});
});

describe('LocalExtractionStrategy.transcribe', () => {
	it('maps the extraction result into an extraction-sourced transcript', async () => {
		const delegate = vi.fn(() =>
			Promise.resolve(extractionResult({ videoVaultPath: 'Media/v.mp4', reformatted: true, schemaId: 'lyrics' }))
		);
		const strategy = new LocalExtractionStrategy(delegate);
		const opts = { timeRange: { startSeconds: 1, endSeconds: 2 } };

		const result = await strategy.transcribe(YOUTUBE_URL, opts);

		expect(delegate).toHaveBeenCalledWith(YOUTUBE_URL, opts);
		expect(result).toEqual({
			text: 'processed transcript',
			raw: 'raw transcript',
			source: 'local-extraction',
			title: 'A Video',
			language: 'en',
			videoVaultPath: 'Media/v.mp4',
			reformatted: true,
			schemaId: 'lyrics',
		});
	});

	it('falls back to the raw transcript when post-processing is disabled', async () => {
		const delegate = vi.fn(() => Promise.resolve(extractionResult({ processed: undefined })));
		const strategy = new LocalExtractionStrategy(delegate);

		const result = await strategy.transcribe(YOUTUBE_URL, {});
		expect(result.text).toBe('raw transcript');
	});

	it('propagates delegate failures unchanged', async () => {
		const boom = new Error('yt-dlp missing');
		boom.name = 'DependencyMissingError';
		const strategy = new LocalExtractionStrategy(vi.fn(() => Promise.reject(boom)));

		await expect(strategy.transcribe(YOUTUBE_URL, {})).rejects.toBe(boom);
	});
});
