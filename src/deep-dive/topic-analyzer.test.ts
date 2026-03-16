import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicAnalyzer } from './topic-analyzer';

// ── Mock AI Client ──
const mockComplete = vi.fn();
vi.mock('../shared', () => ({
	AIClient: class {
		complete = mockComplete;
	},
	sanitizeAIResponse: (text: string) => text,
}));

// ── Mock Obsidian App ──
const mockFiles = [
	{ basename: 'Existing Note', path: 'notes/Existing Note.md' },
	{ basename: 'Another Note', path: 'notes/Another Note.md' },
];

const mockApp = {
	vault: {
		getMarkdownFiles: () => mockFiles,
	},
} as unknown as import('obsidian').App;

const getSettings = () => ({}) as import('../settings').AutoNotesSettings;

describe('TopicAnalyzer', () => {
	let analyzer: TopicAnalyzer;

	beforeEach(() => {
		vi.clearAllMocks();
		analyzer = new TopicAnalyzer(mockApp, getSettings);
	});

	it('parses valid JSON response from AI', async () => {
		mockComplete.mockResolvedValue(JSON.stringify([
			{
				title: 'Neural Networks',
				description: 'Deep learning architectures',
				relevance: 0.9,
				relatedUrls: ['https://example.com'],
			},
			{
				title: 'Decision Trees',
				description: 'Tree-based classification',
				relevance: 0.7,
				relatedUrls: [],
			},
		]));

		const topics = await analyzer.extractTopics('Some content', 'ML Basics', []);
		expect(topics.length).toBe(2);
		expect(topics[0].title).toBe('Neural Networks');
		expect(topics[0].relevance).toBe(0.9);
		expect(topics[0].relatedUrls).toEqual(['https://example.com']);
		expect(topics[0].existsInVault).toBe(false);
	});

	it('strips markdown code fences from response', async () => {
		mockComplete.mockResolvedValue('```json\n[{"title": "Test", "description": "Desc", "relevance": 0.5, "relatedUrls": []}]\n```');

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics.length).toBe(1);
		expect(topics[0].title).toBe('Test');
	});

	it('marks topics that already exist in vault', async () => {
		mockComplete.mockResolvedValue(JSON.stringify([
			{ title: 'Existing Note', description: 'Already exists', relevance: 0.8, relatedUrls: [] },
			{ title: 'New Topic', description: 'Does not exist', relevance: 0.7, relatedUrls: [] },
		]));

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics.length).toBe(2);

		const existing = topics.find(t => t.title === 'Existing Note')!;
		expect(existing.existsInVault).toBe(true);
		expect(existing.existingPath).toBe('notes/Existing Note.md');

		const newTopic = topics.find(t => t.title === 'New Topic')!;
		expect(newTopic.existsInVault).toBe(false);
		expect(newTopic.existingPath).toBeUndefined();
	});

	it('vault matching is case-insensitive', async () => {
		mockComplete.mockResolvedValue(JSON.stringify([
			{ title: 'existing note', description: 'Case mismatch', relevance: 0.8, relatedUrls: [] },
		]));

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics[0].existsInVault).toBe(true);
	});

	it('returns empty array for invalid JSON', async () => {
		mockComplete.mockResolvedValue('This is not JSON at all');

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics).toEqual([]);
	});

	it('returns empty array for non-array JSON', async () => {
		mockComplete.mockResolvedValue('{"title": "Not an array"}');

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics).toEqual([]);
	});

	it('filters out entries missing required fields', async () => {
		mockComplete.mockResolvedValue(JSON.stringify([
			{ title: 'Good', description: 'Has all fields', relevance: 0.8, relatedUrls: [] },
			{ title: 'Missing desc', relevance: 0.5 },
			{ description: 'Missing title', relevance: 0.5 },
		]));

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics.length).toBe(1);
		expect(topics[0].title).toBe('Good');
	});

	it('clamps relevance to [0, 1]', async () => {
		mockComplete.mockResolvedValue(JSON.stringify([
			{ title: 'High', description: 'Desc', relevance: 1.5, relatedUrls: [] },
			{ title: 'Low', description: 'Desc', relevance: -0.5, relatedUrls: [] },
		]));

		const topics = await analyzer.extractTopics('Content', 'Title', []);
		expect(topics[0].relevance).toBe(1);
		expect(topics[1].relevance).toBe(0);
	});
});
