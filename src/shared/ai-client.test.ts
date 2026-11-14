import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl, type RequestUrlParam } from '../__mocks__/obsidian';
import { AIClient, redactSecrets } from './ai-client';
import { SynapseSettings, DEFAULT_SETTINGS } from '../settings';
import type { ChatMessage, ContentBlock } from './types';
import { voiceInstruction } from './voice';

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

/** Shape of the JSON request bodies these provider tests introspect. */
interface ParsedRequestBody {
	model?: string;
	max_tokens?: number;
	max_completion_tokens?: number;
	temperature?: number;
	reasoning_effort?: string;
	output_config?: unknown;
	think?: string | boolean;
	stream?: boolean;
	system?: string;
	system_instruction?: unknown;
	generationConfig?: unknown;
	contents: Array<{ role: string; parts: unknown }>;
	messages: Array<{ role?: string; content: unknown }>;
}

function lastRequestBody(): ParsedRequestBody {
	const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
	return JSON.parse(call.body as string) as ParsedRequestBody;
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
		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
		expect(call.url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
		);
		expect(call.method).toBe('POST');
		expect(call.headers?.['x-goog-api-key']).toBe('AIzaSyTestKey1234567890123456789012345');
		expect(call.headers?.['Content-Type']).toBe('application/json');
		expect(result).toBe('hi there');
	});

	it('sends no generationConfig without an effort', async () => {
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));
		settings.ai.model = 'gemini-3.6-flash';

		await client.complete('Hello');

		expect(lastRequestBody().generationConfig).toBeUndefined();
	});

	it.each([['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['max', 'HIGH']] as const)(
		'maps effort %s to thinkingLevel %s',
		async (effort, level) => {
			mockRequestUrl.mockResolvedValue(geminiResponse('ok'));
			settings.ai.model = 'gemini-4-argon';
			settings.ai.effort = effort;

			await client.complete('Hello');

			expect(lastRequestBody().generationConfig).toEqual({ thinkingConfig: { thinkingLevel: level } });
		}
	);

	it.each(['MAX_TOKENS', 'CONTINUATION'])('throws instead of returning partial text on %s', async (finishReason) => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { candidates: [{ content: { role: 'model', parts: [{ text: 'half a rep' }] }, finishReason }] },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hello')).rejects.toThrow(/output limit/);
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

		const err = (await client.complete('Hello').catch((e: unknown) => e)) as Error;
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toMatch(/output limit/);
		expect(err.message).not.toMatch(/max tokens/i);
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

		const err = (await client.complete('Hello').catch((e: unknown) => e)) as Error;
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
			s.ai.model = 'gpt-6-astra';
			s.ai.apiKey = 'sk-test123456789012345';
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('POSTs to the chat completions endpoint with a Bearer auth header', async () => {
		mockRequestUrl.mockResolvedValue(openAIResponse('hello'));

		const result = await client.complete('Hi', 'Be brief.');

		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
		expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(call.method).toBe('POST');
		expect(call.headers?.['Authorization']).toBe('Bearer sk-test123456789012345');
		const body = lastRequestBody();
		expect(body.model).toBe('gpt-6-astra');
		expect(body).not.toHaveProperty('max_completion_tokens');
		expect(body).not.toHaveProperty('max_tokens');
		expect(body).not.toHaveProperty('temperature');
		expect(body).not.toHaveProperty('reasoning_effort');
		// reasoning models take instructions as the developer role
		expect(body.messages[0]).toEqual({ role: 'developer', content: 'Be brief.' });
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

	it.each(['low', 'medium', 'high', 'max'] as const)('sends reasoning_effort %s unchanged', async (effort) => {
		mockRequestUrl.mockResolvedValue(openAIResponse('ok'));
		settings.ai.model = 'gpt-6-luna';
		settings.ai.effort = effort;

		await client.chat([{ role: 'user', content: 'Hi' }]);

		expect(lastRequestBody().reasoning_effort).toBe(effort);
	});

	it('throws on finish_reason length and caches nothing', async () => {
		settings.ai.cacheResponses = true;
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hi')).rejects.toThrow(/output limit/);
		mockRequestUrl.mockResolvedValue(openAIResponse('whole'));
		await expect(client.complete('Hi')).resolves.toBe('whole');
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
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
		});
		client = new AIClient(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('resolves the short model name to a full Anthropic model id and sets version headers', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));

		const result = await client.complete('Hello', 'You are terse.');

		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
		expect(call.url).toBe('https://api.anthropic.com/v1/messages');
		expect(call.headers?.['x-api-key']).toBe('anthropic-key-1234567890');
		expect(call.headers?.['anthropic-version']).toBe('2026-10-21');
		const body = lastRequestBody();
		expect(body.model).toBe('claude-sonnet-5-5');
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

	it.each([
		['fable', 'claude-fable-5-2'],
		['opus', 'claude-opus-5-5'],
		['sonnet', 'claude-sonnet-5-5'],
		['haiku', 'claude-haiku-5-5'],
	])('resolves the %s alias to the bare %s model id', async (alias, modelId) => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));
		settings.ai.model = alias;

		await client.chat([{ role: 'user', content: 'Hi' }]);

		expect(lastRequestBody().model).toBe(modelId);
	});

	it('sends the default output cap and no sampling params or effort by default', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));

		await client.chat([{ role: 'user', content: 'Hi' }]);

		const body = lastRequestBody();
		expect(body.max_tokens).toBe(16384);
		expect(body).not.toHaveProperty('temperature');
		expect(body).not.toHaveProperty('top_p');
		expect(body).not.toHaveProperty('top_k');
		expect(body).not.toHaveProperty('output_config');
	});

	it.each([['low', 16384], ['medium', 16384], ['high', 21333], ['max', 21333]] as const)(
		'sends effort %s in output_config with max_tokens %i',
		async (effort, cap) => {
			mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));
			settings.ai.effort = effort;

			await client.chat([{ role: 'user', content: 'Hi' }]);

			expect(lastRequestBody().output_config).toEqual({ effort });
			expect(lastRequestBody().max_tokens).toBe(cap);
		}
	);

	it.each([
		['high', 600_000],
		['max', 600_000],
		['medium', 120_000],
	] as const)('times out a %s-effort request after %i ms', async (effort, ms) => {
		vi.useFakeTimers();
		try {
			mockRequestUrl.mockReturnValue(new Promise(() => undefined));
			settings.ai.effort = effort;

			let settled = false;
			const pending = client.chat([{ role: 'user', content: 'Hi' }]).catch((e: unknown) => { settled = true; return e; });
			await vi.advanceTimersByTimeAsync(ms - 1_000);
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(2_000);

			expect(((await pending) as Error).message).toContain('timed out');
		} finally {
			vi.useRealTimers();
		}
	});

	it('throws on stop_reason max_tokens instead of returning partial text', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' },
			text: '',
			headers: {},
		});

		await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/output limit/);
	});

	it('never sends a thinking parameter', async () => {
		mockRequestUrl.mockResolvedValue(anthropicResponse('hi'));
		settings.ai.model = 'fable';

		await client.chat([{ role: 'user', content: 'Hi' }]);

		expect(lastRequestBody()).not.toHaveProperty('thinking');
	});

	it('reads the first text block when thinking blocks precede it', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				stop_reason: 'end_turn',
				stop_details: null,
				content: [
					{ type: 'thinking', thinking: '' },
					{ type: 'text', text: 'the answer' },
				],
			},
			text: '',
			headers: {},
		});

		await expect(client.chat([{ role: 'user', content: 'Hi' }])).resolves.toBe('the answer');
	});

	it('surfaces a refusal stop reason instead of crashing on empty content', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				stop_reason: 'refusal',
				stop_details: { type: 'refusal', category: 'harmful_content', explanation: 'declined' },
				content: [],
			},
			text: '',
			headers: {},
		});

		await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
			/safety refusal.*declined/
		);
	});

	it('appends a data-retention hint to a Fable 400', async () => {
		settings.ai.model = 'fable';
		mockRequestUrl.mockResolvedValue({
			status: 400,
			json: { error: { message: 'invalid_request_error' } },
			text: '',
			headers: {},
		});

		await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
			/30-day data retention/
		);
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

		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
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

	it('sends no think field by default', async () => {
		mockRequestUrl.mockResolvedValue(ollamaResponse('ok'));
		settings.ai.model = 'gpt-oss';

		await client.complete('Hi');

		expect(lastRequestBody()).not.toHaveProperty('think');
	});

	it.each([
		['gpt-oss', 'low', 'low'],
		['gpt-oss', 'max', 'high'],
		['qwen3.6', 'low', false],
		['qwen3.6', 'high', undefined],
		['llama3', 'low', undefined],
	] as const)('maps %s effort %s to think %s', async (model, effort, think) => {
		mockRequestUrl.mockResolvedValue(ollamaResponse('ok'));
		settings.ai.model = model;
		settings.ai.effort = effort;

		await client.complete('Hi');

		expect(lastRequestBody().think).toBe(think);
	});

	it('throws on done_reason length', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { message: { content: 'partial' }, done_reason: 'length' },
			text: '',
			headers: {},
		});

		await expect(client.complete('Hi')).rejects.toThrow(/output limit/);
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
			s.ai.model = 'gpt-6-astra';
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
			s.ai.model = 'gpt-6-astra';
			s.ai.apiKey = 'sk-test123456789012345';
			s.ai.cacheResponses = false;
		});
		client = new AIClient(() => settings);
		// Shared vi.fn() — reset so a previous case's queued return can't satisfy
		// (and mask) a missing call here.
		mockRequestUrl.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('coalesces two concurrent identical requests into a single dispatch', async () => {
		// Caching OFF so this isolates in-flight coalescing.
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

	it('serves a second identical request from cache when caching is on', async () => {
		settings.ai.cacheResponses = true;
		mockRequestUrl.mockResolvedValue(openAIResponse('Paris'));

		const first = await client.chat(QUESTION);
		const second = await client.chat(QUESTION);

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(first).toBe('Paris');
		expect(second).toBe('Paris');
	});

	it('does not cache when cacheResponses is false', async () => {
		settings.ai.cacheResponses = false;
		mockRequestUrl.mockResolvedValue(openAIResponse('fresh'));

		await client.chat(QUESTION);
		await client.chat(QUESTION);

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('never caches a rejected dispatch — a later identical call retries and can succeed', async () => {
		// Caching ON to prove the rejection specifically is not cached.
		settings.ai.cacheResponses = true;
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
		settings.ai.cacheResponses = true;
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

	it('calls onCacheHit only for a cache replay, through chat and complete (#527)', async () => {
		settings.ai.cacheResponses = true;
		mockRequestUrl.mockResolvedValue(openAIResponse('Paris'));
		const onCacheHit = vi.fn();

		await client.chat(QUESTION, { onCacheHit });
		expect(onCacheHit).not.toHaveBeenCalled();

		await client.chat(QUESTION, { onCacheHit });
		expect(onCacheHit).toHaveBeenCalledTimes(1);

		await client.complete('Hi', 'System', { onCacheHit });
		expect(onCacheHit).toHaveBeenCalledTimes(1);
		await client.complete('Hi', 'System', { onCacheHit });
		expect(onCacheHit).toHaveBeenCalledTimes(2);
	});

	it('does not call onCacheHit for a bypass, an uncacheable request, or a coalesced join (#527)', async () => {
		const onCacheHit = vi.fn();
		settings.ai.cacheResponses = true;
		mockRequestUrl.mockResolvedValue(openAIResponse('Paris'));
		await client.chat(QUESTION);
		await client.chat(QUESTION, { bypassCache: true, onCacheHit });

		settings.ai.cacheResponses = false;
		await client.chat(QUESTION, { onCacheHit });
		await Promise.all([client.chat(QUESTION, { onCacheHit }), client.chat(QUESTION, { onCacheHit })]);

		expect(onCacheHit).not.toHaveBeenCalled();
	});

	it('keys the cache on the system prompt, so switching voice never replays a stale result (#540)', async () => {
		settings.ai.cacheResponses = true;
		mockRequestUrl
			.mockResolvedValueOnce(openAIResponse('neutral answer'))
			.mockResolvedValueOnce(openAIResponse('first-person answer'));

		const neutral = await client.complete('Summarize', `Base. ${voiceInstruction({ voice: 'neutral', voiceCustom: '' })}`);
		const firstPerson = await client.complete('Summarize', `Base. ${voiceInstruction({ voice: 'first-person', voiceCustom: '' })}`);
		const neutralAgain = await client.complete('Summarize', `Base. ${voiceInstruction({ voice: 'neutral', voiceCustom: '' })}`);

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		expect(neutral).toBe('neutral answer');
		expect(firstPerson).toBe('first-person answer');
		expect(neutralAgain).toBe('neutral answer');
	});
});

describe('AIClient — per-feature overrides', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	it('routes an overridden feature to its own provider, model and key', async () => {
		const settings = makeSettings((s) => {
			s.ai.provider = 'anthropic';
			s.ai.apiKey = 'sk-ant-default';
			s.ai.providerKeys = { gemini: 'AIzaFeatureKey' };
			s.ai.overrides = { 'deep-dive': { provider: 'gemini', model: 'gemini-3.8-flash' } };
		});
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));

		await new AIClient(() => settings, 'deep-dive').complete('hi');

		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
		expect(call.url).toContain('/models/gemini-3.8-flash:generateContent');
		expect(call.headers?.['x-goog-api-key']).toBe('AIzaFeatureKey');
	});

	it('uses the default provider for a feature without an override', async () => {
		const settings = makeSettings((s) => {
			s.ai.provider = 'anthropic';
			s.ai.model = 'haiku';
			s.ai.apiKey = 'sk-ant-default';
			s.ai.overrides = { 'deep-dive': { provider: 'gemini', model: 'gemini-3.8-flash' } };
		});
		mockRequestUrl.mockResolvedValue({ status: 200, json: { content: [{ type: 'text', text: 'ok' }] }, text: '', headers: {} });

		await new AIClient(() => settings, 'tidy').complete('hi');

		const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
		expect(call.url).toBe('https://api.anthropic.com/v1/messages');
		expect(call.headers?.['x-api-key']).toBe('sk-ant-default');
		expect(lastRequestBody().model).toBe('claude-haiku-5-5');
	});

	it('does not replay a cached default-provider response for an overridden feature', async () => {
		const settings = makeSettings((s) => {
			s.ai.provider = 'gemini';
			s.ai.model = 'gemini-3.6-flash';
			s.ai.cacheResponses = true;
		});
		mockRequestUrl.mockResolvedValue(geminiResponse('ok'));
		const client = new AIClient(() => settings, 'summarize');

		await client.complete('same');
		settings.ai.overrides = { summarize: { provider: 'gemini', model: 'gemini-4-argon' } };
		await client.complete('same');

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});
});
