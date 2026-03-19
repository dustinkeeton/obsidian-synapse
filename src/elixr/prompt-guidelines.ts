import { ExpertiseLevel } from './types';

/**
 * Maps each expertise level to concrete prompt-engineering instructions.
 * These paragraphs are injected into system prompts so the AI adapts
 * vocabulary, depth, and assumed prerequisites.
 */
export const LEVEL_GUIDELINES: Record<ExpertiseLevel, string> = {
	beginner: [
		'The reader is a beginner in this topic.',
		'Use simple, everyday language and avoid jargon.',
		'Define any technical terms the first time they appear.',
		'Use analogies to familiar concepts where possible.',
		'Do not assume prior knowledge of the subject.',
		'Prefer concrete examples over abstract theory.',
	].join(' '),

	intermediate: [
		'The reader has intermediate knowledge of this topic.',
		'Use standard terminology but briefly clarify niche terms.',
		'Assume familiarity with foundational concepts but not advanced ones.',
		'Balance explanation with depth — skip basics, but explain non-obvious steps.',
		'Include practical examples alongside conceptual explanations.',
	].join(' '),

	advanced: [
		'The reader has advanced knowledge of this topic.',
		'Use domain-specific terminology freely.',
		'Focus on nuance, edge cases, and deeper implications.',
		'Assume solid foundational understanding — do not re-explain basics.',
		'Include references to related fields or advanced techniques when relevant.',
	].join(' '),

	expert: [
		'The reader is an expert in this topic.',
		'Use precise, technical language without simplification.',
		'Focus on cutting-edge developments, trade-offs, and open questions.',
		'Assume comprehensive domain knowledge.',
		'Prioritize depth, critique, and connections to adjacent research areas.',
	].join(' '),
};

/**
 * Build an EliXr context paragraph to inject into a system prompt.
 * Returns an empty string when EliXr is disabled or no level applies.
 */
export function buildElixrPromptFragment(
	topic: string | null,
	level: ExpertiseLevel
): string {
	const guideline = LEVEL_GUIDELINES[level];
	if (topic) {
		return `\n\n[EliXr — Expertise context for "${topic}"]\n${guideline}`;
	}
	return `\n\n[EliXr — General expertise context]\n${guideline}`;
}
