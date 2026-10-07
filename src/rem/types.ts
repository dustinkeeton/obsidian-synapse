import type { DecisionLane } from '../shared';

/** A single occurrence of a matched term in the source note. */
export interface RemOccurrence {
	/** Zero-based line number in the source note */
	lineNumber: number;
	/** Full text of the line containing the match */
	lineText: string;
	/** Start offset within the line */
	startOffset: number;
	/** End offset within the line (exclusive) */
	endOffset: number;
}

/** How the match was discovered. */
export type RemMatchType = 'title' | 'alias' | 'semantic';

/** A single link candidate grouping all occurrences of the same target note. */
export interface RemLinkCandidate {
	/** Path to the target note in the vault */
	targetPath: string;
	/** Display name for the target note (basename without extension) */
	targetDisplayName: string;
	/** The text in the source note that was matched */
	matchedText: string;
	/** How the match was found */
	matchType: RemMatchType;
	/** All positions where this match appears */
	occurrences: RemOccurrence[];
	/**
	 * Match confidence (0-1). Literal title/alias matches start at a raw 1.0 and
	 * are down-weighted by `titleMatchWeight` when ranked; semantic matches are
	 * AI-assigned.
	 */
	confidence: number;
	/** Which lane produced a semantic match; absent on literal matches. */
	lane?: DecisionLane;
}

export type RemProposalStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected';

/** A proposal to insert wikilinks into a single source note. */
export interface RemProposal {
	id: string;
	sourceNotePath: string;
	createdAt: string;
	candidates: RemLinkCandidate[];
	status: RemProposalStatus;
	/** Which lane produced the semantic candidates, when any. */
	lane?: DecisionLane;
	/** Which candidate matchedTexts were accepted (set on accept). */
	acceptedLinks?: string[];
	/** Snapshot of the note content before links were applied (set on accept for undo). */
	originalContent?: string;
}

export interface RemSettings {
	enabled: boolean;
	/**
	 * Weight applied to literal title/alias matches (0-1) so a title coincidence
	 * cannot automatically outrank a genuinely content-relevant semantic link.
	 */
	titleMatchWeight: number;
	/** Minimum relevance (0-1) a semantic link needs to be proposed, in either lane. */
	confidenceThreshold: number;
	/** Maximum link candidates per scanned note. */
	maxLinksPerNote: number;
	/** Storage folder for REM proposals. */
	remFolderPath: string;
}
