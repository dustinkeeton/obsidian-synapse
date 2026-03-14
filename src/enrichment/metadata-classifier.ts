import { AutoNotesSettings, TagVocabularyEntry } from '../settings';
import { AIClient, sanitizeAIResponse } from '../shared';
import { TagCandidate } from './types';

const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_/\-]{0,49}$/;

/**
 * Classifies notes using a user-defined metadata tag vocabulary.
 * Replaces the topic-based TagScorer — tags are now rare, purposeful
 * metadata classifiers (status, type, source) rather than topic labels.
 */
export class MetadataClassifier {
	private aiClient: AIClient;

	constructor(private getSettings: () => AutoNotesSettings) {
		this.aiClient = new AIClient(getSettings);
	}

	async classify(
		noteContent: string,
		existingTags: string[]
	): Promise<TagCandidate[]> {
		const settings = this.getSettings().enrichment;
		const vocabulary = settings.tagVocabulary;

		if (vocabulary.length === 0) return [];

		const aiResults = await this.getClassificationsFromAI(
			noteContent,
			vocabulary,
			existingTags
		);

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

	private async getClassificationsFromAI(
		noteContent: string,
		vocabulary: TagVocabularyEntry[],
		existingTags: string[]
	): Promise<Array<{ tag: string; confidence: number }>> {
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
			const response = await this.aiClient.complete(prompt, systemPrompt);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = JSON.parse(cleaned);
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item): item is { tag: string; confidence: number } =>
						typeof item === 'object' &&
						item !== null &&
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
