import { describe, it, expect, vi } from 'vitest';
import { findAudioEmbeds, hasTranscriptionBelow } from './note-scanner';
import { TFile, MetadataCache } from 'obsidian';

function mockMetadataCache(files: Record<string, TFile>): MetadataCache {
	return {
		getFirstLinkpathDest: vi.fn((linkpath: string) => files[linkpath] ?? null),
	} as unknown as MetadataCache;
}

function makeTFile(name: string, path?: string): TFile {
	const file = new TFile();
	Object.assign(file, {
		path: path ?? name,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
		extension: name.split('.').pop() || '',
	});
	return file;
}

describe('findAudioEmbeds', () => {
	it('finds audio embeds in content', () => {
		const file = makeTFile('recording.mp3', 'audio/recording.mp3');
		const cache = mockMetadataCache({ 'recording.mp3': file });

		const content = '# Notes\n![[recording.mp3]]\nSome text';
		const result = findAudioEmbeds(content, 'notes/test.md', cache);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ fileName: 'recording.mp3', file, line: 1 });
	});

	it('skips already-transcribed embeds (legacy format)', () => {
		const file = makeTFile('recording.mp3');
		const cache = mockMetadataCache({ 'recording.mp3': file });

		const content = [
			'![[recording.mp3]]',
			'',
			'> **Transcription of recording.mp3**',
			'> Some text',
		].join('\n');
		const result = findAudioEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});

	it('skips already-transcribed embeds (callout format)', () => {
		const file = makeTFile('recording.mp3');
		const cache = mockMetadataCache({ 'recording.mp3': file });

		const content = [
			'![[recording.mp3]]',
			'',
			'> [!synapse-transcription]- Transcription of recording.mp3',
			'> Some text',
		].join('\n');
		const result = findAudioEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});

	it('returns empty array for empty content', () => {
		const cache = mockMetadataCache({});
		expect(findAudioEmbeds('', 'test.md', cache)).toHaveLength(0);
	});

	it('returns empty array for content with no audio embeds', () => {
		const cache = mockMetadataCache({});
		const content = 'Just some text\n![[image.png]]\nMore text';
		expect(findAudioEmbeds(content, 'test.md', cache)).toHaveLength(0);
	});

	it('finds multiple audio embeds', () => {
		const file1 = makeTFile('a.mp3');
		const file2 = makeTFile('b.wav');
		const cache = mockMetadataCache({ 'a.mp3': file1, 'b.wav': file2 });

		const content = '![[a.mp3]]\nSome text\n![[b.wav]]';
		const result = findAudioEmbeds(content, 'test.md', cache);

		expect(result).toHaveLength(2);
		expect(result[0].line).toBe(0);
		expect(result[1].line).toBe(2);
	});

	it('reports correct line numbers', () => {
		const file = makeTFile('lecture.flac');
		const cache = mockMetadataCache({ 'lecture.flac': file });

		const content = '# Header\n\nSome notes\n\n![[lecture.flac]]';
		const result = findAudioEmbeds(content, 'test.md', cache);

		expect(result).toHaveLength(1);
		expect(result[0].line).toBe(4);
	});

	it('ignores files that do not resolve', () => {
		const cache = mockMetadataCache({});

		const content = '![[missing.mp3]]';
		const result = findAudioEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});
});

describe('hasTranscriptionBelow', () => {
	it('returns true when legacy transcription exists immediately below', () => {
		const lines = [
			'![[recording.mp3]]',
			'> **Transcription of recording.mp3**',
			'> text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(true);
	});

	it('returns true when transcription is 1 blank line below', () => {
		const lines = [
			'![[recording.mp3]]',
			'',
			'> **Transcription of recording.mp3**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(true);
	});

	it('returns true for callout-format transcription', () => {
		const lines = [
			'![[recording.mp3]]',
			'',
			'> [!synapse-transcription]- Transcription of recording.mp3',
			'> text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(true);
	});

	it('returns false when no transcription exists', () => {
		const lines = [
			'![[recording.mp3]]',
			'Some other text',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(false);
	});

	it('returns false when transcription is for a different file', () => {
		const lines = [
			'![[recording.mp3]]',
			'> **Transcription of other.mp3**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(false);
	});

	it('returns false when embed is at the last line', () => {
		const lines = ['![[recording.mp3]]'];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(false);
	});

	it('stops searching after non-blockquote content', () => {
		const lines = [
			'![[recording.mp3]]',
			'Some unrelated text',
			'> **Transcription of recording.mp3**',
		];
		expect(hasTranscriptionBelow(lines, 0, 'recording.mp3')).toBe(false);
	});
});
