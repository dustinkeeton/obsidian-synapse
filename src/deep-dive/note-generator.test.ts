import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteGenerator } from './note-generator';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { ExtractedTopic } from './types';

const mockComplete = vi.fn().mockResolvedValue('---\ntags: [topic]\n---\n\n## Overview\n\nGenerated content.');

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
}));

describe('NoteGenerator — image embed preservation', () => {
	let generator: NoteGenerator;

	beforeEach(() => {
		mockComplete.mockClear();
		mockComplete.mockResolvedValue('---\ntags: [topic]\n---\n\n## Overview\n\nGenerated content.');

		const settings = structuredClone(DEFAULT_SETTINGS);
		generator = new NoteGenerator(() => settings);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('includes image embed preservation rule in system prompt', async () => {
		const topic: ExtractedTopic = {
			title: 'Test Topic',
			description: 'A topic for testing',
			relevance: 0.8,
			existsInVault: false,
			relatedUrls: [],
		};

		await generator.generateContent(topic, 'Parent Note', 'Source content here');

		expect(mockComplete).toHaveBeenCalledOnce();
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain(
			'preserve them as markdown image embeds (![alt](url))'
		);
		expect(systemPrompt).toContain('embed them as ![[image.jpg]]');
	});

	it('image embed rule appears alongside the URL reference rule', async () => {
		const topic: ExtractedTopic = {
			title: 'Test Topic',
			description: 'A topic for testing',
			relevance: 0.8,
			existsInVault: false,
			relatedUrls: ['https://example.com'],
		};

		await generator.generateContent(topic, 'Parent Note', 'Source content');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('reference them naturally in the text');
		expect(systemPrompt).toContain(
			'preserve them as markdown image embeds (![alt](url))'
		);
		expect(systemPrompt).toContain('embed them as ![[image.jpg]]');
	});
});
