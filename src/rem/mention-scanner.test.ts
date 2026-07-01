import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MentionScanner } from './mention-scanner';
import type { App, TFile, CachedMetadata } from 'obsidian';
import type { SynapseSettings } from '../settings';

// ── Helpers ──────────────────────────────────────────────────

function makeFile(path: string, basename?: string): TFile {
	return {
		path,
		basename: basename ?? path.replace(/\.md$/, '').split('/').pop()!,
		extension: 'md',
		name: path.split('/').pop()!,
	} as unknown as TFile;
}

function makeApp(files: TFile[], cacheMap: Map<string, Partial<CachedMetadata>> = new Map()) {
	return {
		vault: {
			getMarkdownFiles: () => files,
		},
		metadataCache: {
			getFileCache: (file: TFile) => cacheMap.get(file.path) ?? null,
		},
	} as unknown as App;
}

const noExclusions = () => ({ exclusions: [] }) as unknown as SynapseSettings;
const settingsWith = (exclusions: unknown[]) => () =>
	({ exclusions }) as unknown as SynapseSettings;

// ── Tests ────────────────────────────────────────────────────

describe('MentionScanner', () => {
	let scanner: MentionScanner;

	describe('exact title match', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Machine Learning.md', 'Machine Learning'),
				makeFile('Data Science.md', 'Data Science'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);
		});

		it('should find exact title mentions', () => {
			const source = makeFile('source.md', 'source');
			const content = 'I am studying machine learning and data science today.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(2);
			expect(results.map(r => r.targetDisplayName).sort()).toEqual(
				['Data Science', 'Machine Learning']
			);
		});

		it('should return correct occurrence positions', () => {
			const source = makeFile('source.md', 'source');
			const content = 'I love machine learning.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].occurrences).toHaveLength(1);
			expect(results[0].occurrences[0].startOffset).toBe(7);
			expect(results[0].occurrences[0].endOffset).toBe(23);
			expect(results[0].occurrences[0].lineNumber).toBe(0);
		});

		it('should find multiple occurrences of the same term', () => {
			const source = makeFile('source.md', 'source');
			const content = 'Machine learning is great.\nI love machine learning.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].occurrences).toHaveLength(2);
			expect(results[0].occurrences[0].lineNumber).toBe(0);
			expect(results[0].occurrences[1].lineNumber).toBe(1);
		});
	});

	describe('folder exclusion (#323)', () => {
		it('does not match notes in folders excluded for rem', () => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Templates/Machine Learning.md', 'Machine Learning'),
			];
			const getSettings = settingsWith([{ pattern: 'Templates/**', features: ['rem'] }]);
			const excludingScanner = new MentionScanner(makeApp(files), getSettings);
			const source = makeFile('source.md', 'source');
			const results = excludingScanner.scan(source, 'I am studying machine learning today.', 20);
			expect(results).toHaveLength(0);
		});
	});

	describe('alias match', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('ML Fundamentals.md', 'ML Fundamentals'),
			];
			const cache = new Map<string, Partial<CachedMetadata>>();
			cache.set('ML Fundamentals.md', {
				frontmatter: {
					aliases: ['machine learning', 'ML'],
					position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
				},
			});
			scanner = new MentionScanner(makeApp(files, cache), noExclusions);
		});

		it('should match aliases', () => {
			const source = makeFile('source.md', 'source');
			const content = 'This note is about machine learning techniques.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].targetDisplayName).toBe('ML Fundamentals');
			expect(results[0].matchType).toBe('alias');
			expect(results[0].matchedText).toBe('machine learning');
		});

		it('should skip aliases shorter than 3 chars', () => {
			const source = makeFile('source.md', 'source');
			// "ML" alias is only 2 chars, should be skipped
			const content = 'ML is a broad field.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});
	});

	describe('case-insensitive matching', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Machine Learning.md', 'Machine Learning'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);
		});

		it('should match regardless of case', () => {
			const source = makeFile('source.md', 'source');
			const content = 'MACHINE LEARNING is interesting. Also machine learning.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].occurrences).toHaveLength(2);
		});
	});

	describe('word boundary enforcement', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Data.md', 'Data'),
				makeFile('Art.md', 'Art'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);
		});

		it('should not match partial words', () => {
			const source = makeFile('source.md', 'source');
			// "data" should match standalone but not inside "database"
			// "art" is only 3 chars but should not match inside "start"
			const content = 'database is not data. starting is not art.';
			const results = scanner.scan(source, content, 20);

			const dataResult = results.find(r => r.targetDisplayName === 'Data');
			const artResult = results.find(r => r.targetDisplayName === 'Art');

			expect(dataResult).toBeDefined();
			expect(dataResult!.occurrences).toHaveLength(1);
			// 'database is not data. starting is not art.'
			//  0123456789...    ^16                  ^38
			expect(dataResult!.occurrences[0].startOffset).toBe(16);

			expect(artResult).toBeDefined();
			expect(artResult!.occurrences).toHaveLength(1);
			expect(artResult!.occurrences[0].startOffset).toBe(38);
		});

		it('should match at line boundaries', () => {
			const source = makeFile('source.md', 'source');
			const content = 'data\nmore data';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].occurrences).toHaveLength(2);
		});
	});

	describe('skip regions', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Machine Learning.md', 'Machine Learning'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);
		});

		it('should skip frontmatter', () => {
			const source = makeFile('source.md', 'source');
			const content = '---\ntitle: Machine Learning\n---\nSome other text.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});

		it('should skip fenced code blocks', () => {
			const source = makeFile('source.md', 'source');
			const content = 'Before\n```\nmachine learning code\n```\nAfter';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});

		it('should skip inline code', () => {
			const source = makeFile('source.md', 'source');
			const content = 'Use `machine learning` as a variable name.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});

		it('should skip existing wikilinks', () => {
			const source = makeFile('source.md', 'source');
			const content = 'Already linked: [[Machine Learning]].';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});

		it('should skip embeds', () => {
			const source = makeFile('source.md', 'source');
			const content = 'Embedded: ![[Machine Learning]].';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});

		it('should match text outside skip regions', () => {
			const source = makeFile('source.md', 'source');
			const content = '---\ntitle: test\n---\nmachine learning is great. Also `code here`.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].occurrences[0].lineNumber).toBe(3);
		});
	});

	describe('overlapping matches (longest wins)', () => {
		beforeEach(() => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Machine.md', 'Machine'),
				makeFile('Machine Learning.md', 'Machine Learning'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);
		});

		it('should prefer longest match when candidates overlap', () => {
			const source = makeFile('source.md', 'source');
			const content = 'I study machine learning every day.';
			const results = scanner.scan(source, content, 20);

			// "Machine Learning" (16 chars) should win over "Machine" (7 chars)
			const mlResult = results.find(r => r.targetDisplayName === 'Machine Learning');
			const machineResult = results.find(r => r.targetDisplayName === 'Machine');

			expect(mlResult).toBeDefined();
			expect(mlResult!.occurrences).toHaveLength(1);

			// "Machine" alone should NOT match at the same position
			// (it could match elsewhere if "machine" appears standalone)
			if (machineResult) {
				// If it matched, it should NOT overlap with the ML match
				for (const occ of machineResult.occurrences) {
					expect(occ.startOffset).not.toBe(mlResult!.occurrences[0].startOffset);
				}
			}
		});
	});

	describe('self-reference exclusion', () => {
		it('should not match the source note itself', () => {
			const files = [
				makeFile('Machine Learning.md', 'Machine Learning'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);

			const source = makeFile('Machine Learning.md', 'Machine Learning');
			const content = 'This note is about machine learning.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(0);
		});
	});

	describe('max links limit', () => {
		it('should respect maxLinks parameter', () => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Alpha.md', 'Alpha'),
				makeFile('Beta.md', 'Beta'),
				makeFile('Gamma.md', 'Gamma'),
				makeFile('Delta.md', 'Delta'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);

			const source = makeFile('source.md', 'source');
			const content = 'alpha beta gamma delta';
			const results = scanner.scan(source, content, 2);

			expect(results).toHaveLength(2);
		});
	});

	describe('unicode/special characters', () => {
		it('should handle unicode titles', () => {
			const files = [
				makeFile('source.md', 'source'),
				makeFile('Résumé.md', 'Résumé'),
			];
			scanner = new MentionScanner(makeApp(files), noExclusions);

			const source = makeFile('source.md', 'source');
			const content = 'Update your résumé today.';
			const results = scanner.scan(source, content, 20);

			expect(results).toHaveLength(1);
			expect(results[0].targetDisplayName).toBe('Résumé');
		});
	});
});
