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
		expect(applier.apply(content, []).content).toBe(content);
	});

	it('inserts a bare wikilink when matched text equals the display name', () => {
		const content = 'I love Target very much';
		const c = candidate({
			matchedText: 'Target',
			targetDisplayName: 'Target',
			occurrences: [occ(0, content, 7, 13)],
		});
		expect(applier.apply(content, [c]).content).toBe('I love [[Target]] very much');
	});

	it('inserts an aliased wikilink when matched text differs from the display name', () => {
		const content = 'study of machine learning today';
		const c = candidate({
			matchedText: 'machine learning',
			targetDisplayName: 'ML Fundamentals',
			occurrences: [occ(0, content, 9, 25)],
		});
		expect(applier.apply(content, [c]).content).toBe(
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
		expect(applier.apply(content, [c]).content).toBe('the [[Target]] note');
	});

	it('applies multiple occurrences on the same line without corrupting offsets', () => {
		const content = 'foo foo foo';
		const c = candidate({
			matchedText: 'foo',
			targetDisplayName: 'Foobar',
			occurrences: [occ(0, content, 0, 3), occ(0, content, 4, 7), occ(0, content, 8, 11)],
		});
		expect(applier.apply(content, [c]).content).toBe('[[Foobar|foo]] [[Foobar|foo]] [[Foobar|foo]]');
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
		expect(applier.apply(content, [a, b]).content).toBe('[[Alpha]] here\nand [[Beta]] there');
	});

	it('drops an out-of-range occurrence whose text is nowhere in the content', () => {
		const content = 'single line';
		const c = candidate({
			matchedText: 'phantom',
			targetDisplayName: 'Phantom',
			occurrences: [occ(5, 'phantom', 0, 7)],
		});
		const result = applier.apply(content, [c]);
		expect(result.content).toBe(content);
		expect(result.dropped).toBe(1);
	});

	it('re-locates an out-of-range occurrence to the nearest remaining match', () => {
		const content = 'single line';
		const c = candidate({
			matchedText: 'single',
			targetDisplayName: 'Single',
			occurrences: [occ(5, 'single', 0, 6)],
		});
		expect(applier.apply(content, [c]).content).toBe('[[Single]] line');
	});

	describe('stale scan offsets (#575)', () => {
		const google = (occurrences: RemOccurrence[]) => candidate({
			targetPath: 'notes/Google.md',
			targetDisplayName: 'Google',
			matchedText: 'google',
			occurrences,
		});

		it('re-locates an occurrence shifted down by lines inserted above', () => {
			const scanned = 'I searched google today';
			const fresh = `# Title\n\nNew intro line\n${scanned}`;

			const result = applier.apply(fresh, [google([occ(0, scanned, 11, 17)])]);

			expect(result.content).toBe('# Title\n\nNew intro line\nI searched [[Google]] today');
			expect(result).toMatchObject({ applied: 1, dropped: 0 });
		});

		it('re-locates an occurrence shifted by characters inserted on the same line', () => {
			const scanned = 'I searched google today';
			const fresh = 'Yesterday I searched google today';

			const result = applier.apply(fresh, [google([occ(0, scanned, 11, 17)])]);

			expect(result.content).toBe('Yesterday I searched [[Google]] today');
		});

		it('drops an occurrence whose text was removed and leaves the content intact', () => {
			const scanned = 'I searched google today';
			const fresh = 'I searched the web today';

			const result = applier.apply(fresh, [google([occ(0, scanned, 11, 17)])]);

			expect(result.content).toBe(fresh);
			expect(result).toMatchObject({ applied: 0, dropped: 1, appliedCandidates: [] });
		});

		it('never splices a fragment when a summary was inserted above the matched line', () => {
			const scanned = 'Notes on google search ranking';
			const fresh = [
				'> [!summary|synapse-summary] Summary',
				'> Covers how google ranks pages.',
				'',
				'Notes on google search ranking',
			].join('\n');

			const result = applier.apply(fresh, [google([occ(0, scanned, 9, 15)])]);

			expect(result.content).toBe(fresh.replace('Notes on google', 'Notes on [[Google]]'));
			expect(result.content).not.toContain('lele');
		});

		it('does not re-locate into an existing wikilink', () => {
			const scanned = 'try google';
			const fresh = 'try [[google]]';

			const result = applier.apply(fresh, [google([occ(0, scanned, 4, 10)])]);

			expect(result.content).toBe(fresh);
			expect(result.dropped).toBe(1);
		});

		it('does not re-locate onto a mid-word match', () => {
			const scanned = 'try google';
			const fresh = 'try googleplex';

			expect(applier.apply(fresh, [google([occ(0, scanned, 4, 10)])]).dropped).toBe(1);
		});

		it('de-duplicates occurrences that re-locate onto the same span', () => {
			const scanned = 'google and google';
			const fresh = 'only google now';

			const result = applier.apply(fresh, [google([occ(0, scanned, 0, 6), occ(0, scanned, 11, 17)])]);

			expect(result.content).toBe('only [[Google]] now');
			expect(result).toMatchObject({ applied: 1, dropped: 1 });
		});

		it('keeps a still-valid exact span from being claimed by a re-located occurrence', () => {
			const fresh = 'x google\ngoogle y';
			const c = google([occ(5, 'gone', 0, 6), occ(1, 'google y', 0, 6)]);

			const result = applier.apply(fresh, [c]);

			expect(result.content).toBe('x [[Google]]\n[[Google]] y');
		});
	});
});
