import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { PROPOSAL_KINDS } from './views/types';

describe('autoAccept settings (#228)', () => {
	it('defines an autoAccept flag for every proposal kind', () => {
		const keys = Object.keys(DEFAULT_SETTINGS.autoAccept).sort();
		expect(keys).toEqual([...PROPOSAL_KINDS].sort());
	});

	it('defaults every auto-accept flag to false (opt-in)', () => {
		for (const kind of PROPOSAL_KINDS) {
			expect(DEFAULT_SETTINGS.autoAccept[kind]).toBe(false);
		}
	});

	it('has no extra keys beyond the known proposal kinds', () => {
		expect(Object.keys(DEFAULT_SETTINGS.autoAccept)).toHaveLength(PROPOSAL_KINDS.length);
	});

	it('exposes exactly the six expected proposal kinds', () => {
		expect([...PROPOSAL_KINDS]).toEqual([
			'elaboration',
			'enrichment',
			'organize',
			'deep-dive',
			'title',
			'rem',
		]);
	});
});
