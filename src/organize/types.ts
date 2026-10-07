/** Topic extracted from a note's content, tags, and links. */
export interface NoteTopic {
	/** Primary topic label (e.g., "machine learning", "meeting notes") */
	label: string;
	/** Confidence score from AI analysis (0-1) */
	confidence: number;
}

/** How the System 1 placement lane answered (#558). */
export type PlacementKind = 'existing' | 'new-directory' | 'undecided';

/** A strict majority of the runoff mass landed on one existing folder. */
export interface ExistingPlacement {
	kind: 'existing';
	directoryPath: string;
	/** Runoff probability (0-1) of the chosen folder */
	confidence: number;
}

/** `<new-directory>` cleared `organize.organizeConfidenceThreshold`. */
export interface NewDirectoryPlacement {
	kind: 'new-directory';
	/** Runoff probability (0-1) of `<new-directory>` */
	confidence: number;
}

/** An existing folder leads the runoff without a majority; System 2 may score folders but not propose a new one. */
export interface UndecidedPlacement {
	kind: 'undecided';
	leading: string;
	/** Runoff probability (0-1) of the leading folder */
	confidence: number;
}

export type Placement = ExistingPlacement | NewDirectoryPlacement | UndecidedPlacement;

/** Result of analyzing a note's content to determine its topical fit. */
export interface ContentAnalysis {
	/** Path of the analyzed note */
	notePath: string;
	/** Extracted topics sorted by confidence; empty when the lane placed the note */
	topics: NoteTopic[];
	/** Existing tags on the note */
	tags: string[];
	/** Existing outgoing link paths */
	links: string[];
	/** System 1 lane answer when the lane ran; `kind: 'existing'` is a direct move in `determineAction` */
	placement?: Placement;
}

/** Score representing how well a note fits a given directory. */
export interface DirectoryScore {
	/** Vault path of the directory */
	directoryPath: string;
	/** Relevance score (0-1, higher = better fit) */
	score: number;
	/** Human-readable explanation */
	reason: string;
}

/** Proposed action for a single note. */
export type OrganizeAction =
	| { type: 'move'; targetDirectory: string }
	| { type: 'propose-new-directory'; targetDirectory: string; reasoning: string };

/** Status of an organize proposal. */
export type OrganizeProposalStatus = 'pending' | 'accepted' | 'rejected';

/** Proposal for creating a new directory and moving a note into it. */
export interface OrganizeProposal {
	id: string;
	/** Path of the note to be moved */
	sourceNotePath: string;
	/** Proposed new directory path */
	proposedDirectory: string;
	/** AI reasoning for the proposed directory */
	reasoning: string;
	/** When the proposal was created */
	createdAt: string;
	/** Current status */
	status: OrganizeProposalStatus;
}

/** Snapshot of a note's original location before an organize move, enabling undo. */
export interface OrganizeSnapshot {
	id: string;
	/** Current path of the note (after move) */
	currentPath: string;
	/** Original path of the note (before move) */
	originalPath: string;
	/** When the move was performed */
	movedAt: string;
}

/** Result of organizing a single note. */
export interface OrganizeResult {
	/** The note that was analyzed */
	notePath: string;
	/** Action taken or proposed */
	action: OrganizeAction;
	/** Whether a proposal was created (for new directories) */
	proposalCreated: boolean;
	/** Whether the note was moved directly (for existing directories) */
	movedDirectly: boolean;
	/** How the System 1 lane answered, when it ran (#558) */
	placement?: PlacementKind;
	/**
	 * Whether a created proposal was auto-accepted as generated (#228), moving
	 * the note. Only meaningful when `proposalCreated` is `true`.
	 */
	autoAccepted?: boolean;
}
