import { describe, it, expect } from 'vitest';
import { resolveExpertise } from './topic-resolver';
import { ElixrSettings } from './types';

function makeSettings(overrides?: Partial<ElixrSettings>): ElixrSettings {
	return {
		enabled: true,
		entries: [],
		defaultLevel: 'intermediate',
		...overrides,
	};
}

describe('resolveExpertise', () => {
	it('returns default level when EliXr is disabled', () => {
		const settings = makeSettings({ enabled: false, entries: [{ topic: 'ML', level: 'expert' }] });
		const result = resolveExpertise('This note is about ML.', settings);
		expect(result).toEqual({ topic: null, level: 'intermediate' });
	});

	it('returns default level when entries are empty', () => {
		const settings = makeSettings({ entries: [] });
		const result = resolveExpertise('Some note content', settings);
		expect(result).toEqual({ topic: null, level: 'intermediate' });
	});

	it('returns default level when no topic matches', () => {
		const settings = makeSettings({
			entries: [{ topic: 'quantum computing', level: 'beginner' }],
		});
		const result = resolveExpertise('This is about baking cookies.', settings);
		expect(result).toEqual({ topic: null, level: 'intermediate' });
	});

	it('matches a topic case-insensitively', () => {
		const settings = makeSettings({
			entries: [{ topic: 'Machine Learning', level: 'expert' }],
		});
		const result = resolveExpertise('An introduction to machine learning algorithms.', settings);
		expect(result).toEqual({ topic: 'Machine Learning', level: 'expert' });
	});

	it('returns the earliest-matching topic when multiple match', () => {
		const settings = makeSettings({
			entries: [
				{ topic: 'neural networks', level: 'advanced' },
				{ topic: 'machine learning', level: 'expert' },
			],
		});
		const content = 'Machine learning encompasses neural networks and more.';
		const result = resolveExpertise(content, settings);
		expect(result).toEqual({ topic: 'machine learning', level: 'expert' });
	});

	it('skips entries with empty or whitespace-only topics', () => {
		const settings = makeSettings({
			entries: [
				{ topic: '  ', level: 'beginner' },
				{ topic: 'valid topic', level: 'advanced' },
			],
		});
		const result = resolveExpertise('This is about a valid topic.', settings);
		expect(result).toEqual({ topic: 'valid topic', level: 'advanced' });
	});

	it('uses the configured default level for fallback', () => {
		const settings = makeSettings({
			defaultLevel: 'expert',
			entries: [{ topic: 'cooking', level: 'beginner' }],
		});
		const result = resolveExpertise('A note about astronomy.', settings);
		expect(result).toEqual({ topic: null, level: 'expert' });
	});

	it('matches partial words (substring match)', () => {
		const settings = makeSettings({
			entries: [{ topic: 'bio', level: 'beginner' }],
		});
		const result = resolveExpertise('Biochemistry is fascinating.', settings);
		expect(result).toEqual({ topic: 'bio', level: 'beginner' });
	});
});
