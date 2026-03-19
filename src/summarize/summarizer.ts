import { AIClient, sanitizeAIResponse } from '../shared';
import { SynapseSettings } from '../settings';
import { resolveExpertise, buildElixrPromptFragment } from '../elixr';

type SummaryStyle = 'bullets' | 'paragraph' | 'key-points';

const STYLE_PROMPTS: Record<SummaryStyle, string> = {
	bullets: `Summarize the following content as concise bullet points. Each bullet should capture one key idea. Use markdown bullet syntax (- ). Keep it brief and informative.`,
	paragraph: `Summarize the following content in a brief paragraph. Focus on the main ideas and key takeaways. Keep it concise — aim for 2-4 sentences.`,
	'key-points': `Summarize the following content as key takeaways. Use short headers (###) for each takeaway, with 1-2 sentences of explanation under each. Focus on actionable or notable insights.`,
};

export class Summarizer {
	private client: AIClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.client = new AIClient(getSettings);
	}

	async summarize(
		content: string,
		source: string,
		style: SummaryStyle,
		customPrompt?: string
	): Promise<string> {
		let systemPrompt = customPrompt || STYLE_PROMPTS[style];

		// Inject EliXr expertise context when enabled
		const settings = this.getSettings();
		if (settings.elixr.enabled) {
			const { topic, level } = resolveExpertise(content, settings.elixr);
			systemPrompt += buildElixrPromptFragment(topic, level);
		}

		const userPrompt = `Source: ${source}\n\n${content}`;

		const response = await this.client.complete(userPrompt, systemPrompt);
		return sanitizeAIResponse(response);
	}
}
