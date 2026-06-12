import { describe, it, expect } from 'vitest';
import { RemApplier } from './rem-applier';
import type { RemLinkCandidate, RemOccurrence } from './types';

function occ(lineNumber: number, lineText: string, startOffset: number, endOffset: number): RemOccurrence {
	return { lineNumber, lineText, startOffset, endOffset };
}

function candidate(overrides: Partial<RemLinkCandidate> = {}): RemLinkCandidate {
	return {
		targetPath: 'notes/Target.md',
		targetDisplayName: 'Target',
		matchedText: 'Target',
		matchType: 'title',
		occurrences: [],
		confidence: 1,
		...overrides,
	};
}

describe('RemApplier', () => {
	const applier = new RemApplier();

	it('returns content unchanged when there are no candidates', () => {
		const content = 'Just some text\nover two lines';
		expect(applier.apply(content, [])).toBe(content);
	});

	it('inserts a bare wikilink when matched text equals the display name', () => {
		const content = 'I love Target very much';
		const c = candidate({
			matchedText: 'Target',
			targetDisplayName: 'Target',
			occurrences: [occ(0, content, 7, 13)],
		});
		expect(applier.apply(content, [c])).toBe('I love [[Target]] very much');
	});

	it('inserts an aliased wikilink when matched text differs from the display name', () => {
		const content = 'study of machine learning today';
		const c = candidate({
			matchedText: 'machine learning',
			targetDisplayName: 'ML Fundamentals',
			occurrences: [occ(0, content, 9, 25)],
		});
		expect(applier.apply(content, [c])).toBe(
			'study of [[ML Fundamentals|machine learning]] today'
		);
	});

	it('treats the matched/display equality check case-insensitively', () => {
		const content = 'the TARGET note';
		const c = candidate({
			matchedText: 'TARGET',
			targetDisplayName: 'Target',
			occurrences: [occ(0, content, 4, 10)],
		});
		// matchedText differs in case but is considered equal → bare link, keeping display name casing
		expect(applier.apply(content, [c])).toBe('the [[Target]] note');
	});

	it('applies multiple occurrences on the same line without corrupting offsets', () => {
		const content = 'foo foo foo';
		const c = candidate({
			matchedText: 'foo',
			targetDisplayName: 'Foobar',
			occurrences: [occ(0, content, 0, 3), occ(0, content, 4, 7), occ(0, content, 8, 11)],
		});
		expect(applier.apply(content, [c])).toBe('[[Foobar|foo]] [[Foobar|foo]] [[Foobar|foo]]');
	});

	it('applies replacements across multiple lines and multiple candidates', () => {
		const lines = ['alpha here', 'and beta there'];
		const content = lines.join('\n');
		const a = candidate({
			matchedText: 'alpha',
			targetDisplayName: 'Alpha',
			occurrences: [occ(0, lines[0], 0, 5)],
		});
		const b = candidate({
			targetPath: 'notes/Beta.md',
			matchedText: 'beta',
			targetDisplayName: 'Beta',
			occurrences: [occ(1, lines[1], 4, 8)],
		});
		// matchedText equals displayName case-insensitively → bare links
		expect(applier.apply(content, [a, b])).toBe('[[Alpha]] here\nand [[Beta]] there');
	});

	it('skips occurrences whose line number is out of range', () => {
		const content = 'single line';
		const c = candidate({
			matchedText: 'single',
			targetDisplayName: 'Single',
			occurrences: [occ(5, 'phantom', 0, 6)],
		});
		expect(applier.apply(content, [c])).toBe(content);
	});
});
