import { describe, it, expect, vi } from 'vitest';
import { findImageEmbeds, hasExtractionBelow } from './note-scanner';
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

describe('findImageEmbeds', () => {
	it('finds image embeds in content', () => {
		const file = makeTFile('screenshot.png', 'images/screenshot.png');
		const cache = mockMetadataCache({ 'screenshot.png': file });

		const content = '# Notes\n![[screenshot.png]]\nSome text';
		const result = findImageEmbeds(content, 'notes/test.md', cache);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ fileName: 'screenshot.png', file, line: 1 });
	});

	it('skips already-extracted embeds (legacy format)', () => {
		const file = makeTFile('screenshot.png');
		const cache = mockMetadataCache({ 'screenshot.png': file });

		const content = [
			'![[screenshot.png]]',
			'',
			'> **OCR of screenshot.png**',
			'> Some text',
		].join('\n');
		const result = findImageEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});

	it('skips already-extracted embeds (callout format)', () => {
		const file = makeTFile('screenshot.png');
		const cache = mockMetadataCache({ 'screenshot.png': file });

		const content = [
			'![[screenshot.png]]',
			'',
			'> [!synapse-ocr]- OCR of screenshot.png',
			'> Some text',
		].join('\n');
		const result = findImageEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});

	it('returns empty array for empty content', () => {
		const cache = mockMetadataCache({});
		expect(findImageEmbeds('', 'test.md', cache)).toHaveLength(0);
	});

	it('returns empty array for content with no image embeds', () => {
		const cache = mockMetadataCache({});
		const content = 'Just some text\n![[recording.mp3]]\nMore text';
		expect(findImageEmbeds(content, 'test.md', cache)).toHaveLength(0);
	});

	it('finds multiple image embeds', () => {
		const file1 = makeTFile('a.png');
		const file2 = makeTFile('b.jpg');
		const cache = mockMetadataCache({ 'a.png': file1, 'b.jpg': file2 });

		const content = '![[a.png]]\nSome text\n![[b.jpg]]';
		const result = findImageEmbeds(content, 'test.md', cache);

		expect(result).toHaveLength(2);
		expect(result[0].line).toBe(0);
		expect(result[1].line).toBe(2);
	});

	it('reports correct line numbers', () => {
		const file = makeTFile('diagram.webp');
		const cache = mockMetadataCache({ 'diagram.webp': file });

		const content = '# Header\n\nSome notes\n\n![[diagram.webp]]';
		const result = findImageEmbeds(content, 'test.md', cache);

		expect(result).toHaveLength(1);
		expect(result[0].line).toBe(4);
	});

	it('ignores files that do not resolve', () => {
		const cache = mockMetadataCache({});

		const content = '![[missing.png]]';
		const result = findImageEmbeds(content, 'test.md', cache);
		expect(result).toHaveLength(0);
	});

	it('finds embeds with various image extensions', () => {
		const files: Record<string, TFile> = {};
		const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];
		for (const ext of extensions) {
			files[`img.${ext}`] = makeTFile(`img.${ext}`);
		}
		const cache = mockMetadataCache(files);

		const content = extensions.map(ext => `![[img.${ext}]]`).join('\n');
		const result = findImageEmbeds(content, 'test.md', cache);

		expect(result).toHaveLength(extensions.length);
	});
});

describe('hasExtractionBelow', () => {
	it('returns true when legacy extraction exists immediately below', () => {
		const lines = [
			'![[screenshot.png]]',
			'> **OCR of screenshot.png**',
			'> text',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(true);
	});

	it('returns true when extraction is 1 blank line below', () => {
		const lines = [
			'![[screenshot.png]]',
			'',
			'> **OCR of screenshot.png**',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(true);
	});

	it('returns true for callout-format extraction', () => {
		const lines = [
			'![[screenshot.png]]',
			'',
			'> [!synapse-ocr]- OCR of screenshot.png',
			'> text',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(true);
	});

	it('returns false when no extraction exists', () => {
		const lines = [
			'![[screenshot.png]]',
			'Some other text',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(false);
	});

	it('returns false when extraction is for a different file', () => {
		const lines = [
			'![[screenshot.png]]',
			'> **OCR of other.png**',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(false);
	});

	it('returns false when embed is at the last line', () => {
		const lines = ['![[screenshot.png]]'];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(false);
	});

	it('stops searching after non-blockquote content', () => {
		const lines = [
			'![[screenshot.png]]',
			'Some unrelated text',
			'> **OCR of screenshot.png**',
		];
		expect(hasExtractionBelow(lines, 0, 'screenshot.png')).toBe(false);
	});
});
