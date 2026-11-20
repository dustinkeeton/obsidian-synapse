import { describe, it, expect } from 'vitest';
import { acceptApplied, acceptNotApplied, acceptWrote } from './accept-result';

describe('accept results (#633)', () => {
	it('builds applied and partial results with their written paths', () => {
		expect(acceptApplied(['a.md'])).toEqual({ status: 'applied', written: ['a.md'] });
		expect(acceptApplied(['a.md'], true, 'Some items were not selected')).toEqual({ status: 'partial', written: ['a.md'], reason: 'Some items were not selected' });
	});

	it('builds a result that wrote nothing', () => {
		expect(acceptNotApplied('conflict', 'x exists')).toEqual({ status: 'conflict', written: [], reason: 'x exists' });
	});

	it('counts only applied and partial as written', () => {
		expect(['applied', 'partial', 'skipped', 'conflict', 'failed'].map((status) => acceptWrote({ status, written: [] } as never)))
			.toEqual([true, true, false, false, false]);
	});
});
