import { describe, it, expect, vi } from 'vitest';
import { DirectoryMatcher } from './directory-matcher';
import { ContentAnalysis } from './types';
import { TFolder } from '../__mocks__/obsidian';

function makeMockApp(directories: string[]) {
	// Build a folder tree from flat paths
	const root = new TFolder('/');
	root.isRoot = () => true;

	const folderMap = new Map<string, TFolder>();
	folderMap.set('/', root);

	for (const dirPath of directories) {
		const parts = dirPath.split('/');
		let current = root;
		let accumulated = '';

		for (const part of parts) {
			accumulated = accumulated ? `${accumulated}/${part}` : part;
			if (!folderMap.has(accumulated)) {
				const folder = new TFolder(accumulated);
				folder.parent = current;
				folderMap.set(accumulated, folder);
				current.children.push(folder);
			}
			current = folderMap.get(accumulated)!;
		}
	}

	return {
		vault: {
			getRoot: () => root,
		},
	} as any;
}

function makeAnalysis(overrides: Partial<ContentAnalysis> = {}): ContentAnalysis {
	return {
		notePath: 'notes/test.md',
		topics: [{ label: 'machine learning', confidence: 0.9 }],
		tags: [],
		links: [],
		...overrides,
	};
}

describe('DirectoryMatcher', () => {
	describe('collectDirectories', () => {
		it('collects all non-root directories', () => {
			const app = makeMockApp(['projects', 'notes', 'notes/daily']);
			const matcher = new DirectoryMatcher(app);
			const dirs = matcher.collectDirectories();
			expect(dirs).toContain('projects');
			expect(dirs).toContain('notes');
			expect(dirs).toContain('notes/daily');
			// Root should not be included
			expect(dirs).not.toContain('/');
		});

		it('returns empty array for a vault with no folders', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			expect(matcher.collectDirectories()).toEqual([]);
		});
	});

	describe('scoreDirectory', () => {
		it('gives highest score to exact topic-directory name match', () => {
			const app = makeMockApp(['machine learning', 'other']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis();

			const exactScore = matcher.scoreDirectory('machine learning', analysis, 'notes');
			const otherScore = matcher.scoreDirectory('other', analysis, 'notes');

			expect(exactScore).toBeGreaterThan(otherScore);
		});

		it('scores partial topic-directory matches', () => {
			const app = makeMockApp(['ml-research']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				topics: [{ label: 'ml', confidence: 0.8 }],
			});

			const score = matcher.scoreDirectory('ml-research', analysis, 'notes');
			expect(score).toBeGreaterThan(0);
		});

		it('boosts score for tag matches', () => {
			const app = makeMockApp(['research']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				topics: [],
				tags: ['#research'],
			});

			const score = matcher.scoreDirectory('research', analysis, 'notes');
			expect(score).toBeGreaterThan(0);
		});

		it('boosts score for linked notes in the directory', () => {
			const app = makeMockApp(['projects']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				topics: [],
				links: ['projects/related-note.md'],
			});

			const score = matcher.scoreDirectory('projects', analysis, 'notes');
			expect(score).toBeGreaterThan(0);
		});

		it('penalizes the note current directory', () => {
			const app = makeMockApp(['notes']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				topics: [{ label: 'notes', confidence: 0.9 }],
			});

			const sameDir = matcher.scoreDirectory('notes', analysis, 'notes');
			const otherDir = matcher.scoreDirectory('notes', analysis, 'other');
			expect(sameDir).toBeLessThan(otherDir);
		});

		it('caps score at 1.0', () => {
			const app = makeMockApp(['machine learning']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				topics: [
					{ label: 'machine learning', confidence: 1 },
					{ label: 'machine', confidence: 1 },
				],
				tags: ['#machine', '#learning'],
				links: ['machine learning/paper.md'],
			});

			const score = matcher.scoreDirectory('machine learning', analysis, 'other');
			expect(score).toBeLessThanOrEqual(1);
		});
	});

	describe('determineAction', () => {
		it('returns move action when existing directory scores above threshold (0.6)', () => {
			const app = makeMockApp(['machine learning', 'other']);
			const matcher = new DirectoryMatcher(app);
			// confidence=1.0 produces exact match score of 0.6 * 1.0 = 0.6 (meets threshold)
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 1.0 }],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('machine learning');
			}
		});

		it('does not move when directory score is below threshold (0.6)', () => {
			const app = makeMockApp(['machine learning', 'other']);
			const matcher = new DirectoryMatcher(app);
			// confidence=0.5 produces exact match score of 0.6 * 0.5 = 0.3 (below 0.6)
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 0.5 }],
			});

			const action = matcher.determineAction(analysis);
			// Score 0.3 < 0.6 threshold, so no move; but confidence 0.5 < 0.9, so no proposal either
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('inbox');
			}
		});

		it('returns propose-new-directory when no directory scores above threshold and confidence >= 0.9', () => {
			const app = makeMockApp(['cooking', 'travel']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 0.95 }],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('propose-new-directory');
			if (action.type === 'propose-new-directory') {
				expect(action.targetDirectory).toBeTruthy();
				expect(action.reasoning).toContain('machine learning');
			}
		});

		it('does not propose new directory when topic confidence is below threshold', () => {
			const app = makeMockApp(['cooking', 'travel']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 0.7 }],
			});

			const action = matcher.determineAction(analysis);
			// 0.7 confidence < 0.9 threshold, so note stays put
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('inbox');
			}
		});

		it('does not propose new directory when tag-derived topics have low confidence', () => {
			const app = makeMockApp(['cooking', 'travel']);
			const matcher = new DirectoryMatcher(app);
			// Tag-derived topics have 0.3 confidence (after the fix), well below 0.9
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'programming', confidence: 0.3 }],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('inbox');
			}
		});

		it('respects custom confidence threshold parameter', () => {
			const app = makeMockApp(['cooking', 'travel']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 0.6 }],
			});

			// With a lowered confidence threshold of 0.5, should propose new directory
			const action = matcher.determineAction(analysis, 0.6, 0.5);
			expect(action.type).toBe('propose-new-directory');
		});

		it('filters out the current directory from candidates', () => {
			const app = makeMockApp(['notes', 'machine learning']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'notes/test.md',
				topics: [{ label: 'notes', confidence: 0.9 }],
			});

			const action = matcher.determineAction(analysis, 0.01, 0.01);
			// Should not suggest moving to the same directory
			if (action.type === 'move') {
				expect(action.targetDirectory).not.toBe('notes');
			}
		});

		it('returns current directory move when no topics exist', () => {
			const app = makeMockApp(['projects']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('inbox');
			}
		});
	});

	describe('buildDirectoryPath', () => {
		it('converts topic to lowercase kebab-case', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			expect(matcher.buildDirectoryPath('Machine Learning')).toBe('machine-learning');
		});

		it('removes special characters', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			expect(matcher.buildDirectoryPath('C++ Programming!')).toBe('c-programming');
		});

		it('collapses multiple hyphens', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			expect(matcher.buildDirectoryPath('a   b   c')).toBe('a-b-c');
		});

		it('trims leading and trailing hyphens', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			expect(matcher.buildDirectoryPath(' -test- ')).toBe('test');
		});

		it('truncates to 50 characters', () => {
			const app = makeMockApp([]);
			const matcher = new DirectoryMatcher(app);
			const long = 'a'.repeat(100);
			expect(matcher.buildDirectoryPath(long).length).toBeLessThanOrEqual(50);
		});
	});

	describe('scoreDirectories', () => {
		it('returns scores sorted by relevance (highest first)', () => {
			const app = makeMockApp(['machine learning', 'cooking', 'random']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({ notePath: 'inbox/test.md' });

			const scores = matcher.scoreDirectories(analysis);
			for (let i = 1; i < scores.length; i++) {
				expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
			}
		});

		it('only includes directories with positive scores', () => {
			const app = makeMockApp(['unrelated-stuff']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'quantum physics', confidence: 0.9 }],
				tags: [],
				links: [],
			});

			const scores = matcher.scoreDirectories(analysis);
			for (const s of scores) {
				expect(s.score).toBeGreaterThan(0);
			}
		});
	});
});
