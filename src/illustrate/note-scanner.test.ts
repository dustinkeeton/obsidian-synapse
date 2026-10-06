import { describe, it, expect } from 'vitest';
import { isEligibleNote, hasIllustrations, MIN_WORDS_TO_ILLUSTRATE } from './note-scanner';

const prose = 'word '.repeat(MIN_WORDS_TO_ILLUSTRATE);

describe('note-scanner', () => {
	it('requires enough prose', () => {
		expect(isEligibleNote('short note')).toBe(false);
		expect(isEligibleNote(prose)).toBe(true);
	});

	it('skips notes that already carry a Synapse illustration', () => {
		const content = `${prose}\n> [!synapse-illustrate] Caption\n> Source: x`;
		expect(hasIllustrations(content)).toBe(true);
		expect(isEligibleNote(content)).toBe(false);
	});
});
