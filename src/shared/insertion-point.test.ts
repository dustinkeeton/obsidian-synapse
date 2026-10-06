import { describe, it, expect } from 'vitest';
import { resolveInsertionPoint, applyInsertion, describeInsertion, scanBlocks } from './insertion-point';
import type { InsertionAnchor, ResolvedInsertion } from './insertion-point';

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
