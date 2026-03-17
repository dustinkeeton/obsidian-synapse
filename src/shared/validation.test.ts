import { describe, it, expect } from 'vitest';
import { blockquoteOriginal, ensureWithinVault } from './validation';

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
