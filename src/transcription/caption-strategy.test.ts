import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptionStrategy } from './caption-strategy';
import { DEFAULT_SETTINGS } from '../settings';
import { makeSettings } from '../__test-utils__/mock-factories';
import * as youtubeCaptions from './youtube-captions';

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=abc123xyz00';
const TIKTOK_URL = 'https://www.tiktok.com/@user/video/123';

const fetchTranscript = vi.spyOn(youtubeCaptions, 'fetchYouTubeTranscript');

function makeStrategy(
	settingsOverrides: {
		captionsFirst?: boolean;
		language?: string;
	} = {},
	postProcess = vi.fn((raw: string) => Promise.resolve({ text: `processed: ${raw}` }))
) {
	const settings = makeSettings(DEFAULT_SETTINGS);
	settings.video.captionsFirst = settingsOverrides.captionsFirst ?? true;
	settings.audio.language = settingsOverrides.language ?? '';
	return {
		strategy: new CaptionStrategy(() => settings, postProcess),
		postProcess,
	};
}

beforeEach(() => {
	fetchTranscript.mockReset();
});

describe('CaptionStrategy.canHandle', () => {
	it('accepts a YouTube URL with captionsFirst on and no time range', () => {
		const { strategy } = makeStrategy();
		expect(strategy.canHandle(YOUTUBE_URL, {})).toBe(true);
	});

	it('declines non-YouTube URLs', () => {
		const { strategy } = makeStrategy();
		expect(strategy.canHandle(TIKTOK_URL, {})).toBe(false);
	});

	it('declines when a time range is requested (captions cannot clip)', () => {
		const { strategy } = makeStrategy();
		expect(
			strategy.canHandle(YOUTUBE_URL, { timeRange: { startSeconds: 0, endSeconds: 5 } })
		).toBe(false);
	});

	it('declines when captionsFirst is off', () => {
		const { strategy } = makeStrategy({ captionsFirst: false });
		expect(strategy.canHandle(YOUTUBE_URL, {})).toBe(false);
	});
});

describe('CaptionStrategy.transcribe', () => {
	it('post-processes fetched captions into a caption-sourced transcript', async () => {
		fetchTranscript.mockResolvedValue({
			text: 'caption text',
			language: 'en',
			auto: true,
			title: 'A Video',
		});
		const { strategy, postProcess } = makeStrategy();

		const result = await strategy.transcribe(YOUTUBE_URL, {});

		expect(postProcess).toHaveBeenCalledWith('caption text');
		expect(result).toEqual({
			text: 'processed: caption text',
			raw: 'caption text',
			source: 'captions',
			title: 'A Video',
			language: 'en',
			reformatted: undefined,
			schemaId: undefined,
		});
	});

	it('prefers the configured audio language, then English', async () => {
		fetchTranscript.mockResolvedValue(null);
		const { strategy } = makeStrategy({ language: 'de' });

		await strategy.transcribe(YOUTUBE_URL, {});

		expect(fetchTranscript).toHaveBeenCalledWith(YOUTUBE_URL, ['de', 'en']);
	});

	it('returns null (fall through) when the video has no captions', async () => {
		fetchTranscript.mockResolvedValue(null);
		const { strategy, postProcess } = makeStrategy();

		expect(await strategy.transcribe(YOUTUBE_URL, {})).toBeNull();
		expect(postProcess).not.toHaveBeenCalled();
	});

	it('degrades to raw captions when post-processing fails', async () => {
		fetchTranscript.mockResolvedValue({ text: 'caption text', language: 'en', auto: true });
		const { strategy } = makeStrategy(
			{},
			vi.fn(() => Promise.reject(new Error('no AI key')))
		);

		const result = await strategy.transcribe(YOUTUBE_URL, {});

		expect(result?.text).toBe('caption text');
		expect(result?.source).toBe('captions');
	});

	it('carries schema-reformat flags through (lyrics callout, #234)', async () => {
		fetchTranscript.mockResolvedValue({ text: 'la la la', language: 'en', auto: true });
		const { strategy } = makeStrategy(
			{},
			vi.fn(() => Promise.resolve({ text: '## Verse\nla la la', reformatted: true, schemaId: 'lyrics' }))
		);

		const result = await strategy.transcribe(YOUTUBE_URL, {});

		expect(result?.reformatted).toBe(true);
		expect(result?.schemaId).toBe('lyrics');
	});

	it('reports progress through the update hook', async () => {
		fetchTranscript.mockResolvedValue({ text: 'caption text', language: 'en', auto: true });
		const { strategy } = makeStrategy();
		const update = vi.fn();

		await strategy.transcribe(YOUTUBE_URL, { update });

		expect(update).toHaveBeenCalledWith('Fetching YouTube captions...');
	});
});
