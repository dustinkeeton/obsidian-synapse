import { describe, it, expect } from 'vitest';
import { isUntitled } from './title-detector';

describe('isUntitled', () => {
	it('matches "Untitled"', () => {
		expect(isUntitled('Untitled')).toBe(true);
	});

	it('matches "Untitled 1"', () => {
		expect(isUntitled('Untitled 1')).toBe(true);
	});

	it('matches "Untitled 42"', () => {
		expect(isUntitled('Untitled 42')).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(isUntitled('untitled')).toBe(true);
		expect(isUntitled('UNTITLED')).toBe(true);
		expect(isUntitled('UNTITLED 3')).toBe(true);
	});

	it('handles leading/trailing whitespace', () => {
		expect(isUntitled('  Untitled  ')).toBe(true);
		expect(isUntitled('  Untitled 5  ')).toBe(true);
	});

	it('rejects non-untitled titles', () => {
		expect(isUntitled('My Note')).toBe(false);
		expect(isUntitled('Untitled Ideas')).toBe(false);
		expect(isUntitled('The Untitled')).toBe(false);
		expect(isUntitled('')).toBe(false);
	});

	it('rejects "Untitled" with non-numeric suffix', () => {
		expect(isUntitled('Untitled abc')).toBe(false);
		expect(isUntitled('Untitled note')).toBe(false);
	});
});
