import { App, TFile, getAllTags } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, isRecord, parseFrontmatter, parseJson, routeByConfidence, sanitizeAIResponse, withRetry } from '../shared';
import type { AIRequestOptions, DecisionLane, DecisionRequestOptions } from '../shared';
import { PlacementDecider } from './placement-decider';
import { ContentAnalysis, NoteTopic, Placement } from './types';

/** Either a confident existing-folder placement from the System 1 lane or the generative topics. */
export interface ResolvedPlacement {
	topics: NoteTopic[];
	placement?: Placement;
	lane: DecisionLane;
}

const SYSTEM_PROMPT = `You are a note organization assistant. Given the content of a note, determine its primary topics/categories.

Return a JSON array of topic objects. Each object has:
- "label": a short, lowercase topic label (1-3 words, e.g., "machine learning", "project planning", "daily journal")
- "confidence": a number from 0 to 1 indicating how confident you are

Rules:
- Return 1-3 topics maximum, ordered by confidence (highest first)
- Prefer broad, reusable umbrella categories over hyper-specific labels (e.g. "networking", not "tcp-ip-configuration") — these become directory names
- Use the singular form of nouns (e.g. "model", not "models")
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
	private placement: PlacementDecider;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings,
		placement?: PlacementDecider
	) {
		this.aiClient = new AIClient(getSettings);
		this.placement = placement ?? new PlacementDecider(app, getSettings);
	}

	/**
	 * Analyze a note's content to determine its topical categories.
	 * Combines AI topic extraction with existing metadata signals.
	 */
	async analyze(file: TFile, aiOpts?: DecisionRequestOptions): Promise<ContentAnalysis> {
		const content = await this.app.vault.read(file);
		const parsed = parseFrontmatter(content);

		// Gather existing metadata
		const cache = this.app.metadataCache.getFileCache(file);
		const existingTags = cache ? (getAllTags(cache) || []) : [];
		const existingLinks = this.getOutgoingLinks(file);

		const { topics, placement } = await this.resolvePlacement(parsed.body, existingTags, aiOpts);

		return {
			notePath: file.path,
			topics,
			tags: existingTags,
			links: existingLinks,
			...(placement ? { placement } : {}),
		};
	}

	/**
	 * System 1 placement over existing folders at or above
	 * `organize.organizeConfidenceThreshold`; otherwise (lane off, "new
	 * directory", low confidence, or any lane error) the existing
	 * {@link extractTopics} path, unchanged (#558).
	 */
	async resolvePlacement(body: string, tags: string[], aiOpts?: DecisionRequestOptions): Promise<ResolvedPlacement> {
		const routed = await routeByConfidence<Placement, ResolvedPlacement>({
			systemOne: this.placement.isAvailable() ? () => this.placement.decide(body, tags, aiOpts) : null,
			floor: this.getSettings().organize.organizeConfidenceThreshold,
			confidenceOf: (p) => p.confidence,
			accept: (p) => ({ topics: [], placement: p, lane: 'system-one' }),
			fallback: async () => ({ topics: await this.extractTopics(body, tags, aiOpts), lane: 'system-two' }),
			label: 'organize placement',
		});
		if (routed.lane === 'system-one') aiOpts?.onSystemOne?.();
		return routed.value;
	}

	/**
	 * Extract topics from note body text using AI.
	 * Falls back to tag-based heuristics if AI fails.
	 */
	async extractTopics(body: string, tags: string[], aiOpts?: AIRequestOptions): Promise<NoteTopic[]> {
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
				() => this.aiClient.complete(contextParts.join('\n'), SYSTEM_PROMPT, aiOpts),
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
			const parsed = parseJson(cleaned.slice(arrayStart, arrayEnd + 1));
			if (!Array.isArray(parsed)) return [];

			return parsed
				.filter(
					(t: unknown): t is { label: string; confidence: number } =>
						isRecord(t) &&
						typeof t.label === 'string' &&
						typeof t.confidence === 'number'
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
				confidence: 0.3,
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
