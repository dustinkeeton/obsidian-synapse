import { describe, it, expect } from 'vitest';
import { blockquoteOriginal, ensureWithinVault, stripCodeFences } from './validation';

describe('blockquoteOriginal', () => {
	it('converts plain text to a blockquote with attribution', () => {
		const result = blockquoteOriginal('Hello world');
		expect(result).toBe(
			'> Hello world\n> \n> — *Original note by author*'
		);
	});

	it('handles multi-line content', () => {
		const result = blockquoteOriginal('Line one\nLine two\nLine three');
		expect(result).toBe(
			'> Line one\n> Line two\n> Line three\n> \n> — *Original note by author*'
		);
	});

	it('preserves frontmatter outside the blockquote', () => {
		const input = '---\ntitle: Test\n---\nBody text here';
		const result = blockquoteOriginal(input);
		expect(result).toBe(
			'---\ntitle: Test\n---\n\n> Body text here\n> \n> — *Original note by author*'
		);
	});

	it('preserves frontmatter with multi-line body', () => {
		const input = '---\ntags: foo\n---\n\nFirst paragraph\n\nSecond paragraph';
		const result = blockquoteOriginal(input);
		expect(result).toContain('---\ntags: foo\n---');
		expect(result).toContain('> First paragraph');
		expect(result).toContain('> Second paragraph');
	});

	it('returns content unchanged if body is empty', () => {
		const input = '---\ntitle: Empty\n---\n';
		expect(blockquoteOriginal(input)).toBe(input);
	});

	it('returns content unchanged if body is only whitespace', () => {
		const input = '---\ntitle: Blank\n---\n  \n  \n';
		expect(blockquoteOriginal(input)).toBe(input);
	});

	it('returns content unchanged for empty string', () => {
		expect(blockquoteOriginal('')).toBe('');
	});

	it('returns content unchanged for whitespace-only string', () => {
		expect(blockquoteOriginal('   \n  ')).toBe('   \n  ');
	});

	it('handles content that starts with --- but has no closing ---', () => {
		const input = '---\nNot actually frontmatter';
		const result = blockquoteOriginal(input);
		// No valid frontmatter, so the whole thing gets blockquoted
		expect(result).toContain('> ---');
		expect(result).toContain('> Not actually frontmatter');
	});
});

describe('ensureWithinVault', () => {
	it('allows a simple relative path within the vault', () => {
		const result = ensureWithinVault('notes/hello.md', '/vault');
		expect(result).toBe('/vault/notes/hello.md');
	});

	it('resolves dot segments', () => {
		const result = ensureWithinVault('notes/../notes/hello.md', '/vault');
		expect(result).toBe('/vault/notes/hello.md');
	});

	it('resolves current-dir segments', () => {
		const result = ensureWithinVault('./notes/hello.md', '/vault');
		expect(result).toBe('/vault/notes/hello.md');
	});

	it('throws on path traversal that escapes the vault', () => {
		expect(() => ensureWithinVault('../../etc/passwd', '/vault')).toThrow(
			'Path escapes vault boundary'
		);
	});

	it('throws on deeply nested traversal', () => {
		expect(() =>
			ensureWithinVault('notes/../../../etc/passwd', '/vault')
		).toThrow('Path escapes vault boundary');
	});

	it('allows the vault root itself', () => {
		const result = ensureWithinVault('.', '/vault');
		expect(result).toBe('/vault');
	});

	it('normalizes backslashes to forward slashes', () => {
		const result = ensureWithinVault('notes\\hello.md', '/vault');
		expect(result).toBe('/vault/notes/hello.md');
	});

	it('handles absolute path inside vault', () => {
		const result = ensureWithinVault('/vault/notes/hello.md', '/vault');
		expect(result).toBe('/vault/notes/hello.md');
	});

	it('throws for absolute path outside vault', () => {
		expect(() => ensureWithinVault('/other/path', '/vault')).toThrow(
			'Path escapes vault boundary'
		);
	});
});

describe('stripCodeFences', () => {
	it('strips plain code fences wrapping content', () => {
		const input = '```\nHello world\n```';
		expect(stripCodeFences(input)).toBe('Hello world');
	});

	it('strips fences with "markdown" specifier', () => {
		const input = '```markdown\n## Heading\nSome text\n```';
		expect(stripCodeFences(input)).toBe('## Heading\nSome text');
	});

	it('strips fences with "md" specifier', () => {
		const input = '```md\n## Heading\nSome text\n```';
		expect(stripCodeFences(input)).toBe('## Heading\nSome text');
	});

	it('preserves multi-line content inside fences', () => {
		const input = '```\nLine 1\nLine 2\nLine 3\n```';
		expect(stripCodeFences(input)).toBe('Line 1\nLine 2\nLine 3');
	});

	it('returns input unchanged when there are no fences', () => {
		const input = 'Just some regular text\nwith multiple lines';
		expect(stripCodeFences(input)).toBe(input);
	});

	it('does not strip when only an opening fence is present', () => {
		const input = '```\nSome content without closing fence';
		expect(stripCodeFences(input)).toBe(input);
	});

	it('does not strip when only a closing fence is present', () => {
		const input = 'Some content without opening fence\n```';
		expect(stripCodeFences(input)).toBe(input);
	});

	it('does not strip internal code blocks within larger content', () => {
		const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
		expect(stripCodeFences(input)).toBe(input);
	});

	it('trims leading and trailing whitespace', () => {
		const input = '  \n```\nContent\n```\n  ';
		expect(stripCodeFences(input)).toBe('Content');
	});

	it('handles empty content inside fences', () => {
		const input = '```\n```';
		expect(stripCodeFences(input)).toBe('');
	});
});
