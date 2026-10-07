import { describe, it, expect } from 'vitest';
import { buildMediaEmbedLines, mediaEmbedFor } from './media-embed';

describe('mediaEmbedFor', () => {
	it('embeds the file name only, never the vault folder', () => {
		expect(mediaEmbedFor('Media/2026-07-14-video.mp4')).toBe('![[2026-07-14-video.mp4]]');
	});

	it('returns undefined for an empty or folder-only path', () => {
		expect(mediaEmbedFor('')).toBeUndefined();
		expect(mediaEmbedFor('Media/')).toBeUndefined();
	});
});

describe('buildMediaEmbedLines', () => {
	it('returns the embed followed by a blank line when enabled and a file was downloaded', () => {
		expect(buildMediaEmbedLines('Media/clip.mp4', true)).toEqual(['![[clip.mp4]]', '']);
	});

	it('returns nothing when the setting is off', () => {
		expect(buildMediaEmbedLines('Media/clip.mp4', false)).toEqual([]);
	});

	it('returns nothing when no file was downloaded', () => {
		expect(buildMediaEmbedLines(undefined, true)).toEqual([]);
	});

	it('returns nothing when the note already embeds the file', () => {
		const note = '# Note\n\n![[clip.mp4]]\n\n> [!quote|synapse-transcription]- Transcription of x\n';
		expect(buildMediaEmbedLines('Media/clip.mp4', true, note)).toEqual([]);
	});

	it('still embeds when the note embeds a different file', () => {
		expect(buildMediaEmbedLines('Media/clip.mp4', true, '![[other.mp4]]\n')).toEqual(['![[clip.mp4]]', '']);
	});
});
