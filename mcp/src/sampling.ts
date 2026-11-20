import type { CreateMessageRequest, CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import type { ChatMessage, ContentBlock, GenerationOutput, GenerationRequest } from './api-types.js';

/** Output cap asked of the client; Synapse's own Anthropic calls use the same. */
export const SAMPLING_MAX_TOKENS = 16384;

type SamplingMessage = CreateMessageRequest['params']['messages'][number];

function textOf(content: string | ContentBlock[]): string {
	return typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n\n');
}

/**
 * A Synapse model request as MCP sampling params: system messages become the system prompt, and a
 * multi-block message becomes one message per block (older clients take a single content block).
 */
export function toSamplingParams(request: GenerationRequest): CreateMessageRequest['params'] {
	const system = request.messages.filter((message) => message.role === 'system').map((message) => textOf(message.content)).filter(Boolean);
	const messages: SamplingMessage[] = [];
	for (const message of request.messages as ChatMessage[]) {
		if (message.role === 'system') continue;
		const role = message.role;
		if (typeof message.content === 'string') {
			messages.push({ role, content: { type: 'text', text: message.content } });
			continue;
		}
		for (const block of message.content) {
			messages.push(block.type === 'text'
				? { role, content: { type: 'text', text: block.text } }
				: { role, content: { type: 'image', data: block.data, mimeType: block.mediaType } });
		}
	}
	const params: CreateMessageRequest['params'] = { messages, maxTokens: SAMPLING_MAX_TOKENS, includeContext: 'none' };
	if (system.length > 0) params.systemPrompt = system.join('\n\n');
	return params;
}

/** The client's sampling reply as a `jobs.commit` output; a `maxTokens` stop is reported as truncated, so Synapse discards it. */
export function toGenerationOutput(requestId: string, result: CreateMessageResult): GenerationOutput {
	const blocks = Array.isArray(result.content) ? result.content : [result.content];
	const text = blocks.map((block) => (block.type === 'text' ? block.text : '')).join('');
	const output: GenerationOutput = { requestId, text, model: result.model };
	if (result.stopReason) output.stopReason = result.stopReason;
	if (result.stopReason === 'maxTokens') output.truncated = true;
	return output;
}
