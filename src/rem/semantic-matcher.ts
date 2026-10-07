import type { App, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { RemLinkCandidate, RemOccurrence } from './types';
import { AIClient, DecisionClient, isRecord, parseJson, getIncludedMarkdownFiles, redactError, score } from '../shared';
import type { DecisionRequestOptions, ScoreAnswer, ScoreQuestion } from '../shared';

/** One conceptual match the AI is expected to return, after validation. */
interface SemanticMatch {
	title: string;
	matchedConcept: string;
	confidence: number;
}

interface NoteTitle {
	path: string;
	title: string;
}

/** Ordered rubric for the System 1 relevance score; indexes 2-3 count as "related". */
export const RELEVANCE_LEVELS = [
	'Unrelated: the note shares no topic with the text',
	'Tangential: the text only mentions the note\'s topic in passing',
	'Related: the text discusses the topic the note covers',
	'Strongly related: the note\'s topic is central to the text',
];
const RELATED_LEVEL_INDEXES = ['2', '3'];
const CONTENT_MAX_CHARS = 4000;

/** 0-1 relevance from a score distribution: the probability the title is at least "related". */
export function relevanceFromScore(answer: ScoreAnswer): number {
	return RELATED_LEVEL_INDEXES.reduce((sum, level) => sum + (answer.probabilities[level] ?? 0), 0);
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
	private decisionClient: DecisionClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
		this.decisionClient = new DecisionClient(getSettings);
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
		maxLinks: number,
		aiOpts?: DecisionRequestOptions
	): Promise<RemLinkCandidate[]> {
		const settings = this.getSettings().rem;

		// Gather vault note titles (excluding self and already-matched)
		const allTitles: NoteTitle[] = [];
		for (const file of getIncludedMarkdownFiles(this.app, 'rem', this.getSettings())) {
			if (file.path === sourceFile.path) continue;
			if (existingMatches.has(file.path)) continue;
			allTitles.push({ path: file.path, title: file.basename });
		}

		if (allTitles.length === 0) return [];

		// Truncate content to avoid token limits
		const truncatedContent = content.slice(0, CONTENT_MAX_CHARS);

		// System 1 lane (#558): score every title first; only titles that clear the
		// threshold reach the generative prompt, which then just locates the concept.
		let noteTitles = allTitles;
		let laneRelevance: Map<string, number> | null = null;
		if (this.decisionClient.isEnabled()) {
			laneRelevance = await this.scoreTitles(truncatedContent, allTitles, aiOpts);
			if (laneRelevance) {
				aiOpts?.onSystemOne?.();
				const relevance = laneRelevance;
				noteTitles = allTitles.filter(n => (relevance.get(n.path) ?? 0) >= settings.confidenceThreshold);
				if (noteTitles.length === 0) return [];
			}
		}

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
			rawResponse = await this.aiClient.complete(userPrompt, systemPrompt, aiOpts);
		} catch (error) {
			console.warn('[Synapse REM] Semantic matching failed:', redactError(error));
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
			// Find the target note
			const target = noteTitles.find(n => n.title === item.title);
			if (!target) continue;

			// Lane relevance is calibrated; the model's self-reported confidence is used only without the lane.
			const confidence = laneRelevance?.get(target.path) ?? item.confidence;
			if (confidence < settings.confidenceThreshold) continue;

			// Locate the matched concept in the text
			const occurrences = this.findConcept(item.matchedConcept, lines);

			candidates.push({
				targetPath: target.path,
				targetDisplayName: target.title,
				matchedText: item.matchedConcept,
				matchType: 'semantic',
				occurrences,
				confidence,
			});
		}

		// Sort by confidence descending
		candidates.sort((a, b) => b.confidence - a.confidence);

		return candidates.slice(0, maxLinks);
	}

	/** One `score` per title over {@link RELEVANCE_LEVELS}; `null` on any lane error so the caller runs the generative path. */
	private async scoreTitles(
		content: string,
		noteTitles: NoteTitle[],
		aiOpts?: DecisionRequestOptions
	): Promise<Map<string, number> | null> {
		const questions: Record<string, ScoreQuestion> = {};
		noteTitles.forEach((note, index) => {
			questions[`t${index}`] = score(
				`How related is the note titled "${note.title}" to the topics discussed in the text?`,
				RELEVANCE_LEVELS
			);
		});
		try {
			const { answers } = await this.decisionClient.decide(content, questions, aiOpts);
			const relevance = new Map<string, number>();
			noteTitles.forEach((note, index) => {
				relevance.set(note.path, relevanceFromScore(answers[`t${index}`]));
			});
			return relevance;
		} catch (error) {
			console.warn('[Synapse REM] System 1 title scoring failed; using the generative path:', redactError(error));
			return null;
		}
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
