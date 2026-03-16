import { App, TFile, getAllTags } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { AIClient, parseFrontmatter, sanitizeAIResponse, withRetry } from '../shared';
import { ContentAnalysis, NoteTopic } from './types';

const SYSTEM_PROMPT = `You are a note organization assistant. Given the content of a note, determine its primary topics/categories.

Return a JSON array of topic objects. Each object has:
- "label": a short, lowercase topic label (1-3 words, e.g., "machine learning", "project planning", "daily journal")
- "confidence": a number from 0 to 1 indicating how confident you are

Rules:
- Return 1-3 topics maximum, ordered by confidence (highest first)
- Use broad, folder-appropriate categories (these will become directory names)
- Prefer existing common categories over inventing new ones
- Labels should be suitable as directory names (no special characters)
- Return ONLY the JSON array, no markdown fences or explanation

Example output:
[{"label": "machine learning", "confidence": 0.9}, {"label": "research", "confidence": 0.6}]`;

/**
 * Analyzes note content to extract topics and categories.
 * Uses both AI analysis and existing metadata (tags, links, frontmatter).
 */
export class ContentAnalyzer {
	private aiClient: AIClient;

	constructor(
		private app: App,
		private getSettings: () => AutoNotesSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Analyze a note's content to determine its topical categories.
	 * Combines AI topic extraction with existing metadata signals.
	 */
	async analyze(file: TFile): Promise<ContentAnalysis> {
		const content = await this.app.vault.read(file);
		const parsed = parseFrontmatter(content);

		// Gather existing metadata
		const cache = this.app.metadataCache.getFileCache(file);
		const existingTags = cache ? (getAllTags(cache) || []) : [];
		const existingLinks = this.getOutgoingLinks(file);

		// Extract topics from content via AI
		const topics = await this.extractTopics(parsed.body, existingTags);

		return {
			notePath: file.path,
			topics,
			tags: existingTags,
			links: existingLinks,
		};
	}

	/**
	 * Extract topics from note body text using AI.
	 * Falls back to tag-based heuristics if AI fails.
	 */
	async extractTopics(body: string, tags: string[]): Promise<NoteTopic[]> {
		const trimmedBody = body.trim();
		if (!trimmedBody) {
			return this.topicsFromTags(tags);
		}

		// Truncate long content to avoid token limits
		const maxChars = 3000;
		const truncated = trimmedBody.length > maxChars
			? trimmedBody.slice(0, maxChars) + '\n\n[Content truncated]'
			: trimmedBody;

		const contextParts = [truncated];
		if (tags.length > 0) {
			contextParts.push(`\nExisting tags: ${tags.join(', ')}`);
		}

		try {
			const raw = await withRetry(
				() => this.aiClient.complete(contextParts.join('\n'), SYSTEM_PROMPT),
				2,
				2000
			);

			return this.parseTopicResponse(sanitizeAIResponse(raw));
		} catch {
			// Fall back to tag-based heuristics
			return this.topicsFromTags(tags);
		}
	}

	/**
	 * Parse the AI response into topic objects.
	 * Handles common AI formatting quirks (code fences, extra text).
	 */
	parseTopicResponse(raw: string): NoteTopic[] {
		let cleaned = raw.trim();

		// Strip code fences
		if (cleaned.startsWith('```')) {
			const lines = cleaned.split('\n');
			cleaned = lines.slice(1, -1).join('\n').trim();
		}

		// Find JSON array in the response
		const arrayStart = cleaned.indexOf('[');
		const arrayEnd = cleaned.lastIndexOf(']');
		if (arrayStart === -1 || arrayEnd === -1) {
			return [];
		}

		try {
			const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
			if (!Array.isArray(parsed)) return [];

			return parsed
				.filter(
					(t: unknown): t is { label: string; confidence: number } =>
						typeof t === 'object' &&
						t !== null &&
						typeof (t as Record<string, unknown>).label === 'string' &&
						typeof (t as Record<string, unknown>).confidence === 'number'
				)
				.map(t => ({
					label: t.label.toLowerCase().trim(),
					confidence: Math.max(0, Math.min(1, t.confidence)),
				}))
				.slice(0, 3);
		} catch {
			return [];
		}
	}

	/**
	 * Derive topics from tags as a fallback when AI is unavailable.
	 */
	topicsFromTags(tags: string[]): NoteTopic[] {
		if (tags.length === 0) return [];

		return tags
			.slice(0, 3)
			.map(tag => ({
				label: tag
					.replace(/^#/, '')
					.replace(/\//g, ' ')
					.toLowerCase()
					.trim(),
				confidence: 0.5,
			}))
			.filter(t => t.label.length > 0);
	}

	/**
	 * Get outgoing internal link paths from a file.
	 */
	private getOutgoingLinks(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.links) return [];

		const paths: string[] = [];
		for (const link of cache.links) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(
				link.link,
				file.path
			);
			if (dest) {
				paths.push(dest.path);
			}
		}
		return paths;
	}
}
