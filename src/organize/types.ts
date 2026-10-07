import type { DecisionLane } from '../shared';

/** Topic extracted from a note's content, tags, and links. */
export interface NoteTopic {
	/** Primary topic label (e.g., "machine learning", "meeting notes") */
	label: string;
	/** Confidence score from AI analysis (0-1) */
	confidence: number;
}

/** How the System 1 placement lane answered (#558). */
export type PlacementKind = 'existing' | 'new-directory' | 'keep' | 'undecided';

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

/** `<keep-current>` or `<none>` beat every folder in the runoff: the note stays where it is, with no generative fallback. */
export interface KeepPlacement {
	kind: 'keep';
	/** Runoff probability (0-1) of the winning escape option */
	confidence: number;
}

/** An existing folder leads the runoff without a majority; System 2 may score folders but not propose a new one. */
export interface UndecidedPlacement {
	kind: 'undecided';
	leading: string;
	/** Runoff probability (0-1) of the leading folder */
	confidence: number;
}

export type Placement = ExistingPlacement | NewDirectoryPlacement | KeepPlacement | UndecidedPlacement;

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
	/** System 1 lane answer when the lane ran; `kind: 'existing'` is a `move` action in `determineAction`, `kind: 'keep'` ends the analysis */
	placement?: Placement;
	/** Which lane settled the placement, when the analyzer ran one */
	lane?: DecisionLane;
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

/** `'move'` targets a folder that exists; `'new-directory'` creates `proposedDirectory` on accept. */
export type OrganizeProposalKind = 'move' | 'new-directory';

/** Proposal to relocate a note — into an existing folder or a new one. Accepting is the only path that moves the note. */
export interface OrganizeProposal {
	id: string;
	/** Path of the note to be moved */
	sourceNotePath: string;
	/** Target directory path (existing for `'move'`, to be created for `'new-directory'`) */
	proposedDirectory: string;
	/** Absent on proposal files written before relocations became proposals; read as `'new-directory'` */
	proposalKind: OrganizeProposalKind;
	/** Lane that produced the placement, when known */
	lane?: DecisionLane;
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
	/** Id of the organize run (checkpoint id for scans, a fresh id otherwise) that moved the note; absent on snapshots written before bulk undo existed */
	runId?: string;
}

/** Result of organizing a single note. */
export interface OrganizeResult {
	/** The note that was analyzed */
	notePath: string;
	/** Action taken or proposed */
	action: OrganizeAction;
	/** Whether a proposal was created (a move to an existing folder or a new folder) */
	proposalCreated: boolean;
	/** Whether this call moved the note; only organize auto-accept can make this true */
	movedDirectly: boolean;
	/** How the System 1 lane answered, when it ran (#558) */
	placement?: PlacementKind;
	/**
	 * Whether a created proposal was auto-accepted as generated (#228), moving
	 * the note. Only meaningful when `proposalCreated` is `true`.
	 */
	autoAccepted?: boolean;
}
