import { describe, it, expect } from 'vitest';
import { withoutOverlaps } from './overlaps';
import type { RemLinkCandidate } from './types';

function at(name: string, spans: Array<[number, number, number]>): RemLinkCandidate {
	return {
		targetPath: `${name}.md`,
		targetDisplayName: name,
		matchedText: name,
		matchType: 'semantic',
		occurrences: spans.map(([lineNumber, startOffset, endOffset]) => ({ lineNumber, lineText: '', startOffset, endOffset })),
		confidence: 1,
	};
}

describe('withoutOverlaps', () => {
	it('keeps the earlier candidate and drops a later one whose only occurrence overlaps it', () => {
		const result = withoutOverlaps([at('A', [[0, 0, 20]]), at('B', [[0, 5, 9]]), at('C', [[1, 5, 9]])]);
		expect(result.map((c) => c.targetDisplayName)).toEqual(['A', 'C']);
	});

	it('trims overlapping occurrences but keeps the candidate when one survives', () => {
		const result = withoutOverlaps([at('A', [[0, 0, 4]]), at('B', [[0, 2, 6], [2, 0, 4]])]);
		expect(result[1].occurrences).toEqual([{ lineNumber: 2, lineText: '', startOffset: 0, endOffset: 4 }]);
	});

	it('treats touching spans as non-overlapping', () => {
		expect(withoutOverlaps([at('A', [[0, 0, 4]]), at('B', [[0, 4, 8]])])).toHaveLength(2);
	});
});
