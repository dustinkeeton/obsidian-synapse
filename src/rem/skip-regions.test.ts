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

	it.each([
		['deep-dive nav', '> [!note|synapse-nav] Deep Dive Navigation\n> Animation > Production pipeline'],
		['legacy deep-dive nav', '> [!synapse-nav] Deep Dive Navigation\n> Animation > Production pipeline'],
		['enrichment related notes', '> [!info|synapse-enrichment] Related Notes\n> - [[Storyboards]]'],
		['legacy enrichment related notes', '> [!synapse-enrichment] Related Notes\n> - [[Storyboards]]'],
		['enrichment references', '> [!info|synapse-enrichment] References\n> - [Pixar](https://pixar.com) - production pipeline overview'],
		['legacy enrichment references', '> [!synapse-enrichment] References\n> - [Pixar](https://pixar.com) - production pipeline overview'],
		['deep-dive', '> [!note|synapse-deep-dive] Deep dive\n> production pipeline'],
	])('covers a %s callout, header included', (_label, callout) => {
		const content = `${callout}\n\nafter`;
		const regions = buildSkipRegions(content);

		expect(isInSkipRegion(0, callout.length, regions)).toBe(true);
		expect(regions.some(r => r.start === 0 && r.end === callout.length)).toBe(true);
		expect(isInSkipRegion(content.indexOf('after'), content.length, regions)).toBe(false);
	});

	it.each([
		['transcription', '> [!quote|synapse-transcription] Transcription\n> production pipeline'],
		['OCR', '> [!quote|synapse-ocr] Extracted text\n> production pipeline'],
		['lyrics', '> [!quote|synapse-lyrics] Lyrics\n> production pipeline'],
		['legacy elaboration', '> [!synapse-elaboration] Elaboration\n> production pipeline'],
	])('leaves a %s callout linkable, since it holds the note content', (_label, callout) => {
		expect(buildSkipRegions(callout)).toEqual([]);
	});

	it('does not cover a non-Synapse callout', () => {
		const content = '> [!info] Related\n> networks';

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
