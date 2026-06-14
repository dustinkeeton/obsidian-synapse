import { App, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, isRecord, parseJson, sanitizeAIResponse } from '../shared';
import { ExtractedTopic } from './types';

/**
 * Extracts sub-topics from a note's content using AI.
 * Matches topic titles against existing vault notes to avoid duplicates.
 */
export class TopicAnalyzer {
	private aiClient: AIClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Extract topics from note content.
	 * @param content       The markdown content to analyze
	 * @param noteTitle     Title of the source note (for context)
	 * @param ancestorTopics Titles of topics already in the ancestry chain (to avoid repetition)
	 */
	async extractTopics(
		content: string,
		noteTitle: string,
		ancestorTopics: string[]
	): Promise<ExtractedTopic[]> {
		const systemPrompt = `You are a knowledge graph analyst. Given a note's content, extract the most important sub-topics that deserve their own dedicated notes. Each topic should be specific enough to warrant a full note, not too broad or too narrow.

Rules:
- Return 3-7 topics max
- Each topic title should be a proper note title (capitalized, 2-5 words)
- Relevance score 0-1 indicates how central the topic is to the source note
- Include a one-sentence description of what the note should cover
- Extract any URLs from the source that relate to each topic
- Do NOT repeat any of these ancestor topics: ${ancestorTopics.length > 0 ? ancestorTopics.join(', ') : '(none)'}

Respond ONLY with a JSON array, no markdown fencing:
[{"title": "Topic Name", "description": "What this note covers", "relevance": 0.8, "relatedUrls": ["https://..."]}]`;

		const userPrompt = `Note title: "${noteTitle}"

Content:
${content.slice(0, 4000)}`;

		const response = await this.aiClient.complete(userPrompt, systemPrompt);
		const topics = this.parseTopics(response);
		return this.matchVaultNotes(topics);
	}

	private parseTopics(response: string): ExtractedTopic[] {
		try {
			// Sanitize AI response before parsing to strip script tags, event handlers, etc.
			const sanitized = sanitizeAIResponse(response);
			// Strip markdown code fences if present
			const cleaned = sanitized.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
			const parsed = parseJson(cleaned);

			if (!Array.isArray(parsed)) return [];

			return parsed
				.filter((t: unknown): t is Record<string, unknown> =>
					isRecord(t) &&
					typeof t.title === 'string' &&
					typeof t.description === 'string' &&
					typeof t.relevance === 'number'
				)
				.map(t => ({
					title: String(t.title).replace(/[<>]/g, ''),
					description: String(t.description).replace(/[<>]/g, ''),
					relevance: Math.max(0, Math.min(1, Number(t.relevance))),
					existsInVault: false,
					relatedUrls: Array.isArray(t.relatedUrls)
						? (t.relatedUrls as unknown[]).filter((u): u is string =>
							typeof u === 'string' && /^https?:\/\//.test(u))
						: [],
				}));
		} catch {
			console.warn('[Synapse] Failed to parse topic extraction response');
			return [];
		}
	}

	private matchVaultNotes(topics: ExtractedTopic[]): ExtractedTopic[] {
		const allFiles = this.app.vault.getMarkdownFiles();
		const titleMap = new Map<string, TFile>();
		for (const file of allFiles) {
			titleMap.set(file.basename.toLowerCase(), file);
		}

		return topics.map(topic => {
			const match = titleMap.get(topic.title.toLowerCase());
			if (match) {
				return {
					...topic,
					existsInVault: true,
					existingPath: match.path,
				};
			}
			return topic;
		});
	}
}
