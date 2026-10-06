import { describe, it, expect } from 'vitest';
import { resolveInsertionPoint, applyInsertion, describeInsertion, scanBlocks, locateRegion } from './insertion-point';
import type { InsertionAnchor, ResolvedInsertion, RegionLocator } from './insertion-point';

const NOTE = ['---', 'tags: [a]', '---', '# Red panda', '', '## Habitat', 'They live in forests.', 'High in the trees.', '', '## Diet', 'Bamboo.'].join('\n');

const heading = (text: string): InsertionAnchor => ({ kind: 'heading', text });
const paragraph = (text: string): InsertionAnchor => ({ kind: 'paragraph', text });
const blankRuns = (text: string): number => (text.match(/\n{3,}/g) ?? []).length;

describe('scanBlocks', () => {
	it('keeps a fenced code block with blank lines as one block', () => {
		const lines = ['```ts', 'a', '', 'b', '```', 'after'];
		expect(scanBlocks(lines)).toEqual([{ type: 'code', start: 0, end: 4 }, { type: 'paragraph', start: 5, end: 5 }]);
	});

	it('keeps a loose list together and a table with its rows', () => {
		const lines = ['- one', '', '- two', '  more', '', 'text', '', '| a | b |', '|---|---|', '| 1 | 2 |', 'tail'];
		expect(scanBlocks(lines).map((b) => [b.type, b.start, b.end])).toEqual([
			['list', 0, 3], ['paragraph', 5, 5], ['table', 7, 9], ['paragraph', 10, 10],
		]);
	});

	it('keeps a callout with blank quote lines together and closes math fences', () => {
		const lines = ['> [!note] T', '> a', '>', '> b', '', '$$', 'x = 1', '$$', 'p'];
		expect(scanBlocks(lines).map((b) => [b.type, b.start, b.end])).toEqual([['quote', 0, 3], ['math', 5, 7], ['paragraph', 8, 8]]);
		expect(scanBlocks(lines)[0].children?.map((b) => [b.type, b.start, b.end])).toEqual([['paragraph', 0, 1], ['paragraph', 3, 3]]);
	});
});

describe('resolveInsertionPoint', () => {
	it('places a heading anchor after the opening paragraph of its section', () => {
		expect(resolveInsertionPoint(NOTE, heading('habitat'))).toEqual({
			strategy: 'after-section-lead', line: 4, matchedText: '## Habitat', anchor: heading('habitat'), blockType: 'paragraph',
		});
	});

	it('falls back to directly after the heading when no paragraph follows before the next heading', () => {
		const consecutive = '## A\n\n## B\n\nText under B.';
		expect(resolveInsertionPoint(consecutive, heading('A'))).toMatchObject({ strategy: 'after-heading', line: 0 });
		expect(resolveInsertionPoint('# Only\n\n- a list', heading('Only'))).toMatchObject({ strategy: 'after-heading', line: 0 });
	});

	it('handles a heading at the end of the note', () => {
		expect(resolveInsertionPoint('Intro.\n\n## Last', heading('Last'))).toMatchObject({ strategy: 'after-heading', line: 2 });
	});

	it('resolves a mid-paragraph fragment to the end of the whole paragraph', () => {
		const resolved = resolveInsertionPoint(NOTE, paragraph('in forests'));
		expect(resolved).toMatchObject({ strategy: 'after-paragraph', line: 4, matchedText: 'They live in forests.', blockType: 'paragraph' });
		expect(resolveInsertionPoint(NOTE, paragraph('High in the')).line).toBe(4);
	});

	it('never lands inside a loose list, fenced code, callout, or table', () => {
		const list = '- one\n\n- two\n  cont\n\nAfter.';
		expect(resolveInsertionPoint(list, paragraph('one'))).toMatchObject({ strategy: 'after-paragraph', line: 3, blockType: 'list' });
		const code = 'Intro\n\n```\nfoo bar\n\nbaz\n```\n\nAfter.';
		expect(resolveInsertionPoint(code, paragraph('foo bar'))).toMatchObject({ line: 6, blockType: 'code' });
		const quote = '> [!tip] Title\n> first\n>\n> second\n\nAfter.';
		expect(resolveInsertionPoint(quote, paragraph('first'))).toMatchObject({ line: 3, blockType: 'quote' });
		const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\ntail';
		expect(resolveInsertionPoint(table, paragraph('| 1 | 2 |'))).toMatchObject({ line: 3, blockType: 'table' });
	});

	it('promotes a paragraph-hinted anchor that lands on a heading line', () => {
		expect(resolveInsertionPoint(NOTE, paragraph('## Diet'))).toMatchObject({ strategy: 'after-section-lead', line: 7, anchor: { kind: 'heading' } });
	});

	it('restricts a heading-hinted anchor to heading lines', () => {
		expect(resolveInsertionPoint(NOTE, heading('They live in forests.')).strategy).toBe('append');
	});

	it('ignores wikilink syntax when matching', () => {
		expect(resolveInsertionPoint('Eats [[Bamboo|bamboo]] daily', paragraph('Eats bamboo daily')).line).toBe(0);
	});

	it('resolves an explicit end anchor, an unknown anchor, and an empty anchor to append', () => {
		expect(resolveInsertionPoint(NOTE, { kind: 'end', text: '' })).toMatchObject({ strategy: 'append', line: null, matchedText: null });
		expect(resolveInsertionPoint(NOTE, paragraph('Nowhere')).strategy).toBe('append');
		expect(resolveInsertionPoint(NOTE, heading('   ')).strategy).toBe('append');
	});
});

