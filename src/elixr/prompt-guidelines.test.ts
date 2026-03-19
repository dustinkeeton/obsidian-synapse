import { describe, it, expect } from 'vitest';
import { buildElixrPromptFragment, LEVEL_GUIDELINES } from './prompt-guidelines';
import { ExpertiseLevel } from './types';

describe('LEVEL_GUIDELINES', () => {
	it('has guidelines for all four levels', () => {
		const levels: ExpertiseLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
		for (const level of levels) {
			expect(LEVEL_GUIDELINES[level]).toBeTruthy();
			expect(typeof LEVEL_GUIDELINES[level]).toBe('string');
			expect(LEVEL_GUIDELINES[level].length).toBeGreaterThan(0);
		}
	});

	it('beginner guidelines mention simple language', () => {
		expect(LEVEL_GUIDELINES.beginner.toLowerCase()).toContain('simple');
	});

	it('expert guidelines mention technical language', () => {
		expect(LEVEL_GUIDELINES.expert.toLowerCase()).toContain('technical');
	});
});

describe('buildElixrPromptFragment', () => {
	it('includes the topic name when a topic is matched', () => {
		const fragment = buildElixrPromptFragment('Machine Learning', 'expert');
		expect(fragment).toContain('[EliXr');
		expect(fragment).toContain('Machine Learning');
		expect(fragment).toContain(LEVEL_GUIDELINES.expert);
	});

	it('uses general context when topic is null', () => {
		const fragment = buildElixrPromptFragment(null, 'beginner');
		expect(fragment).toContain('General expertise context');
		expect(fragment).toContain(LEVEL_GUIDELINES.beginner);
	});

	it('returns a string starting with newlines for concatenation', () => {
		const fragment = buildElixrPromptFragment(null, 'intermediate');
		expect(fragment.startsWith('\n\n')).toBe(true);
	});
});
