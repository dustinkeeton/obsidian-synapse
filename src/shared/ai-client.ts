import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ChatMessage, ContentBlock, TextContentBlock } from './types';
import { redactSecrets } from './redact';
import { isRecord } from './json-utils';
import { contentKey } from './hash-utils';

// Re-exported for back-compat: existing callers and tests import `redactSecrets`
// from this module. The implementation now lives in ./redact (single source of
// truth) so the AI client and `notifyError` can't drift apart.
export { redactSecrets };

/** Default timeout for AI API requests (2 minutes). */
const AI_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Upper bound on the per-instance response cache (#397). Keeps memory bounded
 * for a long-lived client while comfortably covering a single re-scan pass.
 */
const AI_RESPONSE_CACHE_MAX = 50;

/** Optional per-call controls threaded through {@link AIClient.complete}/{@link AIClient.chat}. */
export interface AIRequestOptions {
	/**
	 * Force a fresh dispatch for "regenerate" actions: skip the cache read AND
	 * the in-flight coalescing map, but still refresh the cache with the new
	 * result when caching is active.
	 */
	bypassCache?: boolean;
}

async function safeRequest(options: RequestUrlParam): Promise<RequestUrlResponse> {
	// Race the request against a timeout to prevent indefinite hangs
	const timeout = new Promise<never>((_, reject) =>
		window.setTimeout(() => reject(new Error('AI request timed out')), AI_REQUEST_TIMEOUT_MS)
	);

	// Don't use throw mode — Obsidian strips the response body on error
	const response = await Promise.race([
		requestUrl({ ...options, throw: false }),
		timeout,
	]);
	if (response.status >= 400) {
		let detail: string;
		try {
			// response.json is `any` (Obsidian) and the error envelope shape
			// varies by provider; narrow before reaching for `.error.message`
			// so a non-standard body falls back to a stringified dump instead
			// of throwing while we build the error message.
			const body: unknown = response.json;
			detail = extractErrorMessage(body) ?? JSON.stringify(body);
		} catch {
			detail = response.text || `status ${response.status}`;
		}
		// Redact any API keys that the upstream API may echo back in error responses
		throw new Error(`API error (${response.status}): ${redactSecrets(detail)}`);
	}
	return response;
}

/**
 * Pull a human-readable message out of an error envelope of unknown shape.
 *
 * OpenAI/Anthropic/Gemini all wrap errors as `{ error: { message: string } }`.
 * Returns the message when present, otherwise `null` so the caller can fall
 * back to a stringified body. Tolerant by design — error responses are exactly
 * where shapes are least predictable.
 */
function extractErrorMessage(body: unknown): string | null {
	if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
		return body.error.message;
	}
	return null;
}

/**
 * Map simplified model names to actual API model IDs.
 * Anthropic models use short names (sonnet, opus, haiku) in settings
 * but need full IDs for the API.
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
	opus: 'claude-opus-4-6',
	sonnet: 'claude-sonnet-4-6',
	haiku: 'claude-haiku-4-5-20251001',
};

function resolveModelId(provider: string, model: string): string {
	if (provider === 'anthropic' && model in ANTHROPIC_MODEL_MAP) {
		return ANTHROPIC_MODEL_MAP[model];
	}
	return model;
}

/**
 * Convert ContentBlock[] to OpenAI's multimodal message format.
 */
function toOpenAIContent(blocks: ContentBlock[]): unknown[] {
	return blocks.map(block => {
		if (block.type === 'text') {
			return { type: 'text', text: block.text };
		}
		return {
			type: 'image_url',
			image_url: { url: `data:${block.mediaType};base64,${block.data}` },
		};
	});
}

/**
 * Convert ContentBlock[] to Anthropic's multimodal message format.
 */
function toAnthropicContent(blocks: ContentBlock[]): unknown[] {
	return blocks.map(block => {
		if (block.type === 'text') {
			return { type: 'text', text: block.text };
		}
		return {
			type: 'image',
			source: {
				type: 'base64',
				media_type: block.mediaType,
				data: block.data,
			},
		};
	});
}

/** The subset of a Gemini generateContent response needed to extract text. */
interface GeminiResponseJson {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	promptFeedback?: { blockReason?: string };
}

