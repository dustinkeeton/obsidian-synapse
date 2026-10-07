import { SynapseSettings, TagVocabularyEntry } from '../settings';
import {
	AIClient,
	DecisionClient,
	MAX_CHOICE_OPTIONS,
	choice,
	isRecord,
	parseJson,
	partitionByConfidence,
	redactError,
	sanitizeAIResponse,
} from '../shared';
import type { ChoiceQuestion, DecisionRequestOptions } from '../shared';
import { TagCandidate } from './types';

const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,49}$/;
/** Choice option for "no tag in this category"; `<` can never appear in a vocabulary tag. */
const NO_TAG_OPTION = '<none>';
const STATE_MAX_CHARS = 3000;

interface RawClassification {
	tag: string;
	confidence: number;
}

interface SystemOneClassification {
	results: RawClassification[];
	/** Categories the lane could not settle; they go to the generative prompt. */
	unresolved: TagVocabularyEntry[];
	decided: boolean;
}

/**
 * Classifies notes using a user-defined metadata tag vocabulary.
 * Replaces the topic-based TagScorer — tags are now rare, purposeful
 * metadata classifiers (status, type, source) rather than topic labels.
 */
export class MetadataClassifier {
	private aiClient: AIClient;
	private decisionClient: DecisionClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.aiClient = new AIClient(getSettings);
		this.decisionClient = new DecisionClient(getSettings);
	}

	async classify(
		noteContent: string,
		existingTags: string[],
		aiOpts?: DecisionRequestOptions
	): Promise<TagCandidate[]> {
		const settings = this.getSettings().enrichment;
		const vocabulary = settings.tagVocabulary;

		if (vocabulary.length === 0) return [];

		const aiResults: RawClassification[] = [];
		let pending = vocabulary;
		if (this.decisionClient.isEnabled()) {
			const lane = await this.classifyWithSystemOne(noteContent, vocabulary, existingTags, aiOpts);
			aiResults.push(...lane.results);
			pending = lane.unresolved;
			if (lane.decided) aiOpts?.onSystemOne?.();
		}
		if (pending.length > 0) {
			aiResults.push(...await this.getClassificationsFromAI(noteContent, pending, existingTags, aiOpts));
		}

		// Validate against vocabulary — reject any hallucinated tags
		const validTags = this.buildVocabularyLookup(vocabulary);
		const candidates: TagCandidate[] = [];

		for (const result of aiResults) {
			const normalized = result.tag.toLowerCase().startsWith('#')
				? result.tag.toLowerCase().slice(1)
				: result.tag.toLowerCase();

			// Skip tags the note already has
			if (existingTags.some(t => t.replace(/^#/, '').toLowerCase() === normalized)) {
				continue;
			}

			const entry = validTags.get(normalized);
			if (!entry) continue; // Hallucinated — not in vocabulary

			if (!TAG_PATTERN.test(normalized)) continue;

			candidates.push({
				tag: `#${normalized}`,
				category: entry.category,
				confidence: result.confidence,
				rawScore: 0,
				weightedScore: result.confidence,
				sources: [],
			});
		}

		candidates.sort((a, b) => b.confidence - a.confidence);
		return candidates.slice(0, settings.maxTags);
	}

	private buildVocabularyLookup(
		vocabulary: TagVocabularyEntry[]
	): Map<string, { category: string }> {
		const lookup = new Map<string, { category: string }>();
		for (const entry of vocabulary) {
			for (const tag of entry.tags) {
				lookup.set(tag.toLowerCase(), { category: entry.category });
			}
		}
		return lookup;
	}

	/** One `choice` per category over its tags plus "none"; secondary tags surface only at or above the floor. */
	private async classifyWithSystemOne(
		noteContent: string,
		vocabulary: TagVocabularyEntry[],
		existingTags: string[],
		aiOpts?: DecisionRequestOptions
	): Promise<SystemOneClassification> {
		const floor = this.getSettings().ai.systemOne.confidenceFloor;
		const questions: Record<string, ChoiceQuestion> = {};
		const byId = new Map<string, TagVocabularyEntry>();
		const unresolved: TagVocabularyEntry[] = [];

		vocabulary.forEach((entry, index) => {
			if (entry.tags.length === 0 || entry.tags.length >= MAX_CHOICE_OPTIONS) {
				unresolved.push(entry);
				return;
			}
			const id = `c${index}`;
			byId.set(id, entry);
			const criteria: Record<string, string | null> = {};
			for (const tag of entry.tags) criteria[tag] = null;
			criteria[NO_TAG_OPTION] = 'No tag in this category applies to this note.';
			questions[id] = choice(
				`Which "${entry.category}" tag describes this note? ${entry.description}`.trim(),
				criteria
			);
		});

		if (Object.keys(questions).length === 0) {
			return { results: [], unresolved, decided: false };
		}

		const state =
			`Note content:\n${noteContent.slice(0, STATE_MAX_CHARS)}\n\n` +
			`Existing tags on this note: ${existingTags.length > 0 ? existingTags.join(', ') : '(none)'}`;

		let answers: Record<string, { choice: string; probabilities: Record<string, number>; confidence: number }>;
		try {
			({ answers } = await this.decisionClient.decide(state, questions, aiOpts));
		} catch (error) {
			console.warn('[Synapse Enrichment] System 1 tag classification failed; using the generative path:', redactError(error));
			return { results: [], unresolved: vocabulary, decided: false };
		}

		const { confident, uncertain } = partitionByConfidence(answers, floor, (a) => a.confidence);
		for (const id of uncertain) {
			const entry = byId.get(id);
			if (entry) unresolved.push(entry);
		}

		const results: RawClassification[] = [];
		for (const answer of Object.values(confident)) {
			if (answer.choice !== NO_TAG_OPTION) {
				results.push({ tag: answer.choice, confidence: answer.confidence });
			}
			for (const [option, probability] of Object.entries(answer.probabilities)) {
				if (option !== answer.choice && option !== NO_TAG_OPTION && probability >= floor) {
					results.push({ tag: option, confidence: probability });
				}
			}
		}
		return { results, unresolved, decided: Object.keys(confident).length > 0 };
	}

	private async getClassificationsFromAI(
		noteContent: string,
		vocabulary: TagVocabularyEntry[],
		existingTags: string[],
		aiOpts?: DecisionRequestOptions
	): Promise<RawClassification[]> {
		const truncatedContent = noteContent.slice(0, 3000);

		const vocabDescription = vocabulary
			.map(v => `${v.category}: ${v.tags.join(', ')} — ${v.description}`)
			.join('\n');

		const prompt = `Classify this note using ONLY tags from the vocabulary below.

## Note Content
${truncatedContent}

## Existing Tags on This Note
${existingTags.length > 0 ? existingTags.join(', ') : '(none)'}

## Tag Vocabulary
${vocabDescription}

## Instructions
- Select tags that accurately describe this note's metadata.
- ONLY use tags listed in the vocabulary above. Do NOT invent new tags.
- For each tag, provide a confidence score (0.0-1.0) indicating how well it fits.
- Do NOT include tags already on this note.
- Return a JSON array of objects: [{"tag": "draft", "confidence": 0.9}]`;

		const systemPrompt =
			'You are a note classifier. Return only valid JSON arrays. No explanations. Only use tags from the provided vocabulary.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt, aiOpts);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = parseJson(cleaned);
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item: unknown): item is RawClassification =>
						isRecord(item) &&
						typeof item.tag === 'string' &&
						typeof item.confidence === 'number' &&
						item.confidence >= 0 &&
						item.confidence <= 1
				);
			}
		} catch {
			// If AI fails or returns invalid JSON, fall back to empty
		}
		return [];
	}
}
