import { describe, it, expect } from 'vitest';
import { reduceToProse, proseCharCount, isEffectivelyEmptyProse, MIN_PROSE_CHARS } from './prose-reduction';

describe('reduceToProse', () => {
	it('removes bare URLs, keeping balanced parentheses inside them', () => {
		const out = reduceToProse('See https://en.wikipedia.org/wiki/Obsidian_(software) now');
		expect(out).not.toContain('wikipedia');
		expect(out).not.toContain('software');
		expect(out).toContain('See');
		expect(out).toContain('now');
	});

	it('removes wiki-link embeds entirely', () => {
		expect(reduceToProse('![[clip.mp3]]').trim()).toBe('');
		expect(reduceToProse('![[A long recording name.m4a|alias]]').trim()).toBe('');
	});

	it('reduces markdown links and images to their text', () => {
		expect(reduceToProse('[Read this](https://example.com/a)').trim()).toBe('Read this');
		expect(reduceToProse('![alt text](https://example.com/a.png)').trim()).toBe('alt text');
		expect(reduceToProse('[local](notes/other.md)').trim()).toBe('local');
	});

	it('reduces wikilinks to their alias or target', () => {
		expect(reduceToProse('[[Target note]]').trim()).toBe('Target note');
		expect(reduceToProse('[[Target note|shown]]').trim()).toBe('shown');
	});

	it('drops horizontal rules and empty headings', () => {
		expect(reduceToProse('---\n***\n___\n#\n## \n').trim()).toBe('');
	});

	it('keeps headings with text and ordinary prose', () => {
		const out = reduceToProse('# Title\n\nA sentence.');
		expect(out).toContain('Title');
		expect(out).toContain('A sentence.');
	});
});

describe('proseCharCount', () => {
	it('counts only letters and digits', () => {
		expect(proseCharCount('Hi, there! 42')).toBe(9);
	});

	it('returns 0 for empty or non-string input', () => {
		expect(proseCharCount('')).toBe(0);
		expect(proseCharCount('   \n\n')).toBe(0);
	});
});

describe('isEffectivelyEmptyProse', () => {
	it('treats a URL-only note as empty', () => {
		expect(isEffectivelyEmptyProse('https://www.youtube.com/watch?v=abc')).toBe(true);
	});

	it('treats an embed-only note as empty', () => {
		expect(isEffectivelyEmptyProse('![[clip.mp3]]')).toBe(true);
	});

	it('treats a URL plus an embed as empty', () => {
		expect(isEffectivelyEmptyProse('https://www.youtube.com/watch?v=abc\n\n![[clip.mp3]]')).toBe(true);
	});

	it('treats a markdown link with a short label as empty', () => {
		expect(isEffectivelyEmptyProse('[video](https://www.youtube.com/watch?v=abc)')).toBe(true);
	});

	it('treats references with a one-word title as empty', () => {
		expect(isEffectivelyEmptyProse('Links\n---\nhttps://example.com\n![[a.mp3]]')).toBe(true);
	});

	it('keeps a note with one real sentence beside its references', () => {
		expect(isEffectivelyEmptyProse('The lecture covered A and B.\n\nhttps://example.com\n\n![[clip.mp3]]')).toBe(false);
	});

	it('keeps a prose-only note', () => {
		expect(isEffectivelyEmptyProse('Just some thoughts written down.')).toBe(false);
	});

	it(`uses ${MIN_PROSE_CHARS} alphanumeric characters as the floor`, () => {
		expect(isEffectivelyEmptyProse('a'.repeat(MIN_PROSE_CHARS - 1))).toBe(true);
		expect(isEffectivelyEmptyProse('a'.repeat(MIN_PROSE_CHARS))).toBe(false);
	});
});