/**
 * Extract the concatenated text parts from a Gemini generateContent response.
 *
 * Gemini returns HTTP 200 for blocked prompts (no `candidates`, only
 * `promptFeedback.blockReason`) and for candidates stopped before any text
 * (`finishReason: MAX_TOKENS` / `SAFETY` with no `parts`) — both previously
 * crashed unguarded `candidates[0].content.parts` access. Throws a descriptive
 * error for those shapes instead. Shared by the AI client and the audio
 * transcriber (which must not return a silently empty transcript).
 */
export function extractGeminiResponseText(json: unknown): string {
	// `requestUrl().json` is `any`; narrow to the known optional shape before
	// access. A non-object body simply has no candidates and falls through to
	// the descriptive "returned no text" error below. The narrowing is sound:
	// every field is optional and read via optional chaining, so a mismatch
	// surfaces as a thrown error rather than an unchecked access.
	const response: GeminiResponseJson = isRecord(json) ? json : {};
	const candidate = response.candidates?.[0];
	const parts = candidate?.content?.parts;
	if (!parts || parts.length === 0) {
		const blockReason = response.promptFeedback?.blockReason;
		if (blockReason) {
			throw new Error(`Gemini response blocked (${blockReason})`);
		}
		const finishReason = candidate?.finishReason;
		if (finishReason === 'MAX_TOKENS') {
			throw new Error(
				'Gemini returned no text: token limit reached (MAX_TOKENS) — consider raising max tokens in AI settings'
			);
		}
		throw new Error(
			`Gemini returned no text${finishReason ? ` (finish reason: ${finishReason})` : ''}`
		);
	}
	return parts.map(p => p.text ?? '').join('');
}

/** The subset of an OpenAI chat-completions response needed to extract text. */
interface OpenAIChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

/** The subset of an Anthropic messages response needed to extract text. */
interface AnthropicMessageResponse {
	content?: Array<{ type?: string; text?: string }>;
}

/** The subset of an Ollama chat response needed to extract text. */
interface OllamaChatResponse {
	message?: { content?: string };
}

/**
 * Render an unknown response shape into a short, redacted string for error
 * messages. Truncated so a large/binary body can't bloat the thrown error.
 */
function briefShape(json: unknown): string {
	let s: string;
	try {
		s = typeof json === 'string' ? json : JSON.stringify(json);
	} catch {
		s = String(json);
	}
	s = redactSecrets(s ?? 'undefined');
	return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/**
 * Extract the assistant text from an OpenAI chat-completions response.
 * `requestUrl().json` is `any`, so an error-shaped or malformed body would
 * otherwise throw an opaque `TypeError` on `choices[0].message.content`.
 * Throw a descriptive error instead.
 */
export function extractOpenAIResponseText(json: unknown): string {
	const content = (json as OpenAIChatResponse | null)?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error(`Unexpected OpenAI response: ${briefShape(json)}`);
	}
	return content;
}

/**
 * Extract the text from an Anthropic messages response. Concatenates the text
 * of every `text` block (Anthropic may return multiple content blocks). Throws
 * a descriptive error when no text block is present instead of letting an
 * opaque `TypeError` escape from `content[0].text`.
 */
export function extractAnthropicResponseText(json: unknown): string {
	const blocks = (json as AnthropicMessageResponse | null)?.content;
	if (Array.isArray(blocks)) {
		const text = blocks
			.filter(b => b?.type === 'text' && typeof b.text === 'string')
			.map(b => b.text)
			.join('');
		if (text.length > 0) {
			return text;
		}
	}
	throw new Error(`Unexpected Anthropic response: ${briefShape(json)}`);
}

/**
 * Extract the assistant text from an Ollama chat response. Throws a descriptive
 * error instead of an opaque `TypeError` on `message.content` for a bad shape.
 */
export function extractOllamaResponseText(json: unknown): string {
	const content = (json as OllamaChatResponse | null)?.message?.content;
	if (typeof content !== 'string') {
		throw new Error(`Unexpected Ollama response: ${briefShape(json)}`);
	}
	return content;
}

/**
 * Convert ContentBlock[] to Gemini's multimodal `parts` format
 * (REST field names are snake_case: `inline_data`, `mime_type`).
 */
function toGeminiContent(blocks: ContentBlock[]): unknown[] {
	return blocks.map(block => {
		if (block.type === 'text') {
			return { text: block.text };
		}
		return {
			inline_data: {
				mime_type: block.mediaType,
				data: block.data,
			},
		};
	});
}

/**
 * Convert ContentBlock[] to Ollama format: text goes into `content`,
 * images go into a separate `images` array.
 */
