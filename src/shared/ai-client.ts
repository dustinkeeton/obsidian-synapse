import type { RequestUrlResponse } from 'obsidian';
import type { AIFeatureId, SynapseSettings } from '../settings';
import { aiRequestTimeoutMs, anthropicMaxTokens, effortFor, effortWireValue, resolveAIConfig } from './ai-config';
import type { ResolvedAIConfig } from './ai-config';
import { ChatMessage, ContentBlock, TextContentBlock } from './types';
import { redactSecrets } from './redact';
import { isRecord } from './json-utils';
import { contentKey } from './hash-utils';
import { safeRequest } from './safe-request';

// Re-exported for back-compat: existing callers and tests import `redactSecrets`
// from this module. The implementation now lives in ./redact (single source of
// truth) so the AI client and `notifyError` can't drift apart.
export { redactSecrets };

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
	/** Called when the response is replayed from the response cache (#527); never for a dispatch or a coalesced join. */
	onCacheHit?: () => void;
	/** Model for this call only (e.g. a vision model), on the feature's resolved provider; settings are never touched. */
	model?: string;
}

/**
 * Map simplified model names to actual API model IDs.
 * Anthropic models use short names (fable, opus, sonnet, haiku) in settings
 * but need full IDs for the API. IDs are used bare — date-suffixed snapshots
 * are never constructed.
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
	fable: 'claude-fable-5-2',
	opus: 'claude-opus-5-5',
	sonnet: 'claude-sonnet-5-5',
	haiku: 'claude-haiku-5-5',
};

/** Anthropic API version; the 2026-10-21 version rejects sampling parameters, which are never sent. */
export const ANTHROPIC_API_VERSION = '2026-10-21';

/** Thrown when a reply stopped at its output limit, so partial text is never returned or cached. */
function truncated(provider: string): Error {
	return new Error(`${provider} stopped at its output limit before finishing, so the partial reply was discarded`);
}

/** Fable is unavailable to zero-data-retention orgs, which get a 400 on every request. */
function withAnthropicErrorHint(err: unknown, modelId: string): unknown {
	if (err instanceof Error && modelId.startsWith('claude-fable') && err.message.includes('(400)')) {
		return new Error(
			`${err.message} — Claude Fable requires 30-day data retention; organizations configured for zero data retention cannot call it.`
		);
	}
	return err;
}

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

/** Gemini finish reasons that mean the reply was cut off. */
const GEMINI_TRUNCATED = new Set(['MAX_TOKENS', 'CONTINUATION']);

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
		if (finishReason && GEMINI_TRUNCATED.has(finishReason)) throw truncated('Gemini');
		throw new Error(
			`Gemini returned no text${finishReason ? ` (finish reason: ${finishReason})` : ''}`
		);
	}
	if (candidate?.finishReason && GEMINI_TRUNCATED.has(candidate.finishReason)) throw truncated('Gemini');
	return parts.map(p => p.text ?? '').join('');
}

/** The subset of an OpenAI chat-completions response needed to extract text. */
interface OpenAIChatResponse {
	choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
}

/** The subset of an Anthropic messages response needed to extract text. */
interface AnthropicMessageResponse {
	content?: Array<{ type?: string; text?: string }>;
	stop_reason?: string;
	/** Populated only for `stop_reason: "refusal"`; `null` for every other stop reason. */
	stop_details?: { type?: string; category?: string; explanation?: string } | null;
}

/** The subset of an Ollama chat response needed to extract text. */
interface OllamaChatResponse {
	message?: { content?: string };
	done_reason?: string;
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
	const choice = (json as OpenAIChatResponse | null)?.choices?.[0];
	if (choice?.finish_reason === 'length') throw truncated('OpenAI');
	const content = choice?.message?.content;
	if (typeof content !== 'string') {
		throw new Error(`Unexpected OpenAI response: ${briefShape(json)}`);
	}
	return content;
}

/**
 * Extract the text from an Anthropic messages response. Concatenates the text
 * of every `text` block — models with thinking enabled return `thinking` blocks
 * first, so the text block is not reliably at index 0. Throws a descriptive
 * error when no text block is present instead of letting an opaque `TypeError`
 * escape from `content[0].text`.
 */
