import { describe, it, expect } from 'vitest';
import { singularize, canonicalKey, editDistance, isFuzzyMatch } from './folder-normalize';

describe('folder-normalize', () => {
	describe('singularize', () => {
		it('strips a simple trailing "s"', () => {
			expect(singularize('models')).toBe('model');
			expect(singularize('projects')).toBe('project');
			expect(singularize('videos')).toBe('video');
		});

		it('handles "ies" -> "y"', () => {
			expect(singularize('categories')).toBe('category');
			expect(singularize('dependencies')).toBe('dependency');
			expect(singularize('stories')).toBe('story');
			expect(singularize('queries')).toBe('query');
		});

		it('handles "-ie" plurals that keep the "e"', () => {
			expect(singularize('movies')).toBe('movie');
			expect(singularize('cookies')).toBe('cookie');
		});

		it('strips "es" after a sibilant cluster', () => {
			expect(singularize('classes')).toBe('class');
			expect(singularize('boxes')).toBe('box');
			expect(singularize('watches')).toBe('watch');
			expect(singularize('dishes')).toBe('dish');
			expect(singularize('branches')).toBe('branch');
		});

		it('keeps the stem "e" for "-se"/"-ge"/"-ze" plurals', () => {
			expect(singularize('phases')).toBe('phase');
			expect(singularize('pages')).toBe('page');
			expect(singularize('databases')).toBe('database');
			expect(singularize('sizes')).toBe('size');
			expect(singularize('releases')).toBe('release');
		});

		it('applies overrides for sibilant collisions', () => {
			expect(singularize('caches')).toBe('cache');
			expect(singularize('niches')).toBe('niche');
		});

		it('applies irregular plurals', () => {
			expect(singularize('children')).toBe('child');
			expect(singularize('people')).toBe('person');
		});

		it('leaves uncountable / already-singular words intact', () => {
			expect(singularize('news')).toBe('news');
			expect(singularize('series')).toBe('series');
			expect(singularize('status')).toBe('status');
			expect(singularize('analysis')).toBe('analysis');
			expect(singularize('axis')).toBe('axis');
			expect(singularize('class')).toBe('class');
			expect(singularize('lens')).toBe('lens');
		});

		it('leaves short words (<= 3 chars) intact', () => {
			expect(singularize('ios')).toBe('ios');
			expect(singularize('css')).toBe('css');
			expect(singularize('js')).toBe('js');
		});

		it('is idempotent', () => {
			for (const w of ['models', 'categories', 'movies', 'classes', 'phases', 'caches', 'children', 'news']) {
				expect(singularize(singularize(w))).toBe(singularize(w));
			}
		});
	});

	describe('canonicalKey', () => {
		it('coalesces singular and plural forms', () => {
			expect(canonicalKey('models')).toBe(canonicalKey('model'));
			expect(canonicalKey('categories')).toBe(canonicalKey('category'));
		});

		it('unifies casing, punctuation, and space-vs-hyphen', () => {
			expect(canonicalKey('Machine Learning')).toBe('machine-learning');
			expect(canonicalKey('machine-learning')).toBe('machine-learning');
			expect(canonicalKey('C++ Programming!')).toBe('c-programming');
		});

		it('singularizes each word of a multi-word label', () => {
			expect(canonicalKey('meeting notes')).toBe('meeting-note');
			expect(canonicalKey('design patterns')).toBe('design-pattern');
		});

		it('returns an empty string for input with no alphanumerics', () => {
			expect(canonicalKey('   --- ')).toBe('');
		});
	});

	describe('editDistance', () => {
		it('returns 0 for identical strings', () => {
			expect(editDistance('marketing', 'marketing')).toBe(0);
		});

		it('counts single-character edits', () => {
			expect(editDistance('marketing', 'marketng')).toBe(1); // deletion
			expect(editDistance('color', 'colour')).toBe(1); // insertion
			expect(editDistance('cat', 'cot')).toBe(1); // substitution
		});
	});

	describe('isFuzzyMatch', () => {
		it('matches long strings within one edit', () => {
			expect(isFuzzyMatch('marketing', 'marketng')).toBe(true);
		});

		it('rejects short, distinct words even at distance 1', () => {
			expect(isFuzzyMatch('node', 'code')).toBe(false);
			expect(isFuzzyMatch('table', 'cable')).toBe(false);
		});

		it('rejects strings more than one edit apart', () => {
			expect(isFuzzyMatch('database', 'metadata')).toBe(false);
		});
	});
});
