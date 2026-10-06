import { describe, it, expect } from 'vitest';
import { resolveInsertionPoint, applyInsertion, describeInsertion } from './insertion-point';
import type { InsertionAnchor, ResolvedInsertion } from './insertion-point';

const NOTE = ['---', 'tags: [a]', '---', '# Red panda', '', '## Habitat', 'They live in forests.', 'High in the trees.', '', '## Diet', 'Bamboo.'].join('\n');

const heading = (text: string): InsertionAnchor => ({ kind: 'heading', text });
const paragraph = (text: string): InsertionAnchor => ({ kind: 'paragraph', text });

describe('resolveInsertionPoint', () => {
	it('matches a heading regardless of hashes and case', () => {
		expect(resolveInsertionPoint(NOTE, heading('habitat'))).toEqual({
			strategy: 'after-heading', line: 2, matchedText: '## Habitat', anchor: heading('habitat'),
		});
	});

	it('resolves a paragraph by its opening words to the end of that paragraph', () => {
		const resolved = resolveInsertionPoint(NOTE, paragraph('They live in'));
		expect(resolved).toMatchObject({ strategy: 'after-paragraph', line: 4, matchedText: 'They live in forests.' });
	});

	it('promotes a paragraph-hinted anchor that lands on a heading line', () => {
		const resolved = resolveInsertionPoint(NOTE, paragraph('## Diet'));
		expect(resolved).toMatchObject({ strategy: 'after-heading', line: 6, anchor: { kind: 'heading', text: '## Diet' } });
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
	it('inserts after a heading, keeps frontmatter, and pads a following paragraph with a blank line', () => {
		const out = applyInsertion(NOTE, resolveInsertionPoint(NOTE, heading('Habitat')), 'BLOCK');
		expect(out.startsWith('---\ntags:')).toBe(true);
		expect(out).toContain('## Habitat\n\nBLOCK\n\nThey live in forests.');
	});

	it('inserts after the end of a paragraph without doubling an existing blank line', () => {
		const out = applyInsertion(NOTE, resolveInsertionPoint(NOTE, paragraph('They live in forests')), 'BLOCK');
		expect(out).toContain('High in the trees.\n\nBLOCK\n\n## Diet');
	});

	it('appends on a miss and on a stale line index', () => {
		expect(applyInsertion(NOTE, resolveInsertionPoint(NOTE, paragraph('missing')), 'BLOCK').trimEnd().endsWith('Bamboo.\n\nBLOCK')).toBe(true);
		const stale: ResolvedInsertion = { strategy: 'after-heading', line: 99, matchedText: '## Gone', anchor: heading('Gone') };
		expect(applyInsertion(NOTE, stale, 'BLOCK').trimEnd().endsWith('Bamboo.\n\nBLOCK')).toBe(true);
	});
});

describe('describeInsertion', () => {
	it('names the heading without its hashes', () => {
		expect(describeInsertion(resolveInsertionPoint(NOTE, heading('Habitat')))).toBe('After heading "Habitat"');
	});

	it('quotes a clipped paragraph opening', () => {
		const long = 'The red panda, also called the lesser panda, is a small mammal native to the eastern Himalayas.';
		expect(describeInsertion(resolveInsertionPoint(long, paragraph('The red panda')))).toBe('After paragraph "The red panda, also called the lesser panda, is…"');
	});

	it('distinguishes a requested end from a miss', () => {
		expect(describeInsertion(resolveInsertionPoint(NOTE, { kind: 'end', text: '' }))).toBe('At end of note');
		expect(describeInsertion(resolveInsertionPoint(NOTE, paragraph('nope')))).toBe('At end of note (anchor not found)');
	});
});
