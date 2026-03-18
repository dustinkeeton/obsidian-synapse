import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataClassifier } from './metadata-classifier';
import { SynapseSettings, DEFAULT_SETTINGS } from '../settings';

const mockComplete = vi.fn();

vi.mock('../shared', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
	sanitizeAIResponse: (text: string) => text,
}));

function makeSettings(overrides?: Partial<SynapseSettings['enrichment']>): () => SynapseSettings {
	return () => ({
		...DEFAULT_SETTINGS,
		enrichment: {
			...DEFAULT_SETTINGS.enrichment,
			...overrides,
		},
	});
}

describe('MetadataClassifier', () => {
	beforeEach(() => {
		mockComplete.mockReset();
	});

	it('returns valid classifications from AI response', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "draft", "confidence": 0.9}, {"tag": "meeting", "confidence": 0.7}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some note content', []);

		expect(results).toHaveLength(2);
		expect(results[0].tag).toBe('#draft');
		expect(results[0].category).toBe('Status');
		expect(results[0].confidence).toBe(0.9);
		expect(results[1].tag).toBe('#meeting');
		expect(results[1].category).toBe('Type');
	});

	it('rejects hallucinated tags not in vocabulary', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "draft", "confidence": 0.9}, {"tag": "machine-learning", "confidence": 0.8}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some note content', []);

		expect(results).toHaveLength(1);
		expect(results[0].tag).toBe('#draft');
	});

	it('skips tags already on the note', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "draft", "confidence": 0.9}, {"tag": "meeting", "confidence": 0.7}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some content', ['#draft']);

		expect(results).toHaveLength(1);
		expect(results[0].tag).toBe('#meeting');
	});

	it('handles AI returning invalid JSON gracefully', async () => {
		mockComplete.mockResolvedValue('not valid json');

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some content', []);

		expect(results).toHaveLength(0);
	});

	it('handles AI error gracefully', async () => {
		mockComplete.mockRejectedValue(new Error('API error'));

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some content', []);

		expect(results).toHaveLength(0);
	});

	it('returns empty array when vocabulary is empty', async () => {
		const classifier = new MetadataClassifier(
			makeSettings({ tagVocabulary: [] })
		);
		const results = await classifier.classify('Some content', []);

		expect(results).toHaveLength(0);
		expect(mockComplete).not.toHaveBeenCalled();
	});

	it('respects maxTags setting', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "draft", "confidence": 0.9}, {"tag": "todo", "confidence": 0.8}, {"tag": "meeting", "confidence": 0.7}, {"tag": "idea", "confidence": 0.6}, {"tag": "project", "confidence": 0.5}, {"tag": "log", "confidence": 0.4}]'
		);

		const classifier = new MetadataClassifier(makeSettings({ maxTags: 3 }));
		const results = await classifier.classify('Some content', []);

		expect(results).toHaveLength(3);
		// Should be sorted by confidence descending
		expect(results[0].confidence).toBe(0.9);
		expect(results[2].confidence).toBe(0.7);
	});

	it('validates confidence bounds', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "draft", "confidence": 1.5}, {"tag": "meeting", "confidence": -0.1}, {"tag": "todo", "confidence": 0.8}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some content', []);

		// Only "todo" has valid confidence 0-1
		expect(results).toHaveLength(1);
		expect(results[0].tag).toBe('#todo');
	});

	it('handles nested/prefixed tags like source/video', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "source/video", "confidence": 0.85}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Video transcription content', []);

		expect(results).toHaveLength(1);
		expect(results[0].tag).toBe('#source/video');
		expect(results[0].category).toBe('Source');
	});

	it('strips # prefix from AI response tags before matching', async () => {
		mockComplete.mockResolvedValue(
			'[{"tag": "#draft", "confidence": 0.9}]'
		);

		const classifier = new MetadataClassifier(makeSettings());
		const results = await classifier.classify('Some content', []);

		expect(results).toHaveLength(1);
		expect(results[0].tag).toBe('#draft');
	});
});
