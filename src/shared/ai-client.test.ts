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

/** A minimal successful OpenAI chat-completions response. */
function openAIResponse(content: string) {
	return {
		status: 200,
		json: { choices: [{ message: { role: 'assistant', content } }] },
		text: '',
		headers: {},
	};
}

/** A minimal successful Anthropic messages response. */
function anthropicResponse(text: string) {
	return {
		status: 200,
		json: { content: [{ type: 'text', text }] },
		text: '',
		headers: {},
	};
}

/** A minimal successful Ollama chat response. */
function ollamaResponse(content: string) {
	return {
		status: 200,
		json: { message: { role: 'assistant', content } },
		text: '',
		headers: {},
	};
}

describe('AIClient — OpenAI provider', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'openai';
			s.ai.model = 'gpt-4o';
			s.ai.apiKey = 'sk-test123456789012345';
			s.ai.maxTokens = 512;
			s.ai.temperature = 0.5;
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('POSTs to the chat completions endpoint with a Bearer auth header', async () => {
		mockRequestUrl.mockResolvedValue(openAIResponse('hello'));

		const result = await client.complete('Hi', 'Be brief.');

		const call = mockRequestUrl.mock.calls[0][0] as any;
		expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(call.method).toBe('POST');
		expect(call.headers['Authorization']).toBe('Bearer sk-test123456789012345');
		const body = lastRequestBody();
		expect(body.model).toBe('gpt-4o');
		expect(body.max_tokens).toBe(512);
		expect(body.temperature).toBe(0.5);
		// system prompt is preserved as a system-role message for OpenAI
		expect(body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
		expect(body.messages[1]).toEqual({ role: 'user', content: 'Hi' });
		expect(result).toBe('hello');
	});

	it('serializes vision content blocks into image_url parts', async () => {
		mockRequestUrl.mockResolvedValue(openAIResponse('a dog'));
		const blocks: ContentBlock[] = [
			{ type: 'text', text: 'describe' },
			{ type: 'image', mediaType: 'image/jpeg', data: 'Zm9v' },
		];

		await client.chat([{ role: 'user', content: blocks }]);

		const body = lastRequestBody();
		expect(body.messages[0].content).toEqual([
			{ type: 'text', text: 'describe' },
			{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Zm9v' } },
		]);
	});
});

describe('AIClient — Anthropic provider', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'anthropic';
			s.ai.model = 'sonnet';
			s.ai.apiKey = 'anthropic-key-1234567890';
			s.ai.maxTokens = 2048;
			s.ai.temperature = 0.2;
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('resolves the short model name to a full Anthropic model id and sets version headers', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));

		const result = await client.complete('Hello', 'You are terse.');

		const call = mockRequestUrl.mock.calls[0][0] as any;
		expect(call.url).toBe('https://api.anthropic.com/v1/messages');
		expect(call.headers['x-api-key']).toBe('anthropic-key-1234567890');
		expect(call.headers['anthropic-version']).toBe('2023-06-01');
		const body = lastRequestBody();
		expect(body.model).toBe('claude-sonnet-4-6');
		// system message is lifted out of messages into the top-level system field
		expect(body.system).toBe('You are terse.');
		expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
		expect(result).toBe('hi');
	});

	it('omits the system field when no system message is supplied', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('ok'));

		await client.chat([{ role: 'user', content: 'Hi' }]);

		const body = lastRequestBody();
		expect(body.system).toBeUndefined();
	});

	it('serializes vision content blocks into base64 image source parts', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('seen'));
		const blocks: ContentBlock[] = [
			{ type: 'text', text: 'look' },
			{ type: 'image', mediaType: 'image/png', data: 'YmFy' },
		];

		await client.chat([{ role: 'user', content: blocks }]);

		const body = lastRequestBody();
		expect(body.messages[0].content).toEqual([
			{ type: 'text', text: 'look' },
			{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YmFy' } },
		]);
	});
});

