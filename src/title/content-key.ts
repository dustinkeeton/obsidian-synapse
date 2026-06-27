import { normalizePath } from 'obsidian';
import { contentKey, hashString } from '../shared';
import { SynapseSettings } from '../settings';
import { TitleProposalTrigger } from './types';

/**
 * Compute the deterministic content key for a title proposal from its inputs
 * (#408). Mirrors `proposalContentKey` in elaboration/proposer.ts.
 *
 * Keying on the *inputs* (note path + content hash + current title + trigger +
 * the AI settings that shape the request) rather than the model's *output* is
 * what makes re-scanning an unchanged note idempotent: temperature > 0 sampling
 * would otherwise yield a different proposed title — and thus a different key —
 * every run, defeating the reject-loop guard.
 *
 * The key lets the proposal-time dedup guard skip re-proposing the SAME title
 * for UNCHANGED content after a reject. Editing the note changes the content
 * hash, which changes the key, so a fresh proposal is still allowed.
 */
export function titleContentKey(
	notePath: string,
	content: string,
	currentTitle: string,
	trigger: TitleProposalTrigger,
	settings: SynapseSettings,
): string {
	return contentKey([
		normalizePath(notePath),
		hashString(content),
		currentTitle,
		trigger,
		settings.ai.provider,
		settings.ai.model,
		String(settings.ai.temperature),
		String(settings.ai.maxTokens),
	]);
}