describe('applyInsertion', () => {
	it('inserts after the section lead with one blank line on each side and keeps frontmatter', () => {
		const out = applyInsertion(NOTE, resolveInsertionPoint(NOTE, heading('Habitat')), 'BLOCK');
		expect(out.startsWith('---\ntags:')).toBe(true);
		expect(out).toContain('High in the trees.\n\nBLOCK\n\n## Diet');
		expect(blankRuns(out)).toBe(0);
	});

	it('pads a following non-blank line and never doubles an existing blank', () => {
		const tight = '## A\nText.\nMore.\n## B';
		const out = applyInsertion(tight, resolveInsertionPoint(tight, paragraph('Text.')), 'BLOCK');
		expect(out).toBe('## A\nText.\nMore.\n\nBLOCK\n\n## B');
		const out2 = applyInsertion(NOTE, resolveInsertionPoint(NOTE, paragraph('They live in forests')), 'BLOCK');
		expect(blankRuns(out2)).toBe(0);
	});

	it('keeps a loose list and a code block whole', () => {
		const list = '- one\n\n- two\n\nAfter.';
		expect(applyInsertion(list, resolveInsertionPoint(list, paragraph('one')), 'BLOCK')).toBe('- one\n\n- two\n\nBLOCK\n\nAfter.');
		const code = '```\na\n\nb\n```\nAfter.';
		expect(applyInsertion(code, resolveInsertionPoint(code, paragraph('a')), 'BLOCK')).toBe('```\na\n\nb\n```\n\nBLOCK\n\nAfter.');
	});

	it('appends on a miss and on a stale line index with exactly one blank line before', () => {
		const out = applyInsertion(NOTE, resolveInsertionPoint(NOTE, paragraph('missing')), 'BLOCK');
		expect(out.endsWith('Bamboo.\n\nBLOCK\n')).toBe(true);
		const stale: ResolvedInsertion = { strategy: 'after-heading', line: 99, matchedText: '## Gone', anchor: heading('Gone') };
		expect(applyInsertion(NOTE, stale, 'BLOCK').endsWith('Bamboo.\n\nBLOCK\n')).toBe(true);
	});
});

describe('describeInsertion', () => {
	it('names the heading strategies without hashes', () => {
		expect(describeInsertion(resolveInsertionPoint(NOTE, heading('Habitat')))).toBe('After the opening paragraph of "Habitat"');
		expect(describeInsertion(resolveInsertionPoint('## A\n\n## B', heading('A')))).toBe('After heading "A"');
	});

	it('quotes a clipped block opening with the block kind', () => {
		const long = 'The red panda, also called the lesser panda, is a small mammal native to the eastern Himalayas.';
		expect(describeInsertion(resolveInsertionPoint(long, paragraph('The red panda')))).toBe('After paragraph "The red panda, also called the lesser panda, is…"');
		expect(describeInsertion(resolveInsertionPoint('- item one\n- item two', paragraph('item two')))).toBe('After list "- item two"');
	});

	it('distinguishes a requested end from a miss', () => {
		expect(describeInsertion(resolveInsertionPoint(NOTE, { kind: 'end', text: '' }))).toBe('At end of note');
		expect(describeInsertion(resolveInsertionPoint(NOTE, paragraph('nope')))).toBe('At end of note (anchor not found)');
	});
});

