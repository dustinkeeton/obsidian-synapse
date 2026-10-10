import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteGenerator } from './note-generator';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { ExtractedTopic } from './types';

const mockComplete = vi
	.fn<(prompt: string, systemPrompt?: string, opts?: unknown) => Promise<string>>()
	.mockResolvedValue('---\ntags: [topic]\n---\n\n## Overview\n\nGenerated content.');

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

	it('forbids speculative wikilinks and drops the related frontmatter field (#581)', async () => {
		const topic: ExtractedTopic = {
			title: 'Test Topic',
			description: 'A topic for testing',
			relevance: 0.8,
			existsInVault: false,
			relatedUrls: [],
		};

		await generator.generateContent(topic, 'Parent Note', 'Source content');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('do NOT write [[wikilinks]]');
		expect(systemPrompt).not.toContain('Include [[wikilinks]]');
		expect(systemPrompt).not.toMatch(/related\)/);
	});
});

describe('NoteGenerator — voice setting (#540)', () => {
	const topic: ExtractedTopic = {
		title: 'Sourdough',
		description: 'Starter care',
		relevance: 0.8,
		existsInVault: false,
		relatedUrls: [],
	};

	beforeEach(() => {
		mockComplete.mockClear();
		mockComplete.mockResolvedValue('## Overview\n\nGenerated content.');
	});

	it('keeps the encyclopedic rule and appends the neutral voice fragment by default', async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		await new NoteGenerator(() => settings).generateContent(topic, 'Parent', 'Source');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('Write in an encyclopedic, informative tone');
		expect(systemPrompt).toContain('neutral, third-person voice');
		expect(systemPrompt).toContain('keeps its original wording and voice');
	});

	it('picks up a voice change on the next call without rebuilding the generator', async () => {
		const settings: SynapseSettings = structuredClone(DEFAULT_SETTINGS);
		const generator = new NoteGenerator(() => settings);
		await generator.generateContent(topic, 'Parent', 'Source');
		settings.ai.voice = 'match-note';
		await generator.generateContent(topic, 'Parent', 'Source');

		expect(mockComplete.mock.calls[0][1]).toContain('neutral, third-person voice');
		expect(mockComplete.mock.calls[1][1]).toContain('Match the register and grammatical person');
		expect(mockComplete.mock.calls[1][1]).not.toContain('neutral, third-person voice');
	});
});
