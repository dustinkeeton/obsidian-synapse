/**
 * EliXr (Explain Like I'm X) — per-topic expertise levels.
 *
 * Users declare how familiar they are with specific topics.
 * These levels are injected into AI prompts so output matches
 * the user's background.
 */

/** Ordered expertise levels — indices represent increasing mastery. */
export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** A single topic-to-level mapping in the user's expertise profile. */
export interface ExpertiseEntry {
	topic: string;
	level: ExpertiseLevel;
}

/** Persisted alongside plugin settings. */
export interface ElixrSettings {
	/** Whether the EliXr system is active. */
	enabled: boolean;
	/** User-defined topic-level pairs. */
	entries: ExpertiseEntry[];
	/** Level used when no matching topic is found. */
	defaultLevel: ExpertiseLevel;
}

/** Result of resolving a note's content against the expertise profile. */
export interface ResolvedExpertise {
	/** The matched topic (or null if falling back to default). */
	topic: string | null;
	/** The expertise level that applies. */
	level: ExpertiseLevel;
}
