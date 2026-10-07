import { describe, it, expect, vi } from 'vitest';
import { DirectoryMatcher } from './directory-matcher';
import { ContentAnalysis } from './types';
import { TFolder } from '../__mocks__/obsidian';
import type { App } from 'obsidian';

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
	} as unknown as App;
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
			// confidence=1.0 produces exact match score of 0.4 + 0.4 * 1.0 = 0.8 (meets threshold)
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
			// confidence=0.4 produces exact match score of 0.4 + 0.4 * 0.4 = 0.56 (below 0.6)
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'machine learning', confidence: 0.4 }],
			});

			const action = matcher.determineAction(analysis);
			// Score 0.56 < 0.6 threshold, so no move; but confidence 0.4 < 0.9, so no proposal either
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

		it('keeps a note whose top topic names its own folder in place instead of proposing it as new (#565)', () => {
			const app = makeMockApp(['notes', 'machine learning']);
			const matcher = new DirectoryMatcher(app);
			const analysis = makeAnalysis({
				notePath: 'notes/test.md',
				topics: [{ label: 'notes', confidence: 0.9 }],
			});

			// The own folder is not a move candidate; the canonical "note" path already exists as that folder.
			expect(matcher.determineAction(analysis, 0.01, 0.01)).toEqual({ type: 'move', targetDirectory: 'notes' });
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

	describe('existing folders are never proposed as new (#565)', () => {
		it('moves into an exact canonical match at 0.95 topic confidence', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['artificial-intelligence', 'AI', 'cooking']));
			const analysis = makeAnalysis({
				notePath: 'inbox/agents.md',
				topics: [{ label: 'artificial intelligence', confidence: 0.95 }],
			});

			expect(matcher.determineAction(analysis)).toEqual({ type: 'move', targetDirectory: 'artificial-intelligence' });
		});

		it('an exact match clears the move threshold from topic confidence 0.5 up', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['artificial-intelligence']));
			const at = (confidence: number) => matcher.scoreDirectory('artificial-intelligence', makeAnalysis({
				notePath: 'inbox/a.md',
				topics: [{ label: 'artificial intelligence', confidence }],
			}), 'inbox');

			expect(at(0.5)).toBeCloseTo(0.6, 5);
			expect(at(0.49)).toBeLessThan(0.6);
		});

		it('a note already in the folder its top topic names yields no proposal', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['artificial-intelligence', 'job-search']));

			expect(matcher.determineAction(makeAnalysis({
				notePath: 'artificial-intelligence/AI Agents.md',
				topics: [{ label: 'artificial intelligence', confidence: 0.95 }],
			}))).toEqual({ type: 'move', targetDirectory: 'artificial-intelligence' });
			expect(matcher.determineAction(makeAnalysis({
				notePath: 'job-search/index.md',
				topics: [{ label: 'job search', confidence: 0.95 }],
			}))).toEqual({ type: 'move', targetDirectory: 'job-search' });
		});

		it('a canonical path that exists as a nested folder is a move to it, not a new root folder', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['research/ai-safety', 'cooking']));
			const analysis = makeAnalysis({
				notePath: 'inbox/a.md',
				topics: [{ label: 'research AI safety', confidence: 0.95 }],
			});

			expect(matcher.determineAction(analysis)).toEqual({ type: 'move', targetDirectory: 'research/ai-safety' });
		});

		it('"Projects" as a topic moves into an existing "Project" folder', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['Project', 'cooking']));
			const analysis = makeAnalysis({
				notePath: 'inbox/a.md',
				topics: [{ label: 'Projects', confidence: 0.95 }],
			});

			expect(matcher.determineAction(analysis)).toEqual({ type: 'move', targetDirectory: 'Project' });
		});

		it('findExistingDirectory prefers the full-path match over a basename match', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['archive/project', 'work/archive-project']));
			expect(matcher.findExistingDirectory('archive-project')).toBe('archive/project');
			expect(matcher.findExistingDirectory('project')).toBe('archive/project');
			expect(matcher.findExistingDirectory('nothing-here')).toBeNull();
			expect(matcher.findExistingDirectory('')).toBeNull();
		});

		it('allowNewDirectory: false keeps the note in place when no existing folder clears the threshold', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['cooking', 'travel']));
			const analysis = makeAnalysis({
				notePath: 'inbox/a.md',
				topics: [{ label: 'machine learning', confidence: 0.95 }],
			});

			expect(matcher.determineAction(analysis, undefined, undefined, { allowNewDirectory: false })).toEqual({ type: 'move', targetDirectory: 'inbox' });
			expect(matcher.determineAction(analysis).type).toBe('propose-new-directory');
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

	describe('coalescing similar names (#172)', () => {
		it('singularizes folder names built from topics', () => {
			const matcher = new DirectoryMatcher(makeMockApp([]));
			expect(matcher.buildDirectoryPath('models')).toBe('model');
			expect(matcher.buildDirectoryPath('meeting notes')).toBe('meeting-note');
			expect(matcher.buildDirectoryPath('Categories')).toBe('category');
		});

		it('scores a singular topic highly against a plural directory', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['models', 'other']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'model', confidence: 1.0 }],
			});

			expect(matcher.scoreDirectory('models', analysis, 'inbox')).toBeCloseTo(0.8, 5);
			expect(matcher.scoreDirectory('other', analysis, 'inbox')).toBe(0);
		});

		it('moves a plural topic into an existing singular directory', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['model']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'models', confidence: 1.0 }],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('move');
			if (action.type === 'move') {
				expect(action.targetDirectory).toBe('model');
			}
		});

		it('proposes a singular (canonical) directory for a new plural topic', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['unrelated']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'models', confidence: 0.95 }],
			});

			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('propose-new-directory');
			if (action.type === 'propose-new-directory') {
				expect(action.targetDirectory).toBe('model');
			}
		});

		it('applies a conservative fuzzy match for long near-identical names', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['marketing']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'marketng', confidence: 1.0 }],
			});

			// Weak tier: scores below the exact-match tier, above zero.
			expect(matcher.scoreDirectory('marketing', analysis, 'inbox')).toBeCloseTo(0.4, 5);
		});

		it('does not fuzzy-match short, distinct names', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['code']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'node', confidence: 1.0 }],
			});

			expect(matcher.scoreDirectory('code', analysis, 'inbox')).toBe(0);
		});

		it('does not let a lone fuzzy match cross the move threshold', () => {
			const matcher = new DirectoryMatcher(makeMockApp(['marketing']));
			const analysis = makeAnalysis({
				notePath: 'inbox/test.md',
				topics: [{ label: 'marketng', confidence: 1.0 }],
			});

			// 0.4 fuzzy score is below the 0.6 move threshold, so a new directory
			// is proposed rather than hijacking the near-match folder.
			const action = matcher.determineAction(analysis);
			expect(action.type).toBe('propose-new-directory');
		});
	});
});
