import { describe, it, expect } from 'vitest';
import {
	parseFrontmatter,
	serializeFrontmatter,
	mergeTags,
	normalizeFrontmatterTags,
	splitRawFrontmatter,
} from './frontmatter-utils';

describe('parseFrontmatter', () => {
	it('parses frontmatter and body', () => {
		const content = '---\ntitle: Test\n---\nBody content here.';
		const result = parseFrontmatter(content);

		expect(result.hasFrontmatter).toBe(true);
		expect(result.frontmatter.title).toBe('Test');
		expect(result.body).toBe('Body content here.');
	});

	it('returns empty frontmatter when none exists', () => {
		const content = 'Just body content.';
		const result = parseFrontmatter(content);

		expect(result.hasFrontmatter).toBe(false);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe('Just body content.');
	});

	it('handles empty frontmatter block', () => {
		const content = '---\n\n---\nBody.';
		const result = parseFrontmatter(content);

		expect(result.hasFrontmatter).toBe(true);
		expect(result.body).toBe('Body.');
	});

	it('handles frontmatter with multiple fields', () => {
		const content = '---\ntitle: Test\ndate: 2026-01-01\n---\nBody.';
		const result = parseFrontmatter(content);

		expect(result.frontmatter.title).toBe('Test');
		expect(result.frontmatter.date).toBe('2026-01-01');
	});
});

describe('serializeFrontmatter', () => {
	it('serializes frontmatter and body', () => {
		const result = serializeFrontmatter({ title: 'Test' }, 'Body.');
		expect(result).toContain('---');
		expect(result).toContain('title');
		expect(result).toContain('Body.');
	});

	it('omits frontmatter block when empty', () => {
		const result = serializeFrontmatter({}, 'Body only.');
		expect(result).toBe('Body only.');
		expect(result).not.toContain('---');
	});
});

describe('mergeTags', () => {
	it('adds new tags to empty frontmatter', () => {
		const fm: Record<string, unknown> = {};
		mergeTags(fm, ['tag1', 'tag2']);
		expect(fm.tags).toEqual(['tag1', 'tag2']);
	});

	it('merges without duplicates', () => {
		const fm: Record<string, unknown> = { tags: ['existing'] };
		mergeTags(fm, ['existing', 'new-tag']);
		expect(fm.tags).toEqual(['existing', 'new-tag']);
	});

	it('strips # prefix from new tags', () => {
		const fm: Record<string, unknown> = {};
		mergeTags(fm, ['#tagged']);
		expect(fm.tags).toEqual(['tagged']);
	});

	it('handles string tags field', () => {
		const fm: Record<string, unknown> = { tags: 'one, two' };
		mergeTags(fm, ['three']);
		expect(fm.tags).toEqual(['one', 'two', 'three']);
	});

	it('handles undefined tags field', () => {
		const fm: Record<string, unknown> = { title: 'Test' };
		mergeTags(fm, ['first']);
		expect(fm.tags).toEqual(['first']);
	});
});

describe('normalizeFrontmatterTags', () => {
	it('returns a string array unchanged', () => {
		expect(normalizeFrontmatterTags(['a', 'b'])).toEqual(['a', 'b']);
	});

	it('stringifies non-string array elements', () => {
		expect(normalizeFrontmatterTags([1, 2, 3])).toEqual(['1', '2', '3']);
	});

	it('splits a comma-separated string', () => {
		expect(normalizeFrontmatterTags('one, two,three')).toEqual([
			'one',
			'two',
			'three',
		]);
	});

	it('wraps a single string tag into an array', () => {
		expect(normalizeFrontmatterTags('project')).toEqual(['project']);
	});

	it('returns empty array for undefined', () => {
		expect(normalizeFrontmatterTags(undefined)).toEqual([]);
	});

	it('returns empty array for null', () => {
		expect(normalizeFrontmatterTags(null)).toEqual([]);
	});

	it('returns empty array for an object', () => {
		expect(normalizeFrontmatterTags({ nested: true })).toEqual([]);
	});
});

describe('splitRawFrontmatter', () => {
	it('returns the leading block byte-for-byte and the remaining body', () => {
		const raw = '---\ntitle:   "Odd"\ntags: [b, a]\n---\n';
		const result = splitRawFrontmatter(raw + '\nBody.');

		expect(result.raw).toBe(raw);
		expect(result.body).toBe('\nBody.');
		expect(result.raw + result.body).toBe(raw + '\nBody.');
	});

	it('returns an empty raw block when the note has no frontmatter', () => {
		expect(splitRawFrontmatter('Just body.')).toEqual({ raw: '', body: 'Just body.' });
	});

	it('does not treat a horizontal rule mid-document as frontmatter', () => {
		const content = 'Intro\n---\nkey: value\n---\n';
		expect(splitRawFrontmatter(content)).toEqual({ raw: '', body: content });
	});

	it('agrees with parseFrontmatter on the body boundary', () => {
		const content = '---\na: 1\n---\r\nBody.';
		expect(splitRawFrontmatter(content).body).toBe(parseFrontmatter(content).body);
	});

	it('keeps a block with no trailing newline intact', () => {
		expect(splitRawFrontmatter('---\na: 1\n---')).toEqual({ raw: '---\na: 1\n---', body: '' });
	});
});
