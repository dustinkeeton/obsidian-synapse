import { ElixrSettings, ResolvedExpertise } from './types';

/**
 * Resolve a note's content against the user's expertise profile.
 *
 * Strategy: case-insensitive substring match of each user-defined topic
 * against the note content. If multiple topics match, return the one whose
 * topic string appears earliest in the content (most prominent). If none
 * match, fall back to the configured default level.
 */
export function resolveExpertise(
	noteContent: string,
	settings: ElixrSettings
): ResolvedExpertise {
	if (!settings.enabled || settings.entries.length === 0) {
		return { topic: null, level: settings.defaultLevel };
	}

	const lowerContent = noteContent.toLowerCase();

	let bestMatch: { topic: string; level: ResolvedExpertise['level']; position: number } | null = null;

	for (const entry of settings.entries) {
		const needle = entry.topic.toLowerCase().trim();
		if (needle.length === 0) continue;

		const position = lowerContent.indexOf(needle);
		if (position === -1) continue;

		if (bestMatch === null || position < bestMatch.position) {
			bestMatch = { topic: entry.topic, level: entry.level, position };
		}
	}

	if (bestMatch) {
		return { topic: bestMatch.topic, level: bestMatch.level };
	}

	return { topic: null, level: settings.defaultLevel };
}
