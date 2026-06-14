import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { SynapseSettings } from '../settings';
import { ChatMessage, ContentBlock, TextContentBlock } from './types';
import { redactSecrets } from './redact';

// Re-exported for back-compat: existing callers and tests import `redactSecrets`
// from this module. The implementation now lives in ./redact (single source of
// truth) so the AI client and `notifyError` can't drift apart.
export { redactSecrets };

/** Default timeout for AI API requests (2 minutes). */
const AI_REQUEST_TIMEOUT_MS = 120_000;

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
			const body = response.json;
			detail = body?.error?.message ?? JSON.stringify(body);
		} catch {
			detail = response.text || `status ${response.status}`;
		}
		// Redact any API keys that the upstream API may echo back in error responses
		throw new Error(`API error (${response.status}): ${redactSecrets(detail)}`);
	}
	return response;
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
export function extractGeminiResponseText(json: GeminiResponseJson): string {
	const candidate = json?.candidates?.[0];
	const parts = candidate?.content?.parts;
	if (!parts || parts.length === 0) {
		const blockReason = json?.promptFeedback?.blockReason;
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
	constructor(private getSettings: () => SynapseSettings) {}

	async complete(prompt: string, systemPrompt?: string): Promise<string> {
		const messages: ChatMessage[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: prompt });
		return this.chat(messages);
	}

	async chat(messages: ChatMessage[]): Promise<string> {
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
		return response.json.choices[0].message.content;
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
		return response.json.content[0].text;
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
		return response.json.message.content;
	}
}