describe('AIClient — Ollama provider', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'ollama';
			s.ai.model = 'llama3';
			s.ai.ollamaEndpoint = 'http://localhost:11434';
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('POSTs to the {endpoint}/api/chat path with streaming disabled', async () => {
		mockRequestUrl.mockResolvedValue(ollamaResponse('local reply'));

		const result = await client.complete('Hi');

		const call = mockRequestUrl.mock.calls[0][0] as any;
		expect(call.url).toBe('http://localhost:11434/api/chat');
		const body = lastRequestBody();
		expect(body.model).toBe('llama3');
		expect(body.stream).toBe(false);
		expect(result).toBe('local reply');
	});

	it('splits vision content blocks into content text and an images array', async () => {
		mockRequestUrl.mockResolvedValue(ollamaResponse('ok'));
		const blocks: ContentBlock[] = [
			{ type: 'text', text: 'first' },
			{ type: 'text', text: 'second' },
			{ type: 'image', mediaType: 'image/png', data: 'aW1n' },
		];

		await client.chat([{ role: 'user', content: blocks }]);

		const body = lastRequestBody();
		expect(body.messages[0]).toEqual({
			role: 'user',
			content: 'first\nsecond',
			images: ['aW1n'],
		});
	});

	it('rejects an unparseable endpoint URL without making a request', async () => {
		settings.ai.ollamaEndpoint = 'not a url';
		await expect(client.complete('Hi')).rejects.toThrow(/Invalid Ollama endpoint/);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('rejects a non-localhost HTTP endpoint (requires HTTPS off-localhost)', async () => {
		settings.ai.ollamaEndpoint = 'http://example.com:11434';
		await expect(client.complete('Hi')).rejects.toThrow(/must use HTTPS/);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it('allows an HTTPS endpoint on a remote host', async () => {
		settings.ai.ollamaEndpoint = 'https://ollama.example.com';
		mockRequestUrl.mockResolvedValue(ollamaResponse('secure'));

		const result = await client.complete('Hi');
		expect(result).toBe('secure');
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});
});

describe('AIClient — shared error handling and routing', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'openai';
			s.ai.model = 'gpt-4o';
			s.ai.apiKey = 'sk-test';
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('throws on a >= 400 status, surfacing the structured error message', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 429,
			json: { error: { message: 'rate limited' } },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hi')).rejects.toThrow('API error (429): rate limited');
	});

	it('falls back to the response text when the error body has no structured message', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 500,
			get json(): unknown {
				throw new Error('no body');
			},
			text: 'upstream exploded',
			headers: {},
		});

		await expect(client.complete('Hi')).rejects.toThrow('API error (500): upstream exploded');
	});

	it('throws for an unsupported provider', async () => {
		settings.ai.provider = 'mystery' as SynapseSettings['ai']['provider'];
		await expect(client.complete('Hi')).rejects.toThrow(/Unsupported AI provider: mystery/);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});
});

describe('AIClient — idempotency: in-flight coalescing and response cache', () => {
	let settings: SynapseSettings;
	let client: AIClient;

	const QUESTION: ChatMessage[] = [{ role: 'user', content: 'What is the capital of France?' }];

	beforeEach(() => {
		settings = makeSettings((s) => {
			s.ai.provider = 'openai';
			s.ai.model = 'gpt-4o';
			s.ai.apiKey = 'sk-test123456789012345';
			s.ai.maxTokens = 512;
			// Per-case temperature/cacheResponses are set inside each test so the
			// caching gate is exercised explicitly.
			s.ai.temperature = 0;
			s.ai.cacheResponses = false;
		});
		client = new AIClient(() => settings);
		// Shared vi.fn() — reset so a previous case's queued return can't satisfy
		// (and mask) a missing call here.
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('coalesces two concurrent identical requests into a single dispatch', async () => {
		// Caching OFF (temp > 0, flag off) so this isolates in-flight coalescing.
		settings.ai.temperature = 0.7;
		settings.ai.cacheResponses = false;
		mockRequestUrl.mockResolvedValue(openAIResponse('shared answer'));

		// Do NOT await the first before issuing the second — they must overlap.
		const p1 = client.chat(QUESTION);
		const p2 = client.chat(QUESTION);
		const [r1, r2] = await Promise.all([p1, p2]);

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(r1).toBe('shared answer');
		expect(r2).toBe('shared answer');
	});

	it('serves a second identical request from cache at temperature 0', async () => {
		settings.ai.temperature = 0;
		mockRequestUrl.mockResolvedValue(openAIResponse('Paris'));

		const first = await client.chat(QUESTION);
		const second = await client.chat(QUESTION);

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(first).toBe('Paris');
		expect(second).toBe('Paris');
	});

	it('does not cache when temperature > 0 and cacheResponses is false', async () => {
		settings.ai.temperature = 0.7;
		settings.ai.cacheResponses = false;
		mockRequestUrl.mockResolvedValue(openAIResponse('fresh'));

		await client.chat(QUESTION);
		await client.chat(QUESTION);

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('caches at temperature > 0 once cacheResponses is opted in', async () => {
		settings.ai.temperature = 0.7;
		settings.ai.cacheResponses = true;
		mockRequestUrl.mockResolvedValue(openAIResponse('memoized'));

		const first = await client.chat(QUESTION);
		const second = await client.chat(QUESTION);

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(first).toBe('memoized');
		expect(second).toBe('memoized');
	});

	it('never caches a rejected dispatch — a later identical call retries and can succeed', async () => {
		// Caching ON (temp 0) to prove the rejection specifically is not cached.
		settings.ai.temperature = 0;
		mockRequestUrl
			.mockResolvedValueOnce({
				status: 500,
				json: { error: { message: 'upstream boom' } },
				text: '',
				headers: {},
			})
			.mockResolvedValueOnce(openAIResponse('recovered'));

		await expect(client.chat(QUESTION)).rejects.toThrow(/API error \(500\)/);
		const second = await client.chat(QUESTION);

		expect(second).toBe('recovered');
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('bypasses the cache on a refresh and updates it with the fresh result', async () => {
		settings.ai.temperature = 0; // caching ON
		mockRequestUrl
			.mockResolvedValueOnce(openAIResponse('v1'))
			.mockResolvedValue(openAIResponse('v2'));

		// Prime the cache with v1.
		expect(await client.chat(QUESTION)).toBe('v1');
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		// Bypass must dispatch again even though v1 is cached, and refresh the cache.
		const refreshed = await client.chat(QUESTION, { bypassCache: true });
		expect(refreshed).toBe('v2');
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);

		// A subsequent normal call now serves the refreshed v2 from cache.
		const third = await client.chat(QUESTION);
		expect(third).toBe('v2');
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});
});
