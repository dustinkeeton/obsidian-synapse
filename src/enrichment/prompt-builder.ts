import { SynapseSettings } from '../settings';
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
import type { AIRequestOptions, ChoiceAnswer, ChoiceQuestion, DecisionRequestOptions } from '../shared';
import { ExternalLinkCandidate, FrontmatterEnrichment, FrontmatterValueIndex } from './types';

/** Allowlisted frontmatter key pattern: lowercase alphanumeric, hyphens, underscores. Rejects __proto__, constructor, etc. */
const SAFE_FM_KEY = /^[a-z][a-z0-9_-]{0,49}$/;

/** Dangerous prototype-pollution keys that must never appear as frontmatter keys. */
const FORBIDDEN_FM_KEYS = new Set([
	'__proto__',
	'constructor',
	'prototype',
	'toString',
	'valueOf',
	'hasOwnProperty',
]);

/** Keys the System 1 lane may fill from existing vault values; `list` keys merge, `scalar` keys add. */
const LANE_FM_KEYS: Record<string, 'scalar' | 'list'> = {
	category: 'scalar',
	type: 'scalar',
	status: 'scalar',
	topics: 'list',
	'related-projects': 'list',
};
/** Filtered out of collected vault values so the option stays unambiguous. */
const NEW_VALUE_OPTION = '<new-value>';
const STATE_MAX_CHARS = 3000;

/** Validate that an AI-suggested URL is safe for inclusion in a note. */
function isValidExternalUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}

/**
 * Builds and executes AI prompts for enrichment suggestions
 * that require generative intelligence (external links, frontmatter attributes).
 *
 * Tags and internal links are handled by deterministic scorers;
 * this module handles the parts where AI judgment is needed.
 */
export class PromptBuilder {
	private aiClient: AIClient;
	private decisionClient: DecisionClient;

	constructor(private getSettings: () => SynapseSettings) {
		this.aiClient = new AIClient(getSettings);
		this.decisionClient = new DecisionClient(getSettings);
	}