function toOllamaMessage(role: string, blocks: ContentBlock[]): Record<string, unknown> {
	const textParts: string[] = [];
	const images: string[] = [];
	for (const block of blocks) {
		if (block.type === 'text') {
			textParts.push(block.text);
		} else {
			images.push(block.data);
		}
	}
	const msg: Record<string, unknown> = { role, content: textParts.join('\n') };
	if (images.length > 0) {
		msg.images = images;
	}
	return msg;
}

export class AIClient {
	/**
	 * In-flight coalescing map (#397): keyed by the deterministic request key,
	 * holds the live dispatch promise so a concurrent identical request shares
	 * the single network call instead of issuing a second one. Entries are
	 * removed in a `.finally()` once settled (success OR failure) so a rejection
	 * never sticks — mirroring intake's in-flight discipline.
	 */
	private readonly inFlight = new Map<string, Promise<string>>();

	/**
	 * Opt-in response cache (#397): an insertion-ordered (LRU) map of request
	 * key → successful response, bounded to {@link AI_RESPONSE_CACHE_MAX}.
	 *
	 * Scope is intentionally per-instance: it matches the long-lived `AIClient`
	 * a `ProposalGenerator` owns, so a re-scan within one session hits the cache.
	 * It does NOT coalesce across separate `new AIClient(...)` instances — a
	 * shared-static cache is a deliberately deferred option.
	 */
	private readonly cache = new Map<string, string>();

	constructor(private getSettings: () => SynapseSettings) {}

