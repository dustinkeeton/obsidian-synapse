/** Topic extracted from a note's content, tags, and links. */
export interface NoteTopic {
	/** Primary topic label (e.g., "machine learning", "meeting notes") */
	label: string;
	/** Confidence score from AI analysis (0-1) */
	confidence: number;
}

/** Result of analyzing a note's content to determine its topical fit. */
export interface ContentAnalysis {
	/** Path of the analyzed note */
	notePath: string;
	/** Extracted topics sorted by confidence */
	topics: NoteTopic[];
	/** Existing tags on the note */
	tags: string[];
	/** Existing outgoing link paths */
	links: string[];
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
}
