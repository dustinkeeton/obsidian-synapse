import { AutoNotesSettings } from '../settings';
import { AIClient, sanitizeAIResponse } from '../shared';
import { ExternalLinkCandidate, FrontmatterEnrichment } from './types';

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

	constructor(private getSettings: () => AutoNotesSettings) {
		this.aiClient = new AIClient(getSettings);
	}

	/**
	 * Ask AI for external reference links. Stingy — only suggest
	 * for verifiable claims, technical terms, or citations.
	 */
	async suggestExternalLinks(
		noteContent: string,
		existingLinks: string[]
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
			const response = await this.aiClient.complete(prompt, systemPrompt);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = JSON.parse(cleaned);
			if (Array.isArray(parsed)) {
				return parsed
					.filter(
						(item): item is ExternalLinkCandidate =>
							typeof item === 'object' &&
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

	/**
	 * Ask AI for frontmatter attribute suggestions (e.g., category, status, type).
	 */
	async suggestFrontmatter(
		noteContent: string,
		existingFrontmatter: Record<string, unknown>
	): Promise<FrontmatterEnrichment[]> {
		const truncated = noteContent.slice(0, 3000);
		const existingKeys = Object.keys(existingFrontmatter);

		const prompt = `Analyze this note and suggest frontmatter metadata attributes.

## Note Content
${truncated}

## Existing Frontmatter Keys
${existingKeys.length > 0 ? existingKeys.join(', ') : '(none)'}

## Instructions
- Suggest useful metadata fields like: category, type, status, topics, created, related-projects.
- Do NOT suggest 'tags' (handled separately) or keys that already exist.
- Only suggest attributes clearly derivable from the content.
- Return ONLY a JSON array: [{"key": "...", "value": "...", "action": "add"}]
- Keep values concise. Arrays should use action "merge", scalars use "add".
- Maximum 5 attributes. If nothing useful, return [].`;

		const systemPrompt =
			'You are a metadata organization assistant. Return only valid JSON. Be conservative.';

		try {
			const response = await this.aiClient.complete(prompt, systemPrompt);
			const sanitized = sanitizeAIResponse(response);
			const cleaned = sanitized.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
			const parsed = JSON.parse(cleaned);
			if (Array.isArray(parsed)) {
				return parsed
					.filter(
						(item): item is FrontmatterEnrichment =>
							typeof item === 'object' &&
							typeof item.key === 'string' &&
							item.value !== undefined &&
							(item.action === 'add' || item.action === 'merge')
					)
					.filter(item =>
						!existingKeys.includes(item.key) &&
						item.key !== 'tags' &&
						SAFE_FM_KEY.test(item.key) &&
						!FORBIDDEN_FM_KEYS.has(item.key)
					);
			}
		} catch {
			// Fall back to empty
		}
		return [];
	}
}
