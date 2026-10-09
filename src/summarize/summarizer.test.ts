import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Summarizer } from './summarizer';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { voiceInstruction } from '../shared/voice';

const mockComplete = vi
	.fn<(prompt: string, systemPrompt?: string, opts?: unknown) => Promise<string>>()
	.mockResolvedValue('- Key point 1\n- Key point 2');

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
		summarizer = new Summarizer(() => DEFAULT_SETTINGS);
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

	it('uses custom prompt when provided, followed by the voice fragment (#540)', async () => {
		await summarizer.summarize('Content', 'source', 'bullets', 'My custom prompt');

		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toBe(`My custom prompt\n\n${voiceInstruction(DEFAULT_SETTINGS.ai)}`);
		expect(systemPrompt).not.toContain('bullet');
	});

	it('includes image embed preservation instruction in user prompt', async () => {
		await summarizer.summarize('Content with ![img](https://example.com/photo.jpg)', 'source', 'bullets');

		const [userPrompt] = mockComplete.mock.calls[0];
		expect(userPrompt).toContain(
			'preserve them as markdown image embeds (![alt](url))'
		);
		expect(userPrompt).toContain('embed them as ![[image.jpg]]');
	});

	it('includes image embed instruction regardless of summary style', async () => {
		for (const style of ['bullets', 'paragraph', 'key-points'] as const) {
			mockComplete.mockClear();
			await summarizer.summarize('Content', 'source', style);
			const [userPrompt] = mockComplete.mock.calls[0];
			expect(userPrompt).toContain(
				'preserve them as markdown image embeds (![alt](url))'
			);
			expect(userPrompt).toContain('embed them as ![[image.jpg]]');
		}
	});

	it('forwards AI request options so a cache replay reaches the caller (#527)', async () => {
		const onCacheHit = vi.fn();
		await summarizer.summarize('Content', 'source', 'bullets', undefined, { onCacheHit });
		expect(mockComplete.mock.calls[0][2]).toEqual({ onCacheHit });
	});

	it('sanitizes AI response', async () => {
		mockComplete.mockResolvedValue('<script>alert("xss")</script>Clean text');
		const result = await summarizer.summarize('Content', 'source', 'bullets');
		expect(result).not.toContain('<script>');
		expect(result).toContain('Clean text');
	});
});

const FIRST_PERSON_TRANSCRIPT = "[00:00] I think we should ship the beta next week. My team is ready.";
const BLOCK_QUOTE_NOTE = '# Reading notes\n\n> I have measured out my life with coffee spoons.\n\nThe poem uses domestic imagery.';
const LYRICS_NOTE = '## Lyrics\n\nI walk the line, my heart is mine\nWe sing until the morning light';

describe('Summarizer — voice setting (#540)', () => {
	let settings: SynapseSettings;
	let summarizer: Summarizer;

	beforeEach(() => {
		mockComplete.mockReset();
		mockComplete.mockResolvedValue('summary');
		settings = structuredClone(DEFAULT_SETTINGS);
		summarizer = new Summarizer(() => settings);
	});

	it('appends the neutral voice fragment to every built-in style prompt', async () => {
		for (const style of ['bullets', 'paragraph', 'key-points'] as const) {
			mockComplete.mockClear();
			await summarizer.summarize('Content', 'source', style);
			const [, systemPrompt] = mockComplete.mock.calls[0];
			expect(systemPrompt).toContain('neutral, third-person voice');
			expect(systemPrompt?.endsWith(voiceInstruction(settings.ai))).toBe(true);
		}
	});

	it('picks up a voice change on the next call without rebuilding the summarizer', async () => {
		await summarizer.summarize('Content', 'source', 'bullets');
		settings.ai.voice = 'first-person';
		await summarizer.summarize('Content', 'source', 'bullets');

		expect(mockComplete.mock.calls[0][1]).toContain('neutral, third-person voice');
		expect(mockComplete.mock.calls[1][1]).toContain('Write in the first person');
		expect(mockComplete.mock.calls[1][1]).not.toContain('neutral, third-person voice');
	});

	it.each([
		['first-person transcript', FIRST_PERSON_TRANSCRIPT],
		['block quote', BLOCK_QUOTE_NOTE],
		['lyrics', LYRICS_NOTE],
	])('passes a %s through verbatim with the verbatim exemption under neutral', async (_label, fixture) => {
		mockComplete.mockResolvedValue(`The source is summarized below.\n\n${fixture}`);
		const result = await summarizer.summarize(fixture, 'source', 'paragraph');

		expect(result).toContain(fixture);
		const [userPrompt, systemPrompt] = mockComplete.mock.calls[0];
		expect(userPrompt).toContain(fixture);
		expect(systemPrompt).toContain('neutral, third-person voice');
		expect(systemPrompt).toContain('keeps its original wording and voice');
		expect(systemPrompt).toContain('apply this voice only to text you write yourself');
	});
});
