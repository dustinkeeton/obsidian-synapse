import { describe, it, expect } from 'vitest';
import { isUntitled, isGenericTitle } from './title-detector';

describe('isUntitled', () => {
	it('matches Obsidian "Untitled" defaults (case-insensitive, with/without index)', () => {
		expect(isUntitled('Untitled')).toBe(true);
		expect(isUntitled('Untitled 1')).toBe(true);
		expect(isUntitled('Untitled 42')).toBe(true);
		expect(isUntitled('untitled')).toBe(true);
		expect(isUntitled('UNTITLED 3')).toBe(true);
		expect(isUntitled('  Untitled 5  ')).toBe(true);
	});

	it('rejects real titles and non-numeric suffixes', () => {
		expect(isUntitled('My Note')).toBe(false);
		expect(isUntitled('Untitled Ideas')).toBe(false);
		expect(isUntitled('The Untitled')).toBe(false);
		expect(isUntitled('Untitled note')).toBe(false);
		expect(isUntitled('')).toBe(false);
	});
});

describe('isGenericTitle', () => {
	it('treats Obsidian "Untitled" defaults as generic', () => {
		expect(isGenericTitle('Untitled')).toBe(true);
		expect(isGenericTitle('Untitled 7')).toBe(true);
	});

	it('treats date-style daily-note names as generic', () => {
		// Obsidian default + common separator variants.
		expect(isGenericTitle('2026-06-25')).toBe(true);
		expect(isGenericTitle('2026/06/25')).toBe(true);
		expect(isGenericTitle('2026.06.25')).toBe(true);
		expect(isGenericTitle('2026_06_25')).toBe(true);
		// Compact and year-last variants.
		expect(isGenericTitle('20260625')).toBe(true);
		expect(isGenericTitle('25-06-2026')).toBe(true);
		expect(isGenericTitle('06/25/2026')).toBe(true);
	});

	it('treats bare-URL titles as generic', () => {
		expect(isGenericTitle('https://example.com/article')).toBe(true);
		expect(isGenericTitle('http://news.site/post?id=1')).toBe(true);
		expect(isGenericTitle('www.example.com')).toBe(true);
	});

	it('does NOT treat real, topical titles as generic', () => {
		expect(isGenericTitle('Photosynthesis')).toBe(false);
		expect(isGenericTitle('Project Roadmap')).toBe(false);
		expect(isGenericTitle('My 2026 Plan')).toBe(false);
		// Structurally date-like but out of range -> not a date.
		expect(isGenericTitle('2026-13-40')).toBe(false);
		// A note that merely starts with a date but has real words is not generic.
		expect(isGenericTitle('2026-06-25 Standup notes')).toBe(false);
	});
});
