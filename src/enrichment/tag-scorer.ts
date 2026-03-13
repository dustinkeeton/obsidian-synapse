import { AutoNotesSettings } from '../settings';
import { AIClient, sanitizeAIResponse } from '../shared';
import { TagCandidate, WeightConfig } from './types';
import { VaultAnalyzer } from './vault-analyzer';
import { computeProximityWeight } from './weight-calculator';

/**
 * Ranks candidate tags for a note using vault context and folder proximity.
 *
 * Process:
 * 1. Ask AI for candidate tags given note content (constrained to vault tags + up to 3 novel).
 * 2. Look up each candidate's frequency in the vault-wide tag index.
 * 3. For each file that uses the tag, compute proximity weight to the source note.
 * 4. Final score = SUM(proximityWeights) × log₂(1 + globalFrequency).
 * 5. Return top N sorted descending.
 */
export class TagScorer {
	private aiClient: AIClient;

	constructor(
		private analyzer: VaultAnalyzer,
		private getSettings: () => AutoNotesSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	async scoreTags(
		noteContent: string,
		notePath: string,
		existingTags: string[]
	): Promise<TagCandidate[]> {
		const settings = this.getSettings().enrichment;
		const weights = settings.weights;
		const tagIndex = this.analyzer.buildTagIndex();

		// Get vault tags for context
		const vaultTags = [...tagIndex.tags.keys()].slice(0, 200);

		// Ask AI for candidate tags
		const candidates = await this.getCandidatesFromAI(
			noteContent,
			vaultTags,
			existingTags
		);

		// Score each candidate
		const scored: TagCandidate[] = [];

		for (const tag of candidates) {
			const normalized = tag.toLowerCase().startsWith('#')
				? tag.toLowerCase()
				: `#${tag.toLowerCase()}`;

			// Skip tags the note already has
			if (existingTags.includes(normalized)) continue;

			const entry = tagIndex.tags.get(normalized);
			const rawScore = entry?.count ?? 0;
			const sources = entry?.files ?? [];

			const weightedScore = this.computeTagScore(
				notePath,
				sources,
				rawScore,
				weights
			);

			scored.push({
				tag: normalized,
				rawScore,
				weightedScore,
				sources,
			});
		}

		// Sort by weighted score descending, take top N
		scored.sort((a, b) => b.weightedScore - a.weightedScore);
		return scored.slice(0, settings.maxTags);
	}

	private computeTagScore(
		notePath: string,
		sources: string[],
		rawFrequency: number,
		weights: WeightConfig
	): number {
		let proximitySum = 0;
		for (const sourcePath of sources) {
			proximitySum += computeProximityWeight(notePath, sourcePath, weights);
		}
		// Log-dampened frequency so globally popular tags don't dominate
		return proximitySum * Math.log2(1 + rawFrequency);
	}

	private async getCandidatesFromAI(
		noteContent: string,
		vaultTags: string[],
		existingTags: string[]
	): Promise<string[]> {
		const truncatedContent = noteContent.slice(0, 3000);
		const tagList = vaultTags.slice(0, 100).join(', ');

		const prompt = `Analyze this note and suggest relevant tags.

## Note Content
${truncatedContent}

## Existing Tags on This Note
${existingTags.length > 0 ? existingTags.join(', ') : '(none)'}

## Tags Used Elsewhere in the Vault
${tagList}

## Instructions
- Prefer tags that already exist in the vault (listed above).
- You may suggest up to 3 novel tags if they are clearly appropriate.
- Return ONLY a JSON array of tag strings (without the # prefix).
- Example: ["machine-learning", "python", "data-pipeline"]
- Do NOT include tags already on this note.
- Keep tags concise (1-3 words, kebab-case).`;

		const systemPrompt =
			'You are a note organization assistant. Return only valid JSON arrays of tag strings. No explanations.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = JSON.parse(cleaned);
			if (Array.isArray(parsed)) {
				// Validate: tags must be short, alphanumeric/kebab-case strings only
				const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/;
				return parsed.filter(
					(t): t is string =>
						typeof t === 'string' && TAG_PATTERN.test(t)
				);
			}
		} catch {
			// If AI fails or returns invalid JSON, fall back to empty
		}
		return [];
	}
}
