import { describe, it, expect } from 'vitest';
import { findVideoUrls, hasTranscriptionBelow } from './note-scanner';

describe('findVideoUrls', () => {
	it('finds a bare YouTube URL', () => {
		const content = 'Check this out:\nhttps://youtube.com/watch?v=dQw4w9WgXcQ\nPretty cool right?';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
			platform: 'youtube',
			line: 1,
		});
	});

	it('finds a bare TikTok URL', () => {
		const content = 'https://www.tiktok.com/@user/video/1234567890';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('tiktok');
	});

	it('finds a TikTok short URL', () => {
		const content = 'https://www.tiktok.com/t/ZTh7nJafa/';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('tiktok');
	});

	it('finds URL inside a markdown link', () => {
		const content = '[my video](https://youtube.com/watch?v=abc123)';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].url).toBe('https://youtube.com/watch?v=abc123');
	});

	it('finds multiple URLs across lines', () => {
		const content = [
			'# Videos',
			'https://youtube.com/watch?v=vid1',
			'Some text',
			'https://www.tiktok.com/t/ZTh7nJafa/',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(2);
		expect(result[0].line).toBe(1);
		expect(result[1].line).toBe(3);
	});

	it('finds multiple URLs on the same line', () => {
		const content = 'https://youtube.com/watch?v=vid1 and https://youtu.be/vid2';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(2);
	});

	it('finds YouTube URL with v= not as first query param', () => {
		const content = 'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('youtube');
	});

	it('finds YouTube embed URL', () => {
		const content = 'https://youtube.com/embed/dQw4w9WgXcQ';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('youtube');
	});

	it('finds YouTube live URL', () => {
		const content = 'https://youtube.com/live/dQw4w9WgXcQ';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('youtube');
	});

	it('finds TikTok URL with locale prefix', () => {
		const content = 'https://www.tiktok.com/en/@user/video/1234567890';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].platform).toBe('tiktok');
	});

	it('excludes Twitter/X.com URLs', () => {
		const content = [
			'https://twitter.com/user/status/1234567890',
			'https://x.com/other/status/9876543210',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(0);
	});

	it('finds video URLs but excludes Twitter URLs in mixed content', () => {
		const content = [
			'https://youtube.com/watch?v=abc123',
			'https://x.com/user/status/1234567890',
			'https://www.tiktok.com/@user/video/9876543210',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(2);
		expect(result[0].platform).toBe('youtube');
		expect(result[1].platform).toBe('tiktok');
	});

	it('ignores non-video URLs', () => {
		const content = 'https://example.com\nhttps://google.com\nhttps://vimeo.com/123';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(0);
	});

	it('ignores empty content', () => {
		expect(findVideoUrls('')).toHaveLength(0);
	});

	it('ignores content with no URLs', () => {
		expect(findVideoUrls('Just some regular notes\nNo links here')).toHaveLength(0);
	});

	it('skips URLs that already have a transcription below', () => {
		const content = [
			'https://youtube.com/watch?v=abc123',
			'',
			'> **Transcription of https://youtube.com/watch?v=abc123**',
			'>',
			'> Some transcribed text',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(0);
	});

	it('skips URLs that already have a callout transcription below', () => {
		const content = [
			'https://youtube.com/watch?v=abc123',
			'',
			'> [!synapse-transcription]- Transcription of https://youtube.com/watch?v=abc123',
			'> Some transcribed text',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(0);
	});

	it('returns URL that does not yet have a transcription', () => {
		const content = [
			'https://youtube.com/watch?v=abc123',
			'',
			'> **Transcription of https://youtube.com/watch?v=abc123**',
			'>',
			'> Some transcribed text',
			'',
			'https://youtube.com/watch?v=newvid',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].url).toBe('https://youtube.com/watch?v=newvid');
	});

	it('extracts URL from angle brackets', () => {
		const content = '<https://youtube.com/watch?v=abc123>';
		const result = findVideoUrls(content);
		expect(result).toHaveLength(1);
		expect(result[0].url).toBe('https://youtube.com/watch?v=abc123');
	});

	it('reports correct line numbers', () => {
		const content = [
			'# Header',
			'',
			'Some notes',
			'',
			'https://youtube.com/watch?v=test',
		].join('\n');
		const result = findVideoUrls(content);
		expect(result[0].line).toBe(4);
	});
});

describe('hasTranscriptionBelow', () => {
	it('returns true when transcription block exists immediately below', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'> **Transcription of https://youtube.com/watch?v=abc**',
			'>',
			'> text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(true);
	});

	it('returns true when transcription is 1 blank line below', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'',
			'> **Transcription of https://youtube.com/watch?v=abc**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(true);
	});

	it('returns false when no transcription exists', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'Some other text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(false);
	});

	it('returns false when transcription is for a different URL', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'> **Transcription of https://youtube.com/watch?v=xyz**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(false);
	});

	it('returns false when URL is at the last line', () => {
		const lines = ['https://youtube.com/watch?v=abc'];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(false);
	});

	it('stops searching after non-blockquote content', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'Some unrelated text',
			'> **Transcription of https://youtube.com/watch?v=abc**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(false);
	});

	it('searches through blockquote lines before finding transcription header', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'> some blockquote',
			'> **Transcription of https://youtube.com/watch?v=abc**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(true);
	});

	it('returns true for callout-format transcription below', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'',
			'> [!synapse-transcription]- Transcription of https://youtube.com/watch?v=abc',
			'> text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(true);
	});

	it('returns false for callout transcription of different URL', () => {
		const lines = [
			'https://youtube.com/watch?v=abc',
			'> [!synapse-transcription]- Transcription of https://youtube.com/watch?v=xyz',
		];
		expect(hasTranscriptionBelow(lines, 0, 'https://youtube.com/watch?v=abc')).toBe(false);
	});
});
