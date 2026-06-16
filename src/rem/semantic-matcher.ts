import type { App, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { RemLinkCandidate, RemOccurrence } from './types';
import { AIClient, isRecord, parseJson, getIncludedMarkdownFiles } from '../shared';

/** One conceptual match the AI is expected to return, after validation. */
interface SemanticMatch {
	title: string;
	matchedConcept: string;
	confidence: number;
}

/** Type guard: narrows an unknown array element to a {@link SemanticMatch}. */
function isSemanticMatch(v: unknown): v is SemanticMatch {
	return (
		isRecord(v) &&
		typeof v.title === 'string' &&
		typeof v.matchedConcept === 'string' &&
		typeof v.confidence === 'number'
	);
}

/**
 * Uses AI to discover conceptual matches between a note's content
 * and other vault note titles, beyond literal text matching.
 *
 * Example: text mentions "machine learning" → AI identifies
 * [[ML Fundamentals]] as a conceptual match even if the exact
 * title never appears in the text.
 */
export class SemanticMatcher {
	private aiClient: AIClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Find conceptual matches between a note's content and vault note titles.
	 *
	 * @param sourceFile - The note being scanned
	 * @param content - The raw text of the note
	 * @param existingMatches - Titles already matched literally (to avoid duplicates)
	 * @param maxLinks - Maximum candidates to return
	 * @returns Semantic link candidates with confidence scores
	 */
	async match(
		sourceFile: TFile,
		content: string,
		existingMatches: Set<string>,
		maxLinks: number
	): Promise<RemLinkCandidate[]> {
		const settings = this.getSettings().rem;

		// Gather vault note titles (excluding self and already-matched)
		const noteTitles: { path: string; title: string }[] = [];
		for (const file of getIncludedMarkdownFiles(this.app, 'rem', this.getSettings())) {
			if (file.path === sourceFile.path) continue;
			if (existingMatches.has(file.path)) continue;
			noteTitles.push({ path: file.path, title: file.basename });
		}

		if (noteTitles.length === 0) return [];

		// Truncate content to avoid token limits
		const truncatedContent = content.slice(0, 4000);
		const titleList = noteTitles.map(n => n.title).join('\n');

		const systemPrompt =
			'You are a knowledge graph assistant. Given a note\'s content and a list of ' +
			'other note titles in the vault, identify which titles are conceptually related ' +
			'to topics discussed in the note content. Only suggest strong conceptual matches, ' +
			'not tangential ones.';

		const userPrompt =
			`Note content:\n---\n${truncatedContent}\n---\n\n` +
			`Vault note titles:\n${titleList}\n\n` +
			'Respond with a JSON array of objects, each with:\n' +
			'- "title": the exact note title from the list\n' +
			'- "matchedConcept": the phrase or concept in the note content that relates to this title\n' +
			'- "confidence": a number 0-1 indicating how strong the conceptual match is\n\n' +
			'Only include matches with confidence >= 0.5. Return an empty array if no strong matches exist.\n' +
			'Respond ONLY with the JSON array, no other text.';

		let rawResponse: string;
		try {
			rawResponse = await this.aiClient.complete(userPrompt, systemPrompt);
		} catch (error) {
			console.warn('[Synapse REM] Semantic matching failed:', error);
			return [];
		}

		// Parse AI response
		let parsed: SemanticMatch[];
		try {
			// Strip code fences if present
			const cleaned = rawResponse.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
			const raw = parseJson(cleaned);
			if (!Array.isArray(raw)) return [];
			// Narrow each element from `unknown` — drop any item that lacks the
			// expected fields rather than letting it crash the loop below.
			parsed = raw.filter(isSemanticMatch);
		} catch {
			console.warn('[Synapse REM] Failed to parse semantic match response');
			return [];
		}

		// Build candidates by locating matched concepts in the text
		const candidates: RemLinkCandidate[] = [];
		const lines = content.split('\n');

		for (const item of parsed) {
			if (item.confidence < settings.confidenceThreshold) continue;

			// Find the target note
			const target = noteTitles.find(n => n.title === item.title);
			if (!target) continue;

			// Locate the matched concept in the text
			const occurrences = this.findConcept(item.matchedConcept, lines);

			candidates.push({
				targetPath: target.path,
				targetDisplayName: target.title,
				matchedText: item.matchedConcept,
				matchType: 'semantic',
				occurrences,
				confidence: item.confidence,
			});
		}

		// Sort by confidence descending
		candidates.sort((a, b) => b.confidence - a.confidence);

		return candidates.slice(0, maxLinks);
	}

	/**
	 * Find occurrences of a concept phrase in the note lines.
	 * Case-insensitive search.
	 */
	private findConcept(concept: string, lines: string[]): RemOccurrence[] {
		const occurrences: RemOccurrence[] = [];
		const conceptLower = concept.toLowerCase();

		for (let i = 0; i < lines.length; i++) {
			const lineLower = lines[i].toLowerCase();
			let searchFrom = 0;

			while (searchFrom <= lineLower.length - conceptLower.length) {
				const idx = lineLower.indexOf(conceptLower, searchFrom);
				if (idx === -1) break;

				occurrences.push({
					lineNumber: i,
					lineText: lines[i],
					startOffset: idx,
					endOffset: idx + conceptLower.length,
				});

				searchFrom = idx + conceptLower.length;
			}
		}

		return occurrences;
	}
}
