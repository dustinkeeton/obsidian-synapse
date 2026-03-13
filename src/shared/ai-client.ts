import { requestUrl } from 'obsidian';
import { AutoNotesSettings } from '../settings';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Map simplified model names to actual API model IDs.
 * Anthropic models use short names (sonnet, opus, haiku) in settings
 * but need full IDs for the API.
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
	opus: 'claude-opus-4-20250514',
	sonnet: 'claude-sonnet-4-20250514',
	haiku: 'claude-haiku-4-20250414',
};

function resolveModelId(provider: string, model: string): string {
	if (provider === 'anthropic' && model in ANTHROPIC_MODEL_MAP) {
		return ANTHROPIC_MODEL_MAP[model];
	}
	return model;
}

export class AIClient {
	constructor(private getSettings: () => AutoNotesSettings) {}

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
			case 'ollama':
				return this.callOllama(messages);
			default:
				throw new Error(`Unsupported AI provider: ${ai.provider}`);
		}
	}

	private async callOpenAI(messages: ChatMessage[]): Promise<string> {
		const { ai } = this.getSettings();
		const model = resolveModelId(ai.provider, ai.model);
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${ai.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				messages,
				max_tokens: ai.maxTokens,
				temperature: ai.temperature,
			}),
			throw: true,
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
				content: m.content,
			})),
		};
		if (systemMsg) {
			body.system = systemMsg.content;
		}

		const response = await requestUrl({
			url: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			headers: {
				'x-api-key': ai.apiKey,
				'anthropic-version': '2023-06-01',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			throw: true,
		});
		return response.json.content[0].text;
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
		const isLocalhost = endpointUrl.hostname === 'localhost' || endpointUrl.hostname === '127.0.0.1';
		if (endpointUrl.protocol !== 'https:' && !(endpointUrl.protocol === 'http:' && isLocalhost)) {
			throw new Error('Ollama endpoint must use HTTPS (or HTTP for localhost only)');
		}

		const model = resolveModelId(ai.provider, ai.model);
		const response = await requestUrl({
			url: `${ai.ollamaEndpoint}/api/chat`,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages,
				stream: false,
			}),
			throw: true,
		});
		return response.json.message.content;
	}
}
