import { describe, it, expect } from 'vitest';
import { classifyUrl, extractUrls } from './url-classifier';
import { detectPlatform } from './url-detector';

describe('classifyUrl', () => {
	describe('video URLs (delegated to video detector)', () => {
		it('classifies a standard YouTube watch URL as video', () => {
			const result = classifyUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('youtube');
			expect(result.url).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
		});

		it('classifies a youtu.be short URL as video', () => {
			const result = classifyUrl('https://youtu.be/dQw4w9WgXcQ');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('youtube');
		});

		it('classifies a YouTube Shorts URL as video', () => {
			const result = classifyUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('youtube');
		});

		it('classifies a full TikTok video URL as video', () => {
			const result = classifyUrl('https://www.tiktok.com/@user/video/1234567890123456789');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('tiktok');
		});

		it('classifies a TikTok short share URL as video', () => {
			const result = classifyUrl('https://vm.tiktok.com/ZMxxxxxxx/');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('tiktok');
		});

		it('classifies an Instagram reel as video', () => {
			const result = classifyUrl('https://www.instagram.com/reel/DAFnBq_xSHw/');
			expect(result.type).toBe('video');
			expect(result.platform).toBe('instagram');
		});

		it('carries the specific platform name in the platform field', () => {
			expect(classifyUrl('https://youtube.com/watch?v=abc123').platform).toBe('youtube');
			expect(classifyUrl('https://www.tiktok.com/@u/video/123').platform).toBe('tiktok');
		});

		it('routes video URLs via the existing detector (stays in sync)', () => {
			// Any URL the video detector supports must classify as video with the
			// same platform label the detector reports.
			const videoUrls = [
				'https://youtube.com/watch?v=dQw4w9WgXcQ',
				'https://youtu.be/dQw4w9WgXcQ',
				'https://www.tiktok.com/@user/video/1234567890123456789',
				'https://www.instagram.com/reel/DAFnBq_xSHw/',
			];
			for (const url of videoUrls) {
				const detected = detectPlatform(url);
				const classified = classifyUrl(url);
				expect(detected).not.toBeNull();
				expect(classified.type).toBe('video');
				expect(classified.platform).toBe(detected?.platform);
			}
		});

		it('does NOT classify a Twitter/X status as video (detector excludes it)', () => {
			// isSupportedUrl returns false for twitter, so it must not be 'video'.
			const result = classifyUrl('https://twitter.com/user/status/1234567890');
			expect(result.type).not.toBe('video');
		});
	});

	describe('audio URLs', () => {
		it('classifies a Spotify track as audio (spotify)', () => {
			const result = classifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('spotify');
		});

		it('classifies a Spotify episode as audio (spotify)', () => {
			const result = classifyUrl('https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('spotify');
		});

		it('classifies a Spotify show as audio (spotify)', () => {
			const result = classifyUrl('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('spotify');
		});

		it('classifies a bare spotify.com host as audio', () => {
			const result = classifyUrl('https://spotify.com/episode/abc123');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('spotify');
		});

		it('classifies an Apple Podcasts URL as audio (apple-podcasts)', () => {
			const result = classifyUrl(
				'https://podcasts.apple.com/us/podcast/the-daily/id1200361736'
			);
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('apple-podcasts');
		});

		it('classifies a SoundCloud URL as audio (soundcloud)', () => {
			const result = classifyUrl('https://soundcloud.com/artist/track-name');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('soundcloud');
		});

		it('classifies a SoundCloud subdomain as audio (soundcloud)', () => {
			const result = classifyUrl('https://m.soundcloud.com/artist/track-name');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('soundcloud');
		});

		it('classifies a .rss feed URL as audio (podcast-rss)', () => {
			const result = classifyUrl('https://example.com/podcast.rss');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('podcast-rss');
		});

		it('classifies a .xml feed URL as audio (podcast-rss)', () => {
			const result = classifyUrl('https://example.com/podcast/feed.xml');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('podcast-rss');
		});

		it('classifies a /feed path URL as audio (podcast-rss)', () => {
			const result = classifyUrl('https://example.com/show/feed');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('podcast-rss');
		});

		it('classifies a /rss path URL as audio (podcast-rss)', () => {
			const result = classifyUrl('https://example.com/podcast/rss');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('podcast-rss');
		});

		it('classifies a feed hint in the query string as audio (podcast-rss)', () => {
			const result = classifyUrl('https://example.com/podcast?format=rss');
			expect(result.type).toBe('audio');
			expect(result.platform).toBe('podcast-rss');
		});

		it('prefers known audio host over generic article default', () => {
			// open.spotify.com would otherwise be a valid generic URL.
			expect(classifyUrl('https://open.spotify.com/show/x').platform).toBe('spotify');
		});
	});

	describe('article URLs', () => {
		it('classifies medium.com as article (medium)', () => {
			const result = classifyUrl('https://medium.com/@author/some-post-abc123');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('medium');
		});

		it('classifies a *.medium.com subdomain as article (medium)', () => {
			const result = classifyUrl('https://blog.medium.com/some-post-abc123');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('medium');
		});

		it('classifies a *.substack.com subdomain as article (substack)', () => {
			const result = classifyUrl('https://author.substack.com/p/some-post');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('substack');
		});

		it('classifies a *.wikipedia.org subdomain as article (wikipedia)', () => {
			const result = classifyUrl('https://en.wikipedia.org/wiki/Markdown');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('wikipedia');
		});

		it('classifies a Wikipedia disambiguation URL with parentheses as article', () => {
			// sanitizeUrl now allows URL-legal `()`, so a real disambiguation URL
			// reaches classification instead of being rejected as unknown (#369).
			const result = classifyUrl('https://en.wikipedia.org/wiki/Obsidian_(software)');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('wikipedia');
		});

		it('classifies a reddit.com post URL as article (reddit)', () => {
			const result = classifyUrl('https://www.reddit.com/r/immich/comments/abc123/title/');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('reddit');
		});

		it('classifies a reddit.com share (/s/) URL as article (reddit)', () => {
			const result = classifyUrl('https://www.reddit.com/r/immich/s/DaHMD1DJhv');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('reddit');
		});

		it('classifies any other valid http(s) URL as a generic article', () => {
			const result = classifyUrl('https://example.com/some/article');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('generic');
		});

		it('classifies a plain news site URL as a generic article', () => {
			const result = classifyUrl('https://www.nytimes.com/2026/01/01/tech/story.html');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('generic');
		});

		it('classifies an http (non-https) URL as a generic article', () => {
			const result = classifyUrl('http://example.org/page');
			expect(result.type).toBe('article');
			expect(result.platform).toBe('generic');
		});

		it('preserves the original url in the result', () => {
			const url = 'https://example.com/some/article?x=1';
			expect(classifyUrl(url).url).toBe(url);
		});
	});

	describe('unknown / invalid URLs', () => {
		it('classifies an empty string as unknown', () => {
			const result = classifyUrl('');
			expect(result.type).toBe('unknown');
			expect(result.platform).toBe('unknown');
		});

		it('classifies a non-URL string as unknown', () => {
			expect(classifyUrl('not a url').type).toBe('unknown');
		});

		it('classifies a bare word as unknown', () => {
			expect(classifyUrl('hello').type).toBe('unknown');
		});

		it('classifies a non-http scheme (ftp) as unknown', () => {
			expect(classifyUrl('ftp://example.com/file.zip').type).toBe('unknown');
		});

		it('classifies a javascript: scheme as unknown', () => {
			expect(classifyUrl('javascript:alert(1)').type).toBe('unknown');
		});

		it('classifies a mailto: scheme as unknown', () => {
			expect(classifyUrl('mailto:someone@example.com').type).toBe('unknown');
		});

		it('classifies a file: scheme as unknown', () => {
			expect(classifyUrl('file:///etc/passwd').type).toBe('unknown');
		});

		it('classifies a URL with shell metacharacters as unknown (sanitizeUrl rejects)', () => {
			// Regression guard: `$` (and backtick/`;`/`|`) stay rejected after #369
			// loosened sanitizeUrl, so a `$(...)` injection attempt is still unknown.
			expect(classifyUrl('https://example.com/$(rm -rf /)').type).toBe('unknown');
		});

		it('classifies a URL containing a null byte as unknown', () => {
			expect(classifyUrl('https://example.com/\0').type).toBe('unknown');
		});

		it('returns the original (unparseable) url string in the result', () => {
			expect(classifyUrl('not a url').url).toBe('not a url');
		});

		it('does not throw on any of a batch of malformed inputs', () => {
			const bad = ['', ' ', 'http://', 'https://', '://nohost', '!!!', 'ftp://x'];
			for (const input of bad) {
				expect(() => classifyUrl(input)).not.toThrow();
			}
		});
	});
});

describe('extractUrls', () => {
	it('returns an empty array for text with no URLs', () => {
		expect(extractUrls('just some plain note text with no links')).toEqual([]);
	});

	it('returns an empty array for an empty string', () => {
		expect(extractUrls('')).toEqual([]);
	});

	it('extracts a single URL', () => {
		expect(extractUrls('check https://example.com today')).toEqual([
			'https://example.com',
		]);
	});

	it('extracts a single URL with no surrounding text', () => {
		expect(extractUrls('https://example.com/page')).toEqual([
			'https://example.com/page',
		]);
	});

	it('extracts multiple URLs in document order', () => {
		const text =
			'First https://a.com then https://b.com and finally https://c.com';
		expect(extractUrls(text)).toEqual([
			'https://a.com',
			'https://b.com',
			'https://c.com',
		]);
	});

	it('extracts URLs embedded in prose across newlines', () => {
		const text = [
			'Here is a YouTube video: https://youtube.com/watch?v=abc123',
			'And a podcast: https://open.spotify.com/episode/xyz',
			'Read more at https://en.wikipedia.org/wiki/Topic.',
		].join('\n');
		expect(extractUrls(text)).toEqual([
			'https://youtube.com/watch?v=abc123',
			'https://open.spotify.com/episode/xyz',
			'https://en.wikipedia.org/wiki/Topic',
		]);
	});

	it('trims a trailing period that abuts a sentence-final URL', () => {
		expect(extractUrls('See https://example.com/page.')).toEqual([
			'https://example.com/page',
		]);
	});

	it('trims trailing punctuation and closing brackets', () => {
		expect(extractUrls('(link: https://example.com/page),')).toEqual([
			'https://example.com/page',
		]);
		expect(extractUrls('quote "https://example.com"')).toEqual([
			'https://example.com',
		]);
	});

	it('keeps both http and https URLs', () => {
		const text = 'insecure http://example.com and secure https://example.com/x';
		expect(extractUrls(text)).toEqual([
			'http://example.com',
			'https://example.com/x',
		]);
	});

	it('deduplicates repeated URLs, preserving first-seen order', () => {
		const text = 'https://a.com then https://b.com then https://a.com again';
		expect(extractUrls(text)).toEqual(['https://a.com', 'https://b.com']);
	});

	it('does not extract non-http schemes', () => {
		expect(extractUrls('email me at mailto:x@y.com or ftp://z.com/file')).toEqual(
			[]
		);
	});

	it('extracted URLs can be fed straight into classifyUrl', () => {
		const text =
			'video https://youtu.be/abc123 and article https://example.com/post';
		const [videoUrl, articleUrl] = extractUrls(text);
		expect(classifyUrl(videoUrl).type).toBe('video');
		expect(classifyUrl(articleUrl).type).toBe('article');
	});
});