export function extractAnthropicResponseText(json: unknown): string {
	const response = json as AnthropicMessageResponse | null;
	// Safety classifiers decline as HTTP 200 with a possibly empty `content`,
	// so the stop reason has to be read before the content blocks.
	if (response?.stop_reason === 'refusal') {
		const reason = response.stop_details?.explanation ?? response.stop_details?.category;
		throw new Error(
			`Anthropic declined this request (safety refusal, not a network or API-key failure)${reason ? `: ${reason}` : ''}`
		);
	}
	if (response?.stop_reason === 'max_tokens') throw truncated('Anthropic');
	const blocks = response?.content;
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
	const response = json as OllamaChatResponse | null;
	if (response?.done_reason === 'length') throw truncated('Ollama');
	const content = response?.message?.content;
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

	/** `feature` selects that feature's provider/model override; omitted means the default. */
	constructor(
		private getSettings: () => SynapseSettings,
		private feature?: AIFeatureId,
	) {}

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
		const settings = this.getSettings();
		const { ai } = settings;
		const resolved = resolveAIConfig(settings, this.feature);
		const cfg: ResolvedAIConfig = opts?.model
			? { ...resolved, model: opts.model, effort: effortFor(resolved.provider, opts.model, resolved.effort) }
			: resolved;

		// Deterministic key over the fully-resolved request. `messages` already
		// embeds the system prompt, so it is covered by the JSON serialization.
		const key = contentKey([
			JSON.stringify(messages),
			cfg.provider,
			cfg.model,
			cfg.effort ?? '',
		]);

		const cacheable = ai.cacheResponses === true;
		const bypass = opts?.bypassCache === true;

		// Cache read — skipped on bypass so a "regenerate" always re-dispatches.
		if (cacheable && !bypass) {
			const cached = this.cacheGet(key);
			if (cached !== undefined) {
				opts?.onCacheHit?.();
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
		const dispatchPromise = this.dispatch(messages, cfg).then((res) => {
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
	private async dispatch(messages: ChatMessage[], cfg: ResolvedAIConfig): Promise<string> {
		switch (cfg.provider) {
			case 'openai':
				return this.callOpenAI(messages, cfg);
			case 'anthropic':
				return this.callAnthropic(messages, cfg);
			case 'gemini':
				return this.callGemini(messages, cfg);
			case 'ollama':
				return this.callOllama(messages, cfg);
			default:
				throw new Error(`Unsupported AI provider: ${String(cfg.provider)}`);
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

	private async callOpenAI(messages: ChatMessage[], cfg: ResolvedAIConfig): Promise<string> {
		const model = resolveModelId(cfg.provider, cfg.model);
		const body: Record<string, unknown> = {
			model,
			messages: messages.map(m => ({
				// Every listed OpenAI model is a reasoning model, for which `developer` replaces `system`.
				role: m.role === 'system' ? 'developer' : m.role,
				content: typeof m.content === 'string'
					? m.content
					: toOpenAIContent(m.content),
			})),
		};
		const effort = effortWireValue(cfg.provider, cfg.model, cfg.effort);
		if (effort !== undefined) {
			body.reasoning_effort = effort;
		}

		const response = await safeRequest({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${cfg.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}, aiRequestTimeoutMs(cfg.effort));
		return extractOpenAIResponseText(response.json);
	}

	private async callAnthropic(messages: ChatMessage[], cfg: ResolvedAIConfig): Promise<string> {
		const model = resolveModelId(cfg.provider, cfg.model);
		const systemMsg = messages.find(m => m.role === 'system');
		const nonSystemMsgs = messages.filter(m => m.role !== 'system');

		const body: Record<string, unknown> = {
			model,
			max_tokens: anthropicMaxTokens(cfg.effort),
			messages: nonSystemMsgs.map(m => ({
				role: m.role,
				content: typeof m.content === 'string'
					? m.content
					: toAnthropicContent(m.content),
			})),
		};
		// `thinking` is never sent: adaptive thinking is on by default.
		const effort = effortWireValue(cfg.provider, cfg.model, cfg.effort);
		if (effort !== undefined) {
			body.output_config = { effort };
		}
		if (systemMsg) {
			body.system = typeof systemMsg.content === 'string'
				? systemMsg.content
				: systemMsg.content;
		}

		let response: RequestUrlResponse;
		try {
			response = await safeRequest({
				url: 'https://api.anthropic.com/v1/messages',
				method: 'POST',
				headers: {
					'x-api-key': cfg.apiKey,
					'anthropic-version': ANTHROPIC_API_VERSION,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			}, aiRequestTimeoutMs(cfg.effort));
		} catch (err) {
			throw withAnthropicErrorHint(err, model);
		}
		return extractAnthropicResponseText(response.json);
	}

	private async callGemini(messages: ChatMessage[], cfg: ResolvedAIConfig): Promise<string> {
		const model = resolveModelId(cfg.provider, cfg.model);
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
		};
		const effort = effortWireValue(cfg.provider, cfg.model, cfg.effort);
		if (effort !== undefined) {
			body.generationConfig = { thinkingConfig: { thinkingLevel: effort } };
		}
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
				'x-goog-api-key': cfg.apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}, aiRequestTimeoutMs(cfg.effort));
		return extractGeminiResponseText(response.json);
	}

	private async callOllama(messages: ChatMessage[], cfg: ResolvedAIConfig): Promise<string> {

		// Validate Ollama endpoint — allow http for localhost, require https otherwise
		let endpointUrl: URL;
		try {
			endpointUrl = new URL(cfg.ollamaEndpoint);
		} catch {
			throw new Error('Invalid Ollama endpoint URL');
		}
		const isLocalhost = endpointUrl.hostname === 'localhost' || endpointUrl.hostname === '127.0.0.1' || endpointUrl.hostname === '::1' || endpointUrl.hostname === '[::1]';
		if (endpointUrl.protocol !== 'https:' && !(endpointUrl.protocol === 'http:' && isLocalhost)) {
			throw new Error('Ollama endpoint must use HTTPS (or HTTP for localhost only)');
		}

		const model = resolveModelId(cfg.provider, cfg.model);
		const think = effortWireValue(cfg.provider, cfg.model, cfg.effort);
		const response = await safeRequest({
			url: `${cfg.ollamaEndpoint}/api/chat`,
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
				...(think !== undefined ? { think } : {}),
			}),
		}, aiRequestTimeoutMs(cfg.effort));
		return extractOllamaResponseText(response.json);
	}
}
