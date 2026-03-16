import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Summarizer } from './summarizer';
import type { AutoNotesSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

const mockComplete = vi.fn().mockResolvedValue('- Key point 1\n- Key point 2');

// Mock the AIClient as a class (required by vitest)
vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
}));

describe('Summarizer', () => {
	let summarizer: Summarizer;

	beforeEach(() => {
		mockComplete.mockReset();
		mockComplete.mockResolvedValue('- Key point 1\n- Key point 2');
		summarizer = new Summarizer(() => DEFAULT_SETTINGS as AutoNotesSettings);
	});

	it('calls AI with content and source', async () => {
		const result = await summarizer.summarize(
			'Some content to summarize',
			'https://example.com',
			'bullets'
		);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [userPrompt, systemPrompt] = mockComplete.mock.calls[0];
		expect(userPrompt).toContain('https://example.com');
		expect(userPrompt).toContain('Some content to summarize');
		expect(systemPrompt).toContain('bullet');
		expect(result).toBe('- Key point 1\n- Key point 2');
	});

	it('uses paragraph style prompt', async () => {
		await summarizer.summarize('Content', 'source', 'paragraph');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('paragraph');
	});

	it('uses key-points style prompt', async () => {
		await summarizer.summarize('Content', 'source', 'key-points');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('key takeaway');
	});

	it('uses custom prompt when provided', async () => {
		await summarizer.summarize('Content', 'source', 'bullets', 'My custom prompt');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toBe('My custom prompt');
	});

	it('sanitizes AI response', async () => {
		mockComplete.mockResolvedValue('<script>alert("xss")</script>Clean text');
		const result = await summarizer.summarize('Content', 'source', 'bullets');
		expect(result).not.toContain('<script>');
		expect(result).toContain('Clean text');
	});
});
