import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAnalyzer } from './content-analyzer';
import { createMockApp } from '../__test-utils__/mock-factories';
import { DEFAULT_SETTINGS } from '../settings';

const mockComplete = vi.fn().mockResolvedValue('[{"label": "test", "confidence": 0.5}]');

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
}));

/**
 * Only the pure/parseable methods of ContentAnalyzer are unit-tested here.
 * The full analyze() flow requires mocked AI responses and is an
 * integration concern.
 */
describe('ContentAnalyzer', () => {
	function makeAnalyzer() {
		const app = createMockApp() as any;
		const getSettings = () => structuredClone(DEFAULT_SETTINGS);
		return new ContentAnalyzer(app, getSettings);
	}

	describe('parseTopicResponse', () => {
		it('parses a valid JSON array of topics', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'[{"label": "Machine Learning", "confidence": 0.9}, {"label": "Research", "confidence": 0.6}]'
			);
			expect(result).toHaveLength(2);
			expect(result[0].label).toBe('machine learning');
			expect(result[0].confidence).toBe(0.9);
			expect(result[1].label).toBe('research');
		});

		it('strips code fences from response', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'```json\n[{"label": "testing", "confidence": 0.8}]\n```'
			);
			expect(result).toHaveLength(1);
			expect(result[0].label).toBe('testing');
		});

		it('extracts JSON array from surrounding text', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'Here are the topics:\n[{"label": "cooking", "confidence": 0.7}]\nHope this helps!'
			);
			expect(result).toHaveLength(1);
			expect(result[0].label).toBe('cooking');
		});

		it('returns empty array for invalid JSON', () => {
			const analyzer = makeAnalyzer();
			expect(analyzer.parseTopicResponse('not json at all')).toEqual([]);
		});

		it('returns empty array for non-array JSON', () => {
			const analyzer = makeAnalyzer();
			expect(analyzer.parseTopicResponse('{"label": "test"}')).toEqual([]);
		});

		it('filters out items with missing label or confidence', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'[{"label": "valid", "confidence": 0.8}, {"label": 123, "confidence": 0.5}, {"confidence": 0.3}]'
			);
			expect(result).toHaveLength(1);
			expect(result[0].label).toBe('valid');
		});

		it('clamps confidence to 0-1 range', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'[{"label": "test", "confidence": 1.5}]'
			);
			expect(result[0].confidence).toBe(1);
		});

		it('limits to 3 topics maximum', () => {
			const analyzer = makeAnalyzer();
			const topics = Array.from({ length: 5 }, (_, i) => ({
				label: `topic-${i}`,
				confidence: 0.8,
			}));
			const result = analyzer.parseTopicResponse(JSON.stringify(topics));
			expect(result).toHaveLength(3);
		});

		it('lowercases and trims topic labels', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.parseTopicResponse(
				'[{"label": "  Project Planning  ", "confidence": 0.9}]'
			);
			expect(result[0].label).toBe('project planning');
		});
	});

	describe('topicsFromTags', () => {
		it('converts tags to topics with 0.3 confidence', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.topicsFromTags(['#machine-learning', '#research']);
			expect(result).toHaveLength(2);
			expect(result[0].label).toBe('machine-learning');
			expect(result[0].confidence).toBe(0.3);
		});

		it('removes hash prefix and converts slashes to spaces', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.topicsFromTags(['#source/video']);
			expect(result[0].label).toBe('source video');
		});

		it('returns empty array for no tags', () => {
			const analyzer = makeAnalyzer();
			expect(analyzer.topicsFromTags([])).toEqual([]);
		});

		it('limits to 3 tags', () => {
			const analyzer = makeAnalyzer();
			const tags = Array.from({ length: 5 }, (_, i) => `#tag-${i}`);
			const result = analyzer.topicsFromTags(tags);
			expect(result).toHaveLength(3);
		});

		it('filters out empty labels after cleaning', () => {
			const analyzer = makeAnalyzer();
			const result = analyzer.topicsFromTags(['#']);
			expect(result).toHaveLength(0);
		});
	});

	describe('extractTopics — prompt steering (#172)', () => {
		beforeEach(() => {
			mockComplete.mockClear();
			mockComplete.mockResolvedValue('[{"label": "test", "confidence": 0.5}]');
		});

		it('asks the model for broad, singular category labels', async () => {
			const analyzer = makeAnalyzer();
			await analyzer.extractTopics('Some note body about machine learning.', []);

			expect(mockComplete).toHaveBeenCalled();
			const systemPrompt = mockComplete.mock.calls[0][1] as string;
			expect(systemPrompt).toContain('singular');
			expect(systemPrompt).toMatch(/broad|umbrella/i);
		});
	});
});
