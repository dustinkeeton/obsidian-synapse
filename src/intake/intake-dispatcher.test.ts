import { describe, it, expect, beforeEach } from 'vitest';
import { IntakeDispatcher } from './intake-dispatcher';
import { parseFrontmatter } from '../shared';
import { TFile } from '../__mocks__/obsidian';

/**
 * Routing policy is pure: it depends only on the parsed body, so these tests
 * construct a ParsedNote via parseFrontmatter and assert the IntakeRoute.
 */
describe('IntakeDispatcher.route', () => {
	let dispatcher: IntakeDispatcher;
	const file = new TFile('Inbox/capture.md') as any;

	beforeEach(() => {
		dispatcher = new IntakeDispatcher();
	});

	function routeFor(body: string) {
		return dispatcher.route(file, parseFrontmatter(body));
	}

	describe('bare media URL → transcription', () => {
		it('routes a lone YouTube URL to transcription with mediaType video', () => {
			const route = routeFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
			expect(route).toEqual({
				kind: 'transcription',
				url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				mediaType: 'video',
			});
		});

		it('routes a lone Spotify URL to transcription with mediaType audio', () => {
			const route = routeFor('https://open.spotify.com/episode/abc123');
			expect(route).toEqual({
				kind: 'transcription',
				url: 'https://open.spotify.com/episode/abc123',
				mediaType: 'audio',
			});
		});

		it('treats surrounding whitespace/newlines as still bare', () => {
			const route = routeFor('\n\n  https://www.youtube.com/watch?v=abc  \n');
			expect(route.kind).toBe('transcription');
		});
	});

	describe('bare article URL → article', () => {
		it('routes a lone generic article URL to article', () => {
			const route = routeFor('https://example.com/some-post');
			expect(route).toEqual({
				kind: 'article',
				url: 'https://example.com/some-post',
			});
		});

		it('routes a known article host (medium) to article', () => {
			const route = routeFor('https://medium.com/@author/a-story-123');
			expect(route).toEqual({
				kind: 'article',
				url: 'https://medium.com/@author/a-story-123',
			});
		});
	});

	describe('bare unknown URL → general', () => {
		it('routes a lone unclassifiable URL to general', () => {
			// A URL with shell metacharacters is rejected by sanitizeUrl, so
			// classifyUrl returns `unknown` → general (not fetchable as article).
			const route = routeFor('https://example.com/wiki/Obsidian_(software)');
			expect(route.kind).toBe('general');
		});
	});

	describe('non-bare bodies → general', () => {
		it('routes prose with no URL to general', () => {
			expect(routeFor('Just some plain text note.').kind).toBe('general');
		});

		it('routes a URL embedded in prose to general', () => {
			const route = routeFor('Check out https://example.com/post for details.');
			expect(route.kind).toBe('general');
		});

		it('routes multiple URLs to general', () => {
			const route = routeFor(
				'https://example.com/a\nhttps://example.com/b'
			);
			expect(route.kind).toBe('general');
		});

		it('routes a placeholder note to general', () => {
			expect(routeFor('TODO: write this up later').kind).toBe('general');
		});

		it('routes an empty body to general', () => {
			expect(routeFor('').kind).toBe('general');
		});
	});

	describe('frontmatter does not affect bare-URL detection', () => {
		it('treats a note whose body is just a URL as bare even with frontmatter', () => {
			const content = '---\ntitle: Capture\n---\nhttps://example.com/post';
			const route = dispatcher.route(file, parseFrontmatter(content));
			expect(route).toEqual({
				kind: 'article',
				url: 'https://example.com/post',
			});
		});
	});
});
