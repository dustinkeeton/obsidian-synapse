import { describe, it, expect } from 'vitest';
import { scoreQuality } from './quality-scorer';

describe('scoreQuality', () => {
	const baseOpts = {
		title: 'Machine Learning Algorithms',
		childTopicTitles: ['Neural Networks', 'Decision Trees', 'Support Vectors'],
		wordCount: 300,
		depth: 0,
		maxDepth: 3,
		ancestorTopics: ['Artificial Intelligence'],
	};

	it('returns a score between 0 and 1', () => {
		const result = scoreQuality(baseOpts);
		expect(result.score).toBeGreaterThanOrEqual(0);
		expect(result.score).toBeLessThanOrEqual(1);
	});

	it('gives high score for good quality content', () => {
		const result = scoreQuality(baseOpts);
		expect(result.score).toBeGreaterThanOrEqual(0.7);
		expect(result.isTooGeneric).toBe(false);
		expect(result.hasHighOverlap).toBe(false);
	});

	it('penalizes one-word titles', () => {
		const result = scoreQuality({ ...baseOpts, title: 'Algorithms' });
		expect(result.isTooGeneric).toBe(true);
		expect(result.score).toBeLessThan(scoreQuality(baseOpts).score);
	});

	it('penalizes generic title words', () => {
		const result = scoreQuality({ ...baseOpts, title: 'Basic Introduction Topics' });
		expect(result.isTooGeneric).toBe(true);
	});

	it('penalizes low topic count', () => {
		const result = scoreQuality({ ...baseOpts, childTopicTitles: ['Only One'] });
		expect(result.topicCount).toBe(1);
		expect(result.score).toBeLessThan(scoreQuality(baseOpts).score);
	});

	it('penalizes zero topics', () => {
		const result = scoreQuality({ ...baseOpts, childTopicTitles: [] });
		expect(result.topicCount).toBe(0);
		expect(result.score).toBeLessThan(scoreQuality(baseOpts).score);
	});

	it('penalizes low word count', () => {
		const result = scoreQuality({ ...baseOpts, wordCount: 50 });
		expect(result.score).toBeLessThan(scoreQuality(baseOpts).score);
	});

	it('penalizes high overlap with ancestors', () => {
		const result = scoreQuality({
			...baseOpts,
			ancestorTopics: ['Neural Networks', 'Decision Trees', 'Support Vectors'],
		});
		expect(result.hasHighOverlap).toBe(true);
		expect(result.score).toBeLessThan(scoreQuality(baseOpts).score);
	});

	it('overlap comparison is case-insensitive', () => {
		const result = scoreQuality({
			...baseOpts,
			childTopicTitles: ['neural networks', 'DECISION TREES'],
			ancestorTopics: ['Neural Networks', 'Decision Trees'],
		});
		expect(result.hasHighOverlap).toBe(true);
	});

	it('penalizes deep depth', () => {
		const shallow = scoreQuality({ ...baseOpts, depth: 0 });
		const deep = scoreQuality({ ...baseOpts, depth: 2 });
		expect(deep.score).toBeLessThan(shallow.score);
	});

	it('handles maxDepth of 0 without division by zero', () => {
		const result = scoreQuality({ ...baseOpts, maxDepth: 0 });
		expect(result.score).toBeGreaterThanOrEqual(0);
		expect(Number.isFinite(result.score)).toBe(true);
	});

	it('includes reasoning text', () => {
		const result = scoreQuality(baseOpts);
		expect(result.reasoning).toContain('Score');
	});

	it('mentions specific issues in reasoning', () => {
		const result = scoreQuality({ ...baseOpts, wordCount: 30, childTopicTitles: [] });
		expect(result.reasoning).toContain('short content');
		expect(result.reasoning).toContain('low topic count');
	});

	it('caps score components at 1.0', () => {
		const result = scoreQuality({
			...baseOpts,
			childTopicTitles: ['A', 'B', 'C', 'D', 'E', 'F'],
			wordCount: 1000,
		});
		// Even with excess topics and words, score should not exceed 1.0
		expect(result.score).toBeLessThanOrEqual(1);
	});

	it('rounds score to two decimal places', () => {
		const result = scoreQuality(baseOpts);
		const decimals = result.score.toString().split('.')[1]?.length ?? 0;
		expect(decimals).toBeLessThanOrEqual(2);
	});
});