	async complete(prompt: string, systemPrompt?: string, opts?: AIRequestOptions): Promise<string> {
		const messages: ChatMessage[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: prompt });
		return this.chat(messages, opts);
	}

	/**
	 * Send a chat request, transparently coalescing concurrent identical calls
	 * and (when enabled) serving/refreshing a response cache. The raw provider
	 * dispatch lives in {@link dispatch}; this method is the caching wrapper.
	 */
	async chat(messages: ChatMessage[], opts?: AIRequestOptions): Promise<string> {
		const { ai } = this.getSettings();

		// Deterministic key over the fully-resolved request. `messages` already
		// embeds the system prompt, so it is covered by the JSON serialization.
		const key = contentKey([
			JSON.stringify(messages),
			ai.provider,
			ai.model,
			String(ai.temperature),
			String(ai.maxTokens),
		]);

		// Cache participation is opt-in: automatic at temperature 0 (the response
		// is meant to be deterministic), or whenever the user enables it.
		const cacheable = ai.temperature === 0 || ai.cacheResponses === true;
		const bypass = opts?.bypassCache === true;

		// Cache read — skipped on bypass so a "regenerate" always re-dispatches.
		if (cacheable && !bypass) {
			const cached = this.cacheGet(key);
			if (cached !== undefined) {
				return cached;
			}
		}

		// In-flight coalescing — a concurrent identical request joins the live
		// dispatch. Bypass never joins (it must produce a fresh result).
		if (!bypass) {
			const existing = this.inFlight.get(key);
			if (existing) {
				return existing;
			}
		}

		// Populate the cache only on success, INSIDE the `.then()`, so a rejected
		// dispatch can never be cached. A bypass still refreshes the cache here.
		const dispatchPromise = this.dispatch(messages).then((res) => {
			if (cacheable) {
				this.cacheSet(key, res);
			}
			return res;
		});

		if (bypass) {
			return dispatchPromise;
		}

		// Register for coalescing and clear the entry once settled. The cleanup is
		// chained onto the RETURNED promise so its possible rejection stays
		// handled by the caller (no floating/unhandled rejection).
		this.inFlight.set(key, dispatchPromise);
		return dispatchPromise.finally(() => {
			if (this.inFlight.get(key) === dispatchPromise) {
				this.inFlight.delete(key);
			}
		});
	}

	/**
	 * Raw provider dispatch — selects the provider and issues the network call.
	 * Behavior is unchanged from the pre-cache `chat()`; the caching/coalescing
	 * wrapper lives in {@link chat}.
	 */
	private async dispatch(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();

		switch (ai.provider) {
			case 'openai':
				return this.callOpenAI(messages);
			case 'anthropic':
				return this.callAnthropic(messages);
			case 'gemini':
				return this.callGemini(messages);
			case 'ollama':
				return this.callOllama(messages);
			default:
				throw new Error(`Unsupported AI provider: ${ai.provider}`);
		}
	}

	/**
	 * LRU read: return the cached value (moving it to most-recently-used) or
	 * `undefined` when absent. Uses `has` so an empty-string response — a valid
	 * cached value — is not mistaken for a miss.
	 */
	private cacheGet(key: string): string | undefined {
		if (!this.cache.has(key)) {
			return undefined;
		}
		const val = this.cache.get(key) as string;
		this.cache.delete(key);
		this.cache.set(key, val);
		return val;
	}

	/**
	 * LRU write: insert/refresh `key` as most-recently-used and evict the oldest
	 * entry once the cache exceeds {@link AI_RESPONSE_CACHE_MAX}.
	 */
	private cacheSet(key: string, val: string): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		this.cache.set(key, val);
		if (this.cache.size > AI_RESPONSE_CACHE_MAX) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) {
				this.cache.delete(oldest);
			}
		}
	}

	private async callOpenAI(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();
		const model = resolveModelId(ai.provider, ai.model);
		const response = await safeRequest({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${ai.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				messages: messages.map(m => ({
					role: m.role,
					content: typeof m.content === 'string'
						? m.content
						: toOpenAIContent(m.content),
				})),
				max_tokens: ai.maxTokens,
				temperature: ai.temperature,
			}),
		});
		return extractOpenAIResponseText(response.json);
	}

	private async callAnthropic(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();
		const model = resolveModelId(ai.provider, ai.model);
		const systemMsg = messages.find(m => m.role === 'system');
		const nonSystemMsgs = messages.filter(m => m.role !== 'system');

		const body: Record<string, unknown> = {
			model,
			max_tokens: ai.maxTokens,
			temperature: ai.temperature,
			messages: nonSystemMsgs.map(m => ({
				role: m.role,
				content: typeof m.content === 'string'
					? m.content
					: toAnthropicContent(m.content),
			})),
		};
		if (systemMsg) {
			body.system = typeof systemMsg.content === 'string'
				? systemMsg.content
				: systemMsg.content;
		}

		const response = await safeRequest({
			url: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'x-api-key': ai.apiKey,
				'anthropic-version': '2023-06-01',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		return extractAnthropicResponseText(response.json);
	}

	private async callGemini(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();
		const model = resolveModelId(ai.provider, ai.model);
		const systemMsg = messages.find(m => m.role === 'system');
		const nonSystemMsgs = messages.filter(m => m.role !== 'system');

		const body: Record<string, unknown> = {
			contents: nonSystemMsgs.map(m => ({
				// Gemini has no 'assistant' role — model turns use 'model'.
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: typeof m.content === 'string'
					? [{ text: m.content }]
					: toGeminiContent(m.content),
			})),
			generationConfig: {
				maxOutputTokens: ai.maxTokens,
				temperature: ai.temperature,
			},
		};
		if (systemMsg) {
			// Gemini has no 'system' message role; route it into system_instruction.
			const text = typeof systemMsg.content === 'string'
				? systemMsg.content
				: systemMsg.content
					.filter((b): b is TextContentBlock => b.type === 'text')
					.map(b => b.text)
					.join('\n');
			body.system_instruction = { parts: [{ text }] };
		}

		const response = await safeRequest({
			url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
			method: 'POST',
			headers: {
				'x-goog-api-key': ai.apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		return extractGeminiResponseText(response.json);
	}

	private async callOllama(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();

		// Validate Ollama endpoint — allow http for localhost, require https otherwise
		let endpointUrl: URL;
		try {
			endpointUrl = new URL(ai.ollamaEndpoint);
		} catch {
			throw new Error('Invalid Ollama endpoint URL');
		}
		const isLocalhost = endpointUrl.hostname === 'localhost' || endpointUrl.hostname === '127.0.0.1' || endpointUrl.hostname === '::1' || endpointUrl.hostname === '[::1]';
		if (endpointUrl.protocol !== 'https:' && !(endpointUrl.protocol === 'http:' && isLocalhost)) {
			throw new Error('Ollama endpoint must use HTTPS (or HTTP for localhost only)');
		}

		const model = resolveModelId(ai.provider, ai.model);
		const response = await safeRequest({
			url: `${ai.ollamaEndpoint}/api/chat`,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: messages.map(m => {
					if (typeof m.content === 'string') {
						return { role: m.role, content: m.content };
					}
					return toOllamaMessage(m.role, m.content);
				}),
				stream: false,
			}),
		});
		return extractOllamaResponseText(response.json);
	}
}
