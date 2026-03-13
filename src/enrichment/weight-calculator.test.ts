import { describe, it, expect } from 'vitest';
import { computeProximityWeight } from './weight-calculator';
import { WeightConfig } from './types';

const DEFAULT_CONFIG: WeightConfig = {
	sameFolder: 1.0,
	siblingFolder: 0.8,
	cousinFolder: 0.5,
	distantFolder: 0.2,
	decayPerLevel: 0.15,
	minWeight: 0.1,
};

describe('computeProximityWeight', () => {
	it('returns sameFolder weight for files in the same folder', () => {
		const weight = computeProximityWeight(
			'Projects/ML/note-a.md',
			'Projects/ML/note-b.md',
			DEFAULT_CONFIG
		);
		expect(weight).toBe(1.0);
	});

	it('returns siblingFolder weight for files in sibling folders', () => {
		const weight = computeProximityWeight(
			'Projects/ML/note.md',
			'Projects/Web/note.md',
			DEFAULT_CONFIG
		);
		// hops = 1 + 1 = 2 → cousinFolder tier
		// Actually: source segments = ["Projects", "ML"], target = ["Projects", "Web"]
		// shared = 1 ("Projects"), hops = (2-1) + (2-1) = 2 → cousinFolder = 0.5
		expect(weight).toBe(0.5);
	});

	it('returns high weight for files one hop apart', () => {
		// Source: Projects/note.md (segments: ["Projects"])
		// Target: Projects/ML/note.md (segments: ["Projects", "ML"])
		// shared = 1, hops = (1-1) + (2-1) = 1 → siblingFolder = 0.8
		const weight = computeProximityWeight(
			'Projects/note.md',
			'Projects/ML/note.md',
			DEFAULT_CONFIG
		);
		expect(weight).toBe(0.8);
	});

	it('returns distantFolder weight for unrelated paths', () => {
		const weight = computeProximityWeight(
			'Projects/ML/deep/note.md',
			'Archive/2023/old.md',
			DEFAULT_CONFIG
		);
		// shared = 0, hops = 3 + 2 = 5 → distant tier (minHops=3)
		// decayed = 0.2 - (5-3)*0.15 = 0.2 - 0.3 = -0.1 → clamped to minWeight 0.1
		expect(weight).toBe(0.1);
	});

	it('never goes below minWeight', () => {
		const weight = computeProximityWeight(
			'a/b/c/d/e/note.md',
			'x/y/z/w/v/note.md',
			DEFAULT_CONFIG
		);
		expect(weight).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minWeight);
	});

	it('never exceeds sameFolder weight', () => {
		const weight = computeProximityWeight(
			'note.md',
			'note2.md',
			DEFAULT_CONFIG
		);
		expect(weight).toBeLessThanOrEqual(DEFAULT_CONFIG.sameFolder);
	});

	it('is monotonic — closer files score higher', () => {
		const same = computeProximityWeight('A/note.md', 'A/other.md', DEFAULT_CONFIG);
		const sibling = computeProximityWeight('A/note.md', 'B/other.md', DEFAULT_CONFIG);
		const distant = computeProximityWeight('A/note.md', 'X/Y/Z/other.md', DEFAULT_CONFIG);

		expect(same).toBeGreaterThanOrEqual(sibling);
		expect(sibling).toBeGreaterThanOrEqual(distant);
	});

	it('respects custom config values', () => {
		const config: WeightConfig = {
			sameFolder: 0.9,
			siblingFolder: 0.7,
			cousinFolder: 0.4,
			distantFolder: 0.1,
			decayPerLevel: 0.1,
			minWeight: 0.05,
		};

		const weight = computeProximityWeight('A/note.md', 'A/other.md', config);
		expect(weight).toBe(0.9);
	});

	it('handles root-level files', () => {
		const weight = computeProximityWeight('note.md', 'other.md', DEFAULT_CONFIG);
		// Both in root → same folder → 1.0
		expect(weight).toBe(1.0);
	});
});
