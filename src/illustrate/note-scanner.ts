import { CALLOUT_TYPES, hasCallout, wordCount } from '../shared';

export const MIN_WORDS_TO_ILLUSTRATE = 80;

export function hasIllustrations(content: string): boolean {
	return hasCallout(content, CALLOUT_TYPES.illustrate);
}

/** Batch eligibility: enough prose to illustrate and no Synapse illustrations yet. */
export function isEligibleNote(content: string): boolean {
	return wordCount(content) >= MIN_WORDS_TO_ILLUSTRATE && !hasIllustrations(content);
}
