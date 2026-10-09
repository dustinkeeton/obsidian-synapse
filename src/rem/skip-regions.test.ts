import { describe, it, expect } from 'vitest';
import { buildSkipRegions, isInSkipRegion, isWordBoundary, withoutSkipRegions } from './skip-regions';
import type { RemLinkCandidate, RemOccurrence } from './types';

const occAt = (lineNumber: number, lineText: string, startOffset: number, endOffset: number): RemOccurrence =>
	({ lineNumber, lineText, startOffset, endOffset });

const semantic = (occurrences: RemOccurrence[]): RemLinkCandidate => ({
	targetPath: 'Neural Nets.md',
	targetDisplayName: 'Neural Nets',
	matchedText: 'networks',
	matchType: 'semantic',
	occurrences,
	confidence: 0.9,
});

describe('buildSkipRegions', () => {
	it('covers a summary callout through its last quoted line', () => {
		const content = 'intro\n> [!summary|synapse-summary] Summary\n> body\n\nafter';
		const start = content.indexOf('>');
		const end = content.indexOf('\n\nafter');

		expect(buildSkipRegions(content)).toEqual([{ start, end }]);
	});

	it('does not cover other callouts', () => {
		const content = '> [!info|synapse-enrichment] Related\n> networks';

		expect(buildSkipRegions(content)).toEqual([]);
	});
});

describe('isInSkipRegion', () => {
	it('detects partial overlap with a region', () => {
		expect(isInSkipRegion(3, 8, [{ start: 5, end: 10 }])).toBe(true);
	});

	it('treats adjacent ranges as outside', () => {
		expect(isInSkipRegion(0, 5, [{ start: 5, end: 10 }])).toBe(false);
	});
});

describe('isWordBoundary', () => {
	it('accepts a whole word and rejects a word prefix', () => {
		expect(isWordBoundary('a google b', 2, 8)).toBe(true);
		expect(isWordBoundary('googleplex', 0, 6)).toBe(false);
	});
});

describe('withoutSkipRegions', () => {
	it('drops occurrences inside a summary callout and keeps the rest', () => {
		const lines = ['> [!summary|synapse-summary] Summary', '> networks', '', 'networks'];
		const c = semantic([occAt(1, lines[1], 2, 10), occAt(3, lines[3], 0, 8)]);

		const [kept] = withoutSkipRegions([c], lines.join('\n'));

		expect(kept.occurrences.map(o => o.lineNumber)).toEqual([3]);
	});

	it('drops a candidate left with no occurrences', () => {
		const content = 'see [[networks]]';
		const c = semantic([occAt(0, content, 6, 14)]);

		expect(withoutSkipRegions([c], content)).toEqual([]);
	});
});
