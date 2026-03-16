import { describe, it, expect } from 'vitest';
import { findSummarizeTargets, hasSummaryBelow, extractTranscriptionContent } from './note-scanner';

describe('findSummarizeTargets', () => {
	it('finds a bare URL', () => {
		const content = 'Check this:\nhttps://example.com/article\nDone';
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			type: 'url',
			source: 'https://example.com/article',
			line: 1,
		});
	});

	it('finds multiple URLs', () => {
		const content = [
			'# Links',
			'https://example.com/a',
			'Some text',
			'https://example.com/b',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(2);
		expect(targets[0].line).toBe(1);
		expect(targets[1].line).toBe(3);
	});

	it('finds a transcription block', () => {
		const content = [
			'> **Transcription of https://youtube.com/watch?v=abc**',
			'>',
			'> Hello world this is a test',
			'> Second line of transcription',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			type: 'transcription',
			source: 'https://youtube.com/watch?v=abc',
			line: 0,
		});
		expect(targets[0].content).toContain('Hello world');
	});

	it('skips URLs that already have a summary below', () => {
		const content = [
			'https://example.com/article',
			'',
			'> **Summary of https://example.com/article**',
			'>',
			'> Some summary text',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(0);
	});

	it('skips transcriptions that already have a summary below', () => {
		const content = [
			'> **Transcription of https://youtube.com/watch?v=abc**',
			'>',
			'> Transcribed text here',
			'',
			'> **Summary of https://youtube.com/watch?v=abc**',
			'>',
			'> Summary text here',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(0);
	});

	it('skips URLs inside blockquotes', () => {
		const content = [
			'> This is a quote with https://example.com/link',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(0);
	});

	it('prefers transcription over re-fetching when URL has transcription below', () => {
		const content = [
			'https://youtube.com/watch?v=abc',
			'',
			'> **Transcription of https://youtube.com/watch?v=abc**',
			'>',
			'> Transcribed text here',
		].join('\n');
		const targets = findSummarizeTargets(content);
		// Should find the transcription block as a transcription target, not the URL
		expect(targets).toHaveLength(1);
		expect(targets[0].type).toBe('transcription');
	});

	it('returns empty for no URLs or transcriptions', () => {
		const content = 'Just some regular notes\nNo links here';
		expect(findSummarizeTargets(content)).toHaveLength(0);
	});

	it('returns empty for empty content', () => {
		expect(findSummarizeTargets('')).toHaveLength(0);
	});

	it('finds URL and transcription as separate targets', () => {
		const content = [
			'https://example.com/page1',
			'',
			'> **Transcription of https://youtube.com/watch?v=xyz**',
			'>',
			'> Some transcribed content',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(2);
		expect(targets[0].type).toBe('url');
		expect(targets[1].type).toBe('transcription');
	});

	it('finds enrichment URLs with metadata', () => {
		const content = [
			'https://example.com/user-url',
			'',
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [Some Article](https://example.com/enrichment-ref) — background',
			'- [Another](https://other.com/resource) — related',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(3);

		// Regular URL
		expect(targets[0]).toMatchObject({
			type: 'url',
			source: 'https://example.com/user-url',
		});
		expect(targets[0].inEnrichmentSection).toBeFalsy();

		// Enrichment URLs with titles
		expect(targets[1]).toMatchObject({
			type: 'url',
			source: 'https://example.com/enrichment-ref',
			inEnrichmentSection: true,
			linkTitle: 'Some Article',
		});
		expect(targets[2]).toMatchObject({
			type: 'url',
			source: 'https://other.com/resource',
			inEnrichmentSection: true,
			linkTitle: 'Another',
		});
	});

	it('finds enrichment URLs across multiple sections', () => {
		const content = [
			'https://example.com/keep-this',
			'',
			'%% auto-notes-enrichment-start %%',
			'## Related Notes',
			'',
			'- [[Topic]] — reason',
			'',
			'%% auto-notes-enrichment-end %%',
			'',
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [Ref](https://skip.com/this) — reason',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(2);
		expect(targets[0].source).toBe('https://example.com/keep-this');
		expect(targets[0].inEnrichmentSection).toBeFalsy();
		expect(targets[1].source).toBe('https://skip.com/this');
		expect(targets[1].inEnrichmentSection).toBe(true);
		expect(targets[1].linkTitle).toBe('Ref');
	});

	it('ignores wikilinks inside enrichment sections', () => {
		const content = [
			'%% auto-notes-enrichment-start %%',
			'## Related Notes',
			'',
			'- [[Existing Note]] — shares topic',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(0);
	});

	it('finds URLs after enrichment section ends', () => {
		const content = [
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [Inside](https://inside.com/ref) — reason',
			'',
			'%% auto-notes-enrichment-end %%',
			'',
			'https://example.com/after-enrichment',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(2);
		// Enrichment target
		expect(targets[0]).toMatchObject({
			source: 'https://inside.com/ref',
			inEnrichmentSection: true,
			linkTitle: 'Inside',
		});
		// Regular URL after markers
		expect(targets[1]).toMatchObject({
			source: 'https://example.com/after-enrichment',
		});
		expect(targets[1].inEnrichmentSection).toBeFalsy();
	});

	it('does not double-detect enrichment URLs already replaced with wikilinks', () => {
		// After summarize replaces [Title](url) with [[Title]], re-scanning
		// should not detect anything for that line
		const content = [
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [[AI Overview]] — background',
			'- [Still External](https://other.com/page) — reason',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			source: 'https://other.com/page',
			inEnrichmentSection: true,
			linkTitle: 'Still External',
		});
	});

	it('reproduces the transcribe-enrich-summarize scenario', () => {
		// Full scenario: TikTok URL → transcribed → enriched → summarize
		// should find transcription + enrichment reference URLs
		const content = [
			'https://www.tiktok.com/t/ZThw1txpF/',
			'',
			'> **Transcription of https://www.tiktok.com/t/ZThw1txpF/**',
			'>',
			'> Hey everyone, here is what I learned today about AI...',
			'> It was really interesting stuff.',
			'',
			'%% auto-notes-enrichment-start %%',
			'## Related Notes',
			'',
			'- [[Artificial Intelligence]] — shares topic',
			'',
			'%% auto-notes-enrichment-end %%',
			'',
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [AI Overview](https://en.wikipedia.org/wiki/Artificial_intelligence) — background',
			'- [TikTok Creator](https://tiktok.com/@creator) — source',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		expect(targets).toHaveLength(3);

		// Transcription target
		expect(targets[0]).toMatchObject({
			type: 'transcription',
			source: 'https://www.tiktok.com/t/ZThw1txpF/',
		});

		// Enrichment reference targets
		expect(targets[1]).toMatchObject({
			type: 'url',
			source: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
			inEnrichmentSection: true,
			linkTitle: 'AI Overview',
		});
		expect(targets[2]).toMatchObject({
			type: 'url',
			source: 'https://tiktok.com/@creator',
			inEnrichmentSection: true,
			linkTitle: 'TikTok Creator',
		});
	});

	it('enrichment targets survive idempotent re-scan after note creation', () => {
		// After processing, the external links become wikilinks.
		// Re-scanning should find no enrichment targets.
		const content = [
			'https://www.tiktok.com/t/ZThw1txpF/',
			'',
			'> **Transcription of https://www.tiktok.com/t/ZThw1txpF/**',
			'>',
			'> Transcribed text',
			'',
			'> **Summary of https://www.tiktok.com/t/ZThw1txpF/**',
			'>',
			'> Summary of the transcription',
			'',
			'%% auto-notes-enrichment-start %%',
			'## References',
			'',
			'- [[AI Overview]] — background',
			'- [[TikTok Creator]] — source',
			'',
			'%% auto-notes-enrichment-end %%',
		].join('\n');
		const targets = findSummarizeTargets(content);
		// Transcription already has summary, enrichment refs already converted
		expect(targets).toHaveLength(0);
	});
});

describe('hasSummaryBelow', () => {
	it('returns true when summary block exists immediately below', () => {
		const lines = [
			'https://example.com/article',
			'> **Summary of https://example.com/article**',
			'>',
			'> Summary text',
		];
		expect(hasSummaryBelow(lines, 0, 'https://example.com/article')).toBe(true);
	});

	it('returns true when summary is one blank line below', () => {
		const lines = [
			'https://example.com/article',
			'',
			'> **Summary of https://example.com/article**',
		];
		expect(hasSummaryBelow(lines, 0, 'https://example.com/article')).toBe(true);
	});

	it('returns false when no summary exists', () => {
		const lines = [
			'https://example.com/article',
			'Some other text',
		];
		expect(hasSummaryBelow(lines, 0, 'https://example.com/article')).toBe(false);
	});

	it('returns false when summary is for a different source', () => {
		const lines = [
			'https://example.com/article',
			'> **Summary of https://example.com/other**',
		];
		expect(hasSummaryBelow(lines, 0, 'https://example.com/article')).toBe(false);
	});

	it('returns false at end of file', () => {
		const lines = ['https://example.com/article'];
		expect(hasSummaryBelow(lines, 0, 'https://example.com/article')).toBe(false);
	});
});

describe('extractTranscriptionContent', () => {
	it('extracts text from a transcription block', () => {
		const lines = [
			'> **Transcription of test**',
			'>',
			'> First line',
			'> Second line',
		];
		const result = extractTranscriptionContent(lines, 0);
		expect(result.endLine).toBe(3);
		expect(result.text).toContain('First line');
		expect(result.text).toContain('Second line');
	});

	it('stops at non-blockquote content', () => {
		const lines = [
			'> **Transcription of test**',
			'>',
			'> Transcribed text',
			'',
			'Regular text',
		];
		const result = extractTranscriptionContent(lines, 0);
		expect(result.endLine).toBe(2);
		expect(result.text).toBe('Transcribed text');
	});

	it('handles empty transcription', () => {
		const lines = [
			'> **Transcription of test**',
			'Regular text',
		];
		const result = extractTranscriptionContent(lines, 0);
		expect(result.endLine).toBe(0);
		expect(result.text).toBe('');
	});
});

describe('multi-URL inline insertion (integration)', () => {
	/**
	 * Simulates the processFileTargets insertion logic in
	 * src/summarize/index.ts to verify that all inline summaries
	 * are correctly placed in the output. Uses the same algorithm:
	 * scan targets, sort reverse by line, splice blockLines.
	 */
	function simulateInsertion(
		content: string,
		summaries: Map<string, string>
	): string {
		const targets = findSummarizeTargets(content);
		const sorted = [...targets].sort((a, b) => b.line - a.line);
		const lines = content.split('\n');

		for (const target of sorted) {
			const summary = summaries.get(target.source);
			if (!summary) continue;

			const blockLines = [
				'',
				`> **Summary of ${target.source}**`,
				'>',
				...summary.split('\n').map(line => `> ${line}`),
				'',
			];

			lines.splice(target.endLine + 1, 0, ...blockLines);
		}

		return lines.join('\n');
	}

	it('inserts summaries for 2 video URLs on separate lines', () => {
		const content = [
			'# My Note',
			'',
			'https://youtube.com/watch?v=abc',
			'',
			'https://youtube.com/watch?v=xyz',
		].join('\n');

		const summaries = new Map([
			['https://youtube.com/watch?v=abc', 'Summary of first video.'],
			['https://youtube.com/watch?v=xyz', 'Summary of second video.'],
		]);

		const result = simulateInsertion(content, summaries);

		expect(result).toContain('> **Summary of https://youtube.com/watch?v=abc**');
		expect(result).toContain('> Summary of first video.');
		expect(result).toContain('> **Summary of https://youtube.com/watch?v=xyz**');
		expect(result).toContain('> Summary of second video.');
	});

	it('inserts summaries for 3 video URLs on consecutive lines', () => {
		const content = [
			'# My Note',
			'',
			'https://youtube.com/watch?v=first',
			'https://youtube.com/watch?v=second',
			'https://youtube.com/watch?v=third',
		].join('\n');

		const summaries = new Map([
			['https://youtube.com/watch?v=first', 'First summary.'],
			['https://youtube.com/watch?v=second', 'Second summary.'],
			['https://youtube.com/watch?v=third', 'Third summary.'],
		]);

		const result = simulateInsertion(content, summaries);

		expect(result).toContain('> **Summary of https://youtube.com/watch?v=first**');
		expect(result).toContain('> First summary.');
		expect(result).toContain('> **Summary of https://youtube.com/watch?v=second**');
		expect(result).toContain('> Second summary.');
		expect(result).toContain('> **Summary of https://youtube.com/watch?v=third**');
		expect(result).toContain('> Third summary.');
	});

	it('preserves original note content around inserted summaries', () => {
		const content = [
			'# My Note',
			'',
			'First paragraph.',
			'',
			'https://example.com/page1',
			'',
			'Middle paragraph.',
			'',
			'https://example.com/page2',
			'',
			'Final paragraph.',
		].join('\n');

		const summaries = new Map([
			['https://example.com/page1', 'Page 1 summary.'],
			['https://example.com/page2', 'Page 2 summary.'],
		]);

		const result = simulateInsertion(content, summaries);

		expect(result).toContain('# My Note');
		expect(result).toContain('First paragraph.');
		expect(result).toContain('Middle paragraph.');
		expect(result).toContain('Final paragraph.');
		expect(result).toContain('> Page 1 summary.');
		expect(result).toContain('> Page 2 summary.');
	});

	it('inserts summaries with multi-line summary content', () => {
		const content = [
			'# My Note',
			'',
			'https://example.com/page1',
			'',
			'https://example.com/page2',
		].join('\n');

		const multiLineSummary1 = [
			'## Key Points',
			'',
			'- Point 1 from page 1',
			'- Point 2 from page 1',
		].join('\n');

		const multiLineSummary2 = [
			'## Key Points',
			'',
			'- Point 1 from page 2',
			'- Point 2 from page 2',
		].join('\n');

		const summaries = new Map([
			['https://example.com/page1', multiLineSummary1],
			['https://example.com/page2', multiLineSummary2],
		]);

		const result = simulateInsertion(content, summaries);

		expect(result).toContain('> - Point 1 from page 1');
		expect(result).toContain('> - Point 2 from page 1');
		expect(result).toContain('> - Point 1 from page 2');
		expect(result).toContain('> - Point 2 from page 2');
	});

	it('places each summary directly after its respective URL', () => {
		const content = [
			'# My Note',
			'',
			'https://example.com/first',
			'',
			'https://example.com/second',
		].join('\n');

		const summaries = new Map([
			['https://example.com/first', 'First summary.'],
			['https://example.com/second', 'Second summary.'],
		]);

		const result = simulateInsertion(content, summaries);
		const lines = result.split('\n');

		// Find the URL lines
		const firstUrlIdx = lines.indexOf('https://example.com/first');
		const secondUrlIdx = lines.indexOf('https://example.com/second');

		// Find the summary header lines
		const firstSummaryIdx = lines.indexOf('> **Summary of https://example.com/first**');
		const secondSummaryIdx = lines.indexOf('> **Summary of https://example.com/second**');

		// Each summary should come after its URL and before the next URL
		expect(firstSummaryIdx).toBeGreaterThan(firstUrlIdx);
		expect(firstSummaryIdx).toBeLessThan(secondUrlIdx);
		expect(secondSummaryIdx).toBeGreaterThan(secondUrlIdx);
	});

	it('inserts summaries for URLs on the same line', () => {
		const content = [
			'# My Note',
			'',
			'Check https://example.com/a and https://example.com/b',
		].join('\n');

		const summaries = new Map([
			['https://example.com/a', 'Summary A.'],
			['https://example.com/b', 'Summary B.'],
		]);

		const result = simulateInsertion(content, summaries);

		expect(result).toContain('> **Summary of https://example.com/a**');
		expect(result).toContain('> Summary A.');
		expect(result).toContain('> **Summary of https://example.com/b**');
		expect(result).toContain('> Summary B.');
	});
});
