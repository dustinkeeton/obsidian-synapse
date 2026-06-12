import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl } from '../__mocks__/obsidian';
import { AIClient, redactSecrets } from './ai-client';
import { SynapseSettings, DEFAULT_SETTINGS } from '../settings';
import type { ChatMessage, ContentBlock } from './types';

const mockRequestUrl = vi.mocked(requestUrl);

function makeSettings(mutate?: (s: SynapseSettings) => void): SynapseSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate?.(settings);
	return settings;
}

/** A minimal successful Gemini generateContent response. */
function geminiResponse(text: string) {
	return {
		status: 200,
		json: { candidates: [{ content: { role: 'model', parts: [{ text }] } }] },
		text: '',
		headers: {},
	};
}

function lastRequestBody(): Record<string, any> {
	const call = mockRequestUrl.mock.calls[0][0] as any;
	return JSON.parse(call.body);
}

describe('redactSecrets', () => {
	it('redacts OpenAI-style sk- keys', () => {
		expect(redactSecrets('invalid key sk-abcdef1234567890')).toBe('invalid key [REDACTED]');
	});

	it('redacts Google AIza… API keys', () => {
		const input = 'API key not valid: AIzaSyA1234567890abcdefghijklmnopqrstu — check it';
		expect(redactSecrets(input)).toBe('API key not valid: [REDACTED] — check it');
	});

	it('redacts Bearer tokens', () => {
		expect(redactSecrets('Bearer abcdefgh12345678 rejected')).toBe('[REDACTED] rejected');
	});

	it('leaves ordinary text untouched', () => {
		const text = 'The model gemini-3.5-flash is overloaded, retry later';
		expect(redactSecrets(text)).toBe(text);
	});
});

describe('AIClient — Gemini provider', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'gemini';
			s.ai.model = 'gemini-3.5-flash';
			s.ai.apiKey = 'AIzaSyTestKey1234567890123456789012345';
			s.ai.maxTokens = 1024;
			s.ai.temperature = 0.3;
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('POSTs to the generateContent endpoint with the x-goog-api-key header', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('hi there'));

		const result = await client.complete('Hello');

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const call = mockRequestUrl.mock.calls[0][0] as any;
		expect(call.url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
		);
		expect(call.method).toBe('POST');
		expect(call.headers['x-goog-api-key']).toBe('AIzaSyTestKey1234567890123456789012345');
		expect(call.headers['Content-Type']).toBe('application/json');
		expect(result).toBe('hi there');
	});

	it('maps maxTokens and temperature into generationConfig', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));

		await client.complete('Hello');

		const body = lastRequestBody();
		expect(body.generationConfig).toEqual({ maxOutputTokens: 1024, temperature: 0.3 });
	});

	it('routes the system message into system_instruction (Gemini has no system role)', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));

		await client.complete('Hello', 'You are concise.');

		const body = lastRequestBody();
		expect(body.system_instruction).toEqual({ parts: [{ text: 'You are concise.' }] });
		// The system message must not leak into contents
		expect(body.contents).toHaveLength(1);
		expect(body.contents[0].role).toBe('user');
		expect(body.contents[0].parts).toEqual([{ text: 'Hello' }]);
	});

	it('omits system_instruction when no system message is present', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));

		await client.chat([{ role: 'user', content: 'Hi' }]);

		const body = lastRequestBody();
		expect(body.system_instruction).toBeUndefined();
	});

	it('maps the assistant role to model', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'What is 2+2?' },
			{ role: 'assistant', content: '4' },
			{ role: 'user', content: 'And 3+3?' },
		];

		await client.chat(messages);

		const body = lastRequestBody();
		expect(body.contents.map((c: { role: string }) => c.role)).toEqual([
			'user',
			'model',
			'user',
		]);
		expect(body.contents[1].parts).toEqual([{ text: '4' }]);
	});

	it('converts vision content blocks to text and inline_data parts', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('a cat'));
		const blocks: ContentBlock[] = [
			{ type: 'text', text: 'What is in this image?' },
			{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
		];

		await client.chat([{ role: 'user', content: blocks }]);

		const body = lastRequestBody();
		expect(body.contents[0].parts).toEqual([
			{ text: 'What is in this image?' },
			{ inline_data: { mime_type: 'image/png', data: 'aGVsbG8=' } },
		]);
	});

	it('concatenates multiple text parts in the response', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				candidates: [
					{ content: { role: 'model', parts: [{ text: 'Hello ' }, { text: 'world' }] } },
				],
			},
			text: '',
			headers: {},
		});

		const result = await client.complete('Hi');
		expect(result).toBe('Hello world');
	});

	it('throws a descriptive error when the prompt is blocked (no candidates)', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { promptFeedback: { blockReason: 'SAFETY' } },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hello')).rejects.toThrow(/blocked \(SAFETY\)/);
	});

	it('throws a descriptive error when the token budget is exhausted before any text (MAX_TOKENS, no parts)', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { candidates: [{ content: { role: 'model' }, finishReason: 'MAX_TOKENS' }] },
			text: '',
			headers: {},
		});

		const err: Error = await client.complete('Hello').catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain('MAX_TOKENS');
		expect(err.message).toMatch(/max tokens/i);
	});

	it('reports the finish reason when a candidate is stopped without parts for other reasons', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { candidates: [{ finishReason: 'SAFETY' }] },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hello')).rejects.toThrow(/SAFETY/);
	});

	it('redacts Google API keys echoed in error responses', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 400,
			json: {
				error: { message: 'API key not valid: AIzaSyBadKey1234567890123456789012345' },
			},
			text: '',
			headers: {},
		});

		const err: Error = await client.complete('Hello').catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain('API error (400)');
		expect(err.message).toContain('[REDACTED]');
		expect(err.message).not.toContain('AIzaSyBadKey');
	});
});
