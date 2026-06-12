import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PromptBuilder } from './prompt-builder';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

describe('PromptBuilder', () => {
	let settings: SynapseSettings;
	let completeSpy: ReturnType<typeof vi.spyOn>;
	let builder: PromptBuilder;

	beforeEach(() => {
		settings = makeSettings();
		completeSpy = vi.spyOn(AIClient.prototype, 'complete');
		builder = new PromptBuilder(() => settings);
	});

	afterEach(() => vi.restoreAllMocks());

	describe('suggestExternalLinks', () => {
		it('returns an empty array without calling the AI when maxExternalLinks is 0', async () => {
			settings.enrichment.maxExternalLinks = 0;
			const result = await builder.suggestExternalLinks('content', []);
			expect(result).toEqual([]);
			expect(completeSpy).not.toHaveBeenCalled();
		});

		it('parses a valid JSON array and sanitizes title/reason fields', async () => {
			settings.enrichment.maxExternalLinks = 3;
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ url: 'https://en.wikipedia.org/wiki/X', title: 'X [page]', reason: 'auth (src)' },
				])
			);

			const result = await builder.suggestExternalLinks('note text', []);
			expect(result).toHaveLength(1);
			expect(result[0].url).toBe('https://en.wikipedia.org/wiki/X');
			expect(result[0].title).toBe('X page');
			expect(result[0].reason).toBe('auth src');
		});

		it('strips a ```json fence before parsing', async () => {
			settings.enrichment.maxExternalLinks = 3;
			completeSpy.mockResolvedValue(
				'```json\n[{"url":"https://ok.com","title":"Ok","reason":"good"}]\n```'
			);

			const result = await builder.suggestExternalLinks('text', []);
			expect(result).toHaveLength(1);
			expect(result[0].url).toBe('https://ok.com');
		});

		it('filters out entries with invalid URLs or missing fields', async () => {
			settings.enrichment.maxExternalLinks = 5;
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ url: 'javascript:alert(1)', title: 'bad', reason: 'evil' },
					{ url: 'https://good.com', title: 'good', reason: 'fine' },
					{ url: 'https://nofields.com', title: 'missing reason' },
				])
			);

			const result = await builder.suggestExternalLinks('text', []);
			expect(result).toHaveLength(1);
			expect(result[0].url).toBe('https://good.com');
		});

		it('caps the result count at maxExternalLinks', async () => {
			settings.enrichment.maxExternalLinks = 2;
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ url: 'https://a.com', title: 'a', reason: 'r' },
					{ url: 'https://b.com', title: 'b', reason: 'r' },
					{ url: 'https://c.com', title: 'c', reason: 'r' },
				])
			);

			const result = await builder.suggestExternalLinks('text', []);
			expect(result).toHaveLength(2);
		});

		it('includes existing links in the prompt context', async () => {
			settings.enrichment.maxExternalLinks = 3;
			completeSpy.mockResolvedValue('[]');

			await builder.suggestExternalLinks('text', ['https://existing.com']);
			const prompt = completeSpy.mock.calls[0][0] as string;
			expect(prompt).toContain('https://existing.com');
		});

		it('returns an empty array when the AI response is not valid JSON', async () => {
			settings.enrichment.maxExternalLinks = 3;
			completeSpy.mockResolvedValue('totally not json');
			const result = await builder.suggestExternalLinks('text', []);
			expect(result).toEqual([]);
		});

		it('returns an empty array when the AI throws', async () => {
			settings.enrichment.maxExternalLinks = 3;
			completeSpy.mockRejectedValue(new Error('boom'));
			const result = await builder.suggestExternalLinks('text', []);
			expect(result).toEqual([]);
		});
	});

	describe('suggestFrontmatter', () => {
		it('parses valid suggestions and filters out keys that already exist', async () => {
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ key: 'category', value: 'reference', action: 'add' },
					{ key: 'status', value: 'draft', action: 'add' },
				])
			);

			const result = await builder.suggestFrontmatter('text', { status: 'published' });
			expect(result).toHaveLength(1);
			expect(result[0].key).toBe('category');
		});

		it('never suggests the reserved tags key', async () => {
			completeSpy.mockResolvedValue(
				JSON.stringify([{ key: 'tags', value: ['a'], action: 'merge' }])
			);

			const result = await builder.suggestFrontmatter('text', {});
			expect(result).toEqual([]);
		});

		it('rejects prototype-pollution and malformed frontmatter keys', async () => {
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ key: '__proto__', value: 'x', action: 'add' },
					{ key: 'Invalid Key', value: 'x', action: 'add' },
					{ key: 'valid-key', value: 'x', action: 'add' },
				])
			);

			const result = await builder.suggestFrontmatter('text', {});
			expect(result).toHaveLength(1);
			expect(result[0].key).toBe('valid-key');
		});

		it('drops entries with an invalid action or missing value', async () => {
			completeSpy.mockResolvedValue(
				JSON.stringify([
					{ key: 'a', value: 'x', action: 'replace' },
					{ key: 'b', action: 'add' },
					{ key: 'c', value: 'ok', action: 'merge' },
				])
			);

			const result = await builder.suggestFrontmatter('text', {});
			expect(result.map((r) => r.key)).toEqual(['c']);
		});

		it('returns an empty array when the AI throws', async () => {
			completeSpy.mockRejectedValue(new Error('nope'));
			const result = await builder.suggestFrontmatter('text', {});
			expect(result).toEqual([]);
		});
	});
});