	/**
	 * Ask AI for external reference links. Stingy — only suggest
	 * for verifiable claims, technical terms, or citations.
	 */
	async suggestExternalLinks(
		noteContent: string,
		existingLinks: string[],
		aiOpts?: AIRequestOptions
	): Promise<ExternalLinkCandidate[]> {
		const maxLinks = this.getSettings().enrichment.maxExternalLinks;
		if (maxLinks === 0) return [];

		const truncated = noteContent.slice(0, 3000);

		const prompt = `Analyze this note and suggest external reference links.

## Note Content
${truncated}

## Existing External Links
${existingLinks.length > 0 ? existingLinks.join('\n') : '(none)'}

## Instructions
- Only suggest external links for verifiable factual claims, technical terms, or concepts that warrant sourcing.
- Prefer authoritative sources: official documentation, academic papers, Wikipedia, MDN, etc.
- If the note is opinion, personal reflection, or creative writing, suggest ZERO links.
- Maximum ${maxLinks} links.
- Do NOT duplicate existing links.
- Return ONLY a JSON array of objects: [{"url": "...", "title": "...", "reason": "..."}]
- If no links are warranted, return an empty array: []`;

		const systemPrompt =
			'You are a research assistant. Return only valid JSON. Be conservative — only suggest links you are confident about. If uncertain, return an empty array.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt, aiOpts);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = parseJson(cleaned);
			if (Array.isArray(parsed)) {
				return parsed
					.filter(
						(item: unknown): item is ExternalLinkCandidate =>
							isRecord(item) &&
							typeof item.url === 'string' &&
							typeof item.title === 'string' &&
							typeof item.reason === 'string' &&
							isValidExternalUrl(item.url)
					)
					.map(item => ({
						...item,
						// Strip markdown/HTML from title and reason to prevent injection
						title: item.title.replace(/[[\](){}|<>]/g, ''),
						reason: item.reason.replace(/[[\](){}|<>]/g, ''),
					}))
					.slice(0, maxLinks);
			}
		} catch {
			// Fall back to empty if AI fails
		}
		return [];
	}

	/** Lane first for keys with vault values (#563); undecided keys reach the generative prompt restricted to them; lane off/error/no values = full prompt. */
	async suggestFrontmatter(
		noteContent: string,
		existingFrontmatter: Record<string, unknown>,
		aiOpts?: DecisionRequestOptions,
		vaultValues?: (keys: readonly string[]) => FrontmatterValueIndex
	): Promise<FrontmatterEnrichment[]> {
		const existingKeys = Object.keys(existingFrontmatter);
		if (!vaultValues || !this.decisionClient.isEnabled()) {
			return this.suggestFrontmatterFromAI(noteContent, existingKeys, aiOpts);
		}
		const laneKeys = Object.keys(LANE_FM_KEYS).filter(key => isAllowedFrontmatterKey(key, existingKeys));
		const lane = await this.suggestFrontmatterWithSystemOne(
			noteContent, existingFrontmatter, vaultValues(laneKeys), aiOpts
		);
		if (!lane.answered) return this.suggestFrontmatterFromAI(noteContent, existingKeys, aiOpts);
		if (lane.decidedKeys.size > 0) aiOpts?.onSystemOne?.();
		const pending = laneKeys.filter(key => !lane.decidedKeys.has(key));
		if (pending.length === 0) return lane.suggestions;
		const generated = await this.suggestFrontmatterFromAI(noteContent, existingKeys, aiOpts, pending);
		return [...lane.suggestions, ...generated];
	}

	/** One `choice` per lane key over its existing vault values plus `<new-value>`; the lane never invents a value. */
	private async suggestFrontmatterWithSystemOne(
		noteContent: string,
		existingFrontmatter: Record<string, unknown>,
		index: FrontmatterValueIndex,
		aiOpts?: DecisionRequestOptions
	): Promise<{ suggestions: FrontmatterEnrichment[]; decidedKeys: Set<string>; answered: boolean }> {
		const floor = this.getSettings().ai.systemOne.confidenceFloor;
		const questions: Record<string, ChoiceQuestion> = {};
		for (const [key, values] of index) {
			const options = values.filter(value => value !== NEW_VALUE_OPTION).slice(0, MAX_CHOICE_OPTIONS - 1);
			if (options.length === 0) continue;
			// Null prototype: vault values such as `__proto__` or `toString` must stay plain options.
			const criteria = Object.create(null) as Record<string, string | null>;
			for (const option of options) criteria[option] = null;
			criteria[NEW_VALUE_OPTION] = 'None of the existing values describes this note.';
			questions[key] = choice(`Which "${key}" frontmatter value describes this note?`, criteria);
		}
		const none = { suggestions: [], decidedKeys: new Set<string>(), answered: false };
		if (Object.keys(questions).length === 0) return none;

		const state =
			`Note content:\n${noteContent.slice(0, STATE_MAX_CHARS)}\n\n` +
			`Current frontmatter: ${JSON.stringify(existingFrontmatter)}`;

		let answers: Record<string, ChoiceAnswer>;
		try {
			({ answers } = await this.decisionClient.decide(state, questions, aiOpts));
		} catch (error) {
			console.warn('[Synapse Enrichment] System 1 frontmatter suggestion failed; using the generative path:', redactError(error));
			return none;
		}

		const { confident } = partitionByConfidence(answers, floor, (a) => a.confidence);
		const suggestions: FrontmatterEnrichment[] = [];
		const decidedKeys = new Set<string>();
		for (const key of Object.keys(questions)) {
			const answer = Object.prototype.hasOwnProperty.call(confident, key) ? confident[key] : undefined;
			if (!answer || answer.choice === NEW_VALUE_OPTION || !(answer.choice in questions[key].criteria)) continue;
			decidedKeys.add(key);
			if (LANE_FM_KEYS[key] === 'list') {
				const extra = Object.entries(answer.probabilities)
					.filter(([option, p]) => option !== answer.choice && option !== NEW_VALUE_OPTION && p >= floor && option in questions[key].criteria)
					.map(([option]) => option);
				suggestions.push({ key, value: [answer.choice, ...extra], action: 'merge' });
			} else {
				suggestions.push({ key, value: answer.choice, action: 'add' });
			}
		}
		const existingKeys = Object.keys(existingFrontmatter);
		return {
			suggestions: suggestions.filter(item => isAllowedFrontmatterKey(item.key, existingKeys)),
			decidedKeys,
			answered: true,
		};
	}

	private async suggestFrontmatterFromAI(
		noteContent: string,
		existingKeys: string[],
		aiOpts?: AIRequestOptions,
		onlyKeys?: string[]
	): Promise<FrontmatterEnrichment[]> {
		const truncated = noteContent.slice(0, 3000);
		const keyRule = onlyKeys
			? `- Suggest values ONLY for these keys: ${onlyKeys.join(', ')}.`
			: '- Suggest useful metadata fields like: category, type, status, topics, created, related-projects.';

		const prompt = `Analyze this note and suggest frontmatter metadata attributes.

## Note Content
${truncated}

## Existing Frontmatter Keys
${existingKeys.length > 0 ? existingKeys.join(', ') : '(none)'}

## Instructions
${keyRule}
- Do NOT suggest 'tags' (handled separately) or keys that already exist.
- Only suggest attributes clearly derivable from the content.
- Return ONLY a JSON array: [{"key": "...", "value": "...", "action": "add"}]
- Keep values concise. Arrays should use action "merge", scalars use "add".
- Maximum 5 attributes. If nothing useful, return [].`;

		const systemPrompt =
			'You are a metadata organization assistant. Return only valid JSON. Be conservative.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt, aiOpts);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = parseJson(cleaned);
			if (Array.isArray(parsed)) {
				return parsed
					.filter(
						(item: unknown): item is FrontmatterEnrichment =>
							isRecord(item) &&
							typeof item.key === 'string' &&
							item.value !== undefined &&
							(item.action === 'add' || item.action === 'merge')
					)
					.filter(item =>
						isAllowedFrontmatterKey(item.key, existingKeys) &&
						(!onlyKeys || onlyKeys.includes(item.key))
					);
			}
		} catch {
			// Fall back to empty
		}
		return [];
	}
}

function isAllowedFrontmatterKey(key: string, existingKeys: string[]): boolean {
	return !existingKeys.includes(key) &&
		key !== 'tags' &&
		SAFE_FM_KEY.test(key) &&
		!FORBIDDEN_FM_KEYS.has(key);
}