describe('region-targeted, container-aware insertion (#213)', () => {
	const SUMMARY = [
		'# Piracy', '', 'Intro paragraph.', '',
		'> [!synapse-summary] Combined summary (2 items)', '> ## Overview', '> Piracy peaked in the 1700s.', '> It declined later.', '>', '> - Edward England', '> - Black Bart', '',
		'> [!synapse-summary] Summary of other', '> Other text.', '',
		'> [!synapse-enrichment] References', '> - [a](https://a)',
	].join('\n');
	const summary: RegionLocator = { kind: 'callout', calloutType: 'synapse-summary', title: 'Combined summary (2 items)' };
	const locate = locateRegion;

	it('locates a region by callout type and by title, returning de-prefixed text', () => {
		const byType = locate(SUMMARY, { kind: 'callout', calloutType: 'synapse-summary' })!;
		expect([byType.start, byType.end]).toEqual([4, 10]);
		const byTitle = locate(SUMMARY, { kind: 'callout', calloutType: 'synapse-summary', title: 'Summary of other' })!;
		expect([byTitle.start, byTitle.end, byTitle.label]).toEqual([12, 13, 'summary']);
		expect(byTitle.text).toBe('[!synapse-summary] Summary of other\nOther text.');
		expect(locate(SUMMARY, { kind: 'callout', calloutType: 'synapse-ocr' })).toBeNull();
	});

	it('resolves inside the region after the inner block and records the container prefix', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('Piracy peaked'), { within: summary, insideContainers: true });
		expect(resolved).toMatchObject({ strategy: 'after-paragraph', line: 7, matchedText: 'Piracy peaked in the 1700s.', container: { prefix: '> ', label: 'summary' } });
		const inList = resolveInsertionPoint(SUMMARY, paragraph('Edward England'), { within: summary, insideContainers: true });
		expect(inList).toMatchObject({ line: 10, blockType: 'list', container: { prefix: '> ' } });
		const lead = resolveInsertionPoint(SUMMARY, heading('Overview'), { within: summary, insideContainers: true });
		expect(lead).toMatchObject({ strategy: 'after-section-lead', line: 7 });
	});

	it('resolves a miss inside the region to the end of the region, never the note', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('nowhere'), { within: summary, insideContainers: true });
		expect(resolved).toMatchObject({ strategy: 'append', line: 10, container: { prefix: '> ', label: 'summary' } });
		expect(describeInsertion(resolved)).toBe('Inside the summary, at its end');
	});

	it('still treats a callout as one block when neither option is given (ad hoc path)', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('Piracy peaked'));
		expect(resolved).toMatchObject({ strategy: 'after-paragraph', line: 10, blockType: 'quote' });
		expect(resolved.container).toBeUndefined();
	});

	it('descends into containers without a region when insideContainers is set', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('Other text'), { insideContainers: true });
		expect(resolved).toMatchObject({ line: 13, container: { prefix: '> ', label: 'summary' } });
	});

	it('applies prefixed embeds, nested callouts, and mermaid fences inside the container with quote spacers', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('Piracy peaked'), { within: summary, insideContainers: true });
		const block = '![[flag.png]]\n\n> [!synapse-illustrate] Flag\n> Source: x\n\n```mermaid\nflowchart TD\nA --> B\n```';
		const out = applyInsertion(SUMMARY, resolved, block).split('\n');
		expect(out.slice(7, 19)).toEqual([
			'> It declined later.', '>', '> ![[flag.png]]', '>', '> > [!synapse-illustrate] Flag', '> > Source: x', '>', '> ```mermaid', '> flowchart TD', '> A --> B', '> ```', '>',
		]);
		expect(out[19]).toBe('> - Edward England');
		expect(out.join('\n')).not.toMatch(/\n\n\n/);
	});

	it('appends at the region end with a quote spacer and leaves the following blank line alone', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('nowhere'), { within: summary, insideContainers: true });
		const out = applyInsertion(SUMMARY, resolved, 'BLOCK').split('\n');
		expect(out.slice(10, 14)).toEqual(['> - Black Bart', '>', '> BLOCK', '']);
	});

	it('handles depth-2 prefixes', () => {
		const nested = '> [!synapse-summary] S\n> > [!note] Inner\n> > Deep text here.\n>\n> After.';
		const resolved = resolveInsertionPoint(nested, paragraph('Deep text'), { within: { kind: 'callout', calloutType: 'synapse-summary' }, insideContainers: true });
		expect(resolved).toMatchObject({ line: 2, container: { prefix: '> > ' } });
		const out = applyInsertion(nested, resolved, 'X\n\nY').split('\n');
		expect(out.slice(2, 8)).toEqual(['> > Deep text here.', '> >', '> > X', '> >', '> > Y', '>']);
		expect(out[8]).toBe('> After.');
	});

	it('describes container placements', () => {
		const resolved = resolveInsertionPoint(SUMMARY, paragraph('Piracy peaked'), { within: summary, insideContainers: true });
		expect(describeInsertion(resolved)).toBe('Inside the summary, after paragraph "Piracy peaked in the 1700s."');
		const lead = resolveInsertionPoint(SUMMARY, heading('Overview'), { within: summary, insideContainers: true });
		expect(describeInsertion(lead)).toBe('Inside the summary, after the opening paragraph of "Overview"');
	});
});
