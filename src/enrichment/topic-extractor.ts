import { App, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, parseJson, sanitizeAIResponse } from '../shared';
import { InternalLinkCandidate } from './types';
import { VaultAnalyzer } from './vault-analyzer';
import { computeProximityWeight } from './weight-calculator';

/**
 * Extracts key topics from note content and converts them into
 * internal link candidates. Topics become [[links]] in the knowledge
 * graph — the semantic counterpart to metadata tags.
 *
 * New-note suggestions are only created when multiple notes
 * independently reference the same unmatched topic, proving it's
 * a genuine hub concept worth creating — not just AI noise.
 */
export class TopicExtractor {
	private aiClient: AIClient;

	/**
	 * Accumulates unmatched topics across a vault scan.
	 * Key: normalized topic → Set of note paths that surfaced it.
	 * Populated by extractTopics(), consumed by resolveNewNoteCandidates().
	 */
	private pendingNewTopics = new Map<string, { displayText: string; notePaths: Set<string> }>();

	constructor(
		private app: App,
		private analyzer: VaultAnalyzer,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Extract topic-based link candidates for a single note.
	 *
	 * Matched topics (existing vault notes) become candidates immediately.
	 * Unmatched topics are accumulated in pendingNewTopics for later
	 * resolution via resolveNewNoteCandidates() during vault scans.
	 */
	async extractTopics(
		noteContent: string,
		notePath: string,
		existingLinkPaths: string[]
	): Promise<InternalLinkCandidate[]> {
		const settings = this.getSettings().enrichment;

		const topics = await this.getTopicsFromAI(noteContent);
		if (topics.length === 0) return [];

		// Build a case-insensitive map of vault note titles → file paths
		const titleMap = this.buildTitleMap();

		const existingSet = new Set(existingLinkPaths);
		const candidates: InternalLinkCandidate[] = [];
		const seenPaths = new Set<string>();
		const seenTopics = new Set<string>();

		for (const topic of topics) {
			const normalized = topic.toLowerCase();
			if (seenTopics.has(normalized)) continue;
			seenTopics.add(normalized);

			const matchedPath = titleMap.get(normalized);

			if (matchedPath) {
				// Existing note — skip if already linked
				if (existingSet.has(matchedPath)) continue;
				if (seenPaths.has(matchedPath)) continue;
				seenPaths.add(matchedPath);

				const proximity = computeProximityWeight(
					notePath,
					matchedPath,
					settings.weights
				);

				const targetFile = this.app.vault.getAbstractFileByPath(matchedPath);
				const displayText = targetFile instanceof TFile
					? this.app.metadataCache.fileToLinktext(targetFile, notePath, true)
					: topic;

				// Topical match is the base (0.7), proximity adds a small bonus
				const topicBase = 0.7;
				candidates.push({
					targetPath: matchedPath,
					displayText,
					relevanceScore: topicBase + proximity * 0.2,
					reason: 'AI-identified topic',
				});
			} else if (settings.suggestNewNotes) {
				// Accumulate unmatched topic — only promoted to a candidate
				// if multiple notes independently surface the same topic
				const entry = this.pendingNewTopics.get(normalized);
				if (entry) {
					entry.notePaths.add(notePath);
				} else {
					this.pendingNewTopics.set(normalized, {
						displayText: topic,
						notePaths: new Set([notePath]),
					});
				}
			}
		}

		candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
		return candidates.slice(0, settings.maxTopicLinks);
	}

	/**
	 * After a vault scan, resolve accumulated unmatched topics into
	 * new-note candidates. Only topics referenced by 2+ notes qualify.
	 *
	 * Returns a map of notePath → candidates to inject into that note's proposal.
	 * Clears the pending buffer.
	 */
	resolveNewNoteCandidates(): Map<string, InternalLinkCandidate[]> {
		const result = new Map<string, InternalLinkCandidate[]>();

		for (const [, entry] of this.pendingNewTopics) {
			if (entry.notePaths.size < 2) continue;

			const candidate: InternalLinkCandidate = {
				targetPath: `${entry.displayText}.md`,
				displayText: entry.displayText,
				relevanceScore: 0.5,
				reason: `AI-identified topic (${entry.notePaths.size} notes reference this)`,
			};

			for (const notePath of entry.notePaths) {
				const existing = result.get(notePath) || [];
				existing.push(candidate);
				result.set(notePath, existing);
			}
		}

		this.pendingNewTopics.clear();
		return result;
	}

	/** Clear accumulated state without resolving. */
	clearPending(): void {
		this.pendingNewTopics.clear();
	}

	private buildTitleMap(): Map<string, string> {
		const map = new Map<string, string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			map.set(file.basename.toLowerCase(), file.path);
		}
		return map;
	}

	private async getTopicsFromAI(noteContent: string): Promise<string[]> {
		const truncatedContent = noteContent.slice(0, 3000);

		const prompt = `Identify the key concepts, people, technologies, theories, and topics in this note that would make good links to other notes in a knowledge base.

## Note Content
${truncatedContent}

## Instructions
- Be specific: prefer "AI Governance" over "AI", "React Hooks" over "React".
- Return note-title-worthy names: proper nouns, specific concepts, named frameworks.
- Each topic should be 1-4 words, title-cased.
- Return ONLY a JSON array of strings.
- Example: ["Machine Learning", "Gradient Descent", "PyTorch", "Andrew Ng"]
- Aim for 5-15 topics.`;

		const systemPrompt =
			'You are a knowledge graph assistant. Return only valid JSON arrays of topic strings. No explanations.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = parseJson(cleaned);
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(t: unknown): t is string =>
						typeof t === 'string' &&
						t.length > 0 &&
						t.length <= 100
				);
			}
		} catch {
			// AI failure — return empty
		}
		return [];
	}
}
