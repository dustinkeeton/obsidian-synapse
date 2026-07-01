import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { SemanticMatcher } from './semantic-matcher';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile as rawFile } from '../__test-utils__/mock-factories';
import type { App, TFile } from 'obsidian';

// The mock TFile (from __test-utils__) and obsidian's real TFile differ
// structurally; tests only need the runtime instance, so cross the boundary
// once here with a typed cast.
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	mutate?.(s);
	return s;
}

describe('SemanticMatcher', () => {
	let app: ReturnType<typeof createMockApp>;
	let settings: SynapseSettings;
	let completeSpy: MockInstance<typeof AIClient.prototype.complete>;

	beforeEach(() => {
		app = createMockApp();
		settings = makeSettings((s) => {
			s.rem.confidenceThreshold = 0.5;
		});
		completeSpy = vi.spyOn(AIClient.prototype, 'complete');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeMatcher(): SemanticMatcher {
		return new SemanticMatcher(app as unknown as App, () => settings);
	}

	it('returns an empty array when the vault has no other notes', async () => {
		const source = mockFile('notes/Source.md');
		app.vault.getMarkdownFiles.mockReturnValue([source]);

		const result = await makeMatcher().match(source, 'content', new Set(), 10);

		expect(result).toEqual([]);
		expect(completeSpy).not.toHaveBeenCalled();
	});

	it('excludes the source note and already-matched notes from the candidate title list', async () => {
		const source = mockFile('notes/Source.md');
		const matched = mockFile('notes/Already.md');
		const candidateNote = mockFile('notes/Neural Networks.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, matched, candidateNote]);
		completeSpy.mockResolvedValue('[]');

		await makeMatcher().match(source, 'about deep learning', new Set(['notes/Already.md']), 10);

		const userPrompt = completeSpy.mock.calls[0][0];
		expect(userPrompt).toContain('Neural Networks');
		expect(userPrompt).not.toContain('Already');
		expect(userPrompt).not.toContain('Source');
	});

	it('builds candidates from a valid AI response and locates the concept in the text', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/ML Fundamentals.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockResolvedValue(
			JSON.stringify([
				{ title: 'ML Fundamentals', matchedConcept: 'machine learning', confidence: 0.9 },
			])
		);

		const content = 'This note discusses machine learning in depth.\nMore machine learning here.';
		const result = await makeMatcher().match(source, content, new Set(), 10);

		expect(result).toHaveLength(1);
		expect(result[0].targetPath).toBe('notes/ML Fundamentals.md');
		expect(result[0].targetDisplayName).toBe('ML Fundamentals');
		expect(result[0].matchType).toBe('semantic');
		expect(result[0].confidence).toBe(0.9);
		expect(result[0].occurrences).toHaveLength(2);
		expect(result[0].occurrences[0]).toMatchObject({ lineNumber: 0, startOffset: 20 });
	});

	it('strips ```json code fences before parsing', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Topic.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockResolvedValue(
			'```json\n[{"title":"Topic","matchedConcept":"topic","confidence":0.8}]\n```'
		);

		const result = await makeMatcher().match(source, 'a topic line', new Set(), 10);
		expect(result).toHaveLength(1);
		expect(result[0].targetDisplayName).toBe('Topic');
	});

	it('drops matches below the configured confidence threshold', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Topic.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		settings.rem.confidenceThreshold = 0.7;
		completeSpy.mockResolvedValue(
			JSON.stringify([{ title: 'Topic', matchedConcept: 'topic', confidence: 0.6 }])
		);

		const result = await makeMatcher().match(source, 'topic', new Set(), 10);
		expect(result).toEqual([]);
	});

	it('ignores AI-suggested titles that do not correspond to a real note', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Real.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockResolvedValue(
			JSON.stringify([{ title: 'Hallucinated', matchedConcept: 'x', confidence: 0.9 }])
		);

		const result = await makeMatcher().match(source, 'x', new Set(), 10);
		expect(result).toEqual([]);
	});

	it('sorts by confidence descending and caps results at maxLinks', async () => {
		const source = mockFile('notes/Source.md');
		const a = mockFile('notes/A.md');
		const b = mockFile('notes/B.md');
		const c = mockFile('notes/C.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, a, b, c]);
		completeSpy.mockResolvedValue(
			JSON.stringify([
				{ title: 'A', matchedConcept: 'a', confidence: 0.6 },
				{ title: 'B', matchedConcept: 'b', confidence: 0.95 },
				{ title: 'C', matchedConcept: 'c', confidence: 0.8 },
			])
		);

		const result = await makeMatcher().match(source, 'a b c', new Set(), 2);
		expect(result.map((r) => r.targetDisplayName)).toEqual(['B', 'C']);
	});

	it('returns an empty array when the AI client throws', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Topic.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockRejectedValue(new Error('network down'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await makeMatcher().match(source, 'topic', new Set(), 10);
		expect(result).toEqual([]);
		expect(warn).toHaveBeenCalled();
	});

	it('returns an empty array when the AI response is not valid JSON', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Topic.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockResolvedValue('not json at all');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await makeMatcher().match(source, 'topic', new Set(), 10);
		expect(result).toEqual([]);
	});

	it('returns an empty array when the AI response is valid JSON but not an array', async () => {
		const source = mockFile('notes/Source.md');
		const target = mockFile('notes/Topic.md');
		app.vault.getMarkdownFiles.mockReturnValue([source, target]);
		completeSpy.mockResolvedValue('{"not":"an array"}');

		const result = await makeMatcher().match(source, 'topic', new Set(), 10);
		expect(result).toEqual([]);
	});
});
