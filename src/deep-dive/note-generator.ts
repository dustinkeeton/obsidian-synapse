import { SynapseSettings } from '../settings';
import { AIClient, sanitizeAIResponse, stripCodeFences } from '../shared';
import { ExtractedTopic } from './types';

/**
 * Generates full markdown content for a child note based on an extracted topic.
 */
export class NoteGenerator {
	private aiClient: AIClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Generate content for a new note about the given topic.
	 * @param topic         The extracted topic to expand
	 * @param sourceTitle   Title of the parent note
	 * @param sourceContent Content of the parent note (for context)
	 */
	async generateContent(
		topic: ExtractedTopic,
		sourceTitle: string,
		sourceContent: string
	): Promise<string> {
		const systemPrompt = `You are a knowledge base author. Write a comprehensive note about a specific topic. The note should be well-structured markdown suitable for an Obsidian vault.

Rules:
- Start with a brief frontmatter block (tags, related)
- Use proper markdown headings (## for sections)
- Be thorough but concise — aim for 200-500 words of body content
- Include [[wikilinks]] to related concepts where natural
- If URLs are provided, reference them naturally in the text
- If image URLs are present, preserve them as markdown image embeds (![alt](url)) rather than describing the image. For internal images like [[image.jpg]], embed them as ![[image.jpg]]
- Do NOT include the note title as an H1 — Obsidian uses the filename
- Write in an encyclopedic, informative tone`;

		const urlContext = topic.relatedUrls.length > 0
			? `\nRelevant URLs: ${topic.relatedUrls.join(', ')}`
			: '';

		const userPrompt = `Write a note about: "${topic.title}"
Topic scope: ${topic.description}
Parent note: "${sourceTitle}"${urlContext}

Context from parent note (for reference, do not repeat):
${sourceContent.slice(0, 2000)}`;

		const content = await this.aiClient.complete(userPrompt, systemPrompt);
		return this.cleanContent(stripCodeFences(sanitizeAIResponse(content)), topic, sourceTitle);
	}

	private cleanContent(content: string, topic: ExtractedTopic, sourceTitle: string): string {
		let cleaned = content.trim();

		// If AI added an H1 title, remove it (Obsidian uses filename)
		cleaned = cleaned.replace(/^#\s+.+\n+/, '');

		// Ensure frontmatter exists with at minimum a parent link
		if (!cleaned.startsWith('---')) {
			cleaned = `---\nparent: "[[${sourceTitle}]]"\n---\n\n${cleaned}`;
		} else {
			// Inject parent link into existing frontmatter if not present
			if (!cleaned.includes('parent:')) {
				cleaned = cleaned.replace(/^---\n/, `---\nparent: "[[${sourceTitle}]]"\n`);
			}
		}

		return cleaned;
	}
}
