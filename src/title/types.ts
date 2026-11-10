export type TitleProposalTrigger =
	| 'untitled'
	| 'content-mismatch';

export type TitleProposalStatus = 'pending' | 'accepted' | 'rejected';

/**
 * How to resolve a title proposal whose target filename already exists in the
 * same folder (#408):
 * - `iterate`: keep the proposed title but append `-1`, `-2`, … so the rename
 *   never clobbers the existing note.
 * - `merge`: fold this note into the existing one (frontmatter union, bodies
 *   joined by a horizontal rule) and trash the source.
 */
export type TitleDuplicateStrategy = 'iterate' | 'merge';

export interface TitleProposal {
	id: string;
	sourceNotePath: string;
	currentTitle: string;
	proposedTitle: string;
	trigger: TitleProposalTrigger;
	reasoning: string;
	createdAt: string;
	status: TitleProposalStatus;
	/**
	 * Deterministic content-addressed key over the proposal's INPUTS (note path,
	 * content hash, current title, trigger, AI settings). OPTIONAL for back-compat
	 * with proposals already persisted before #408. Used to suppress re-proposing
	 * the SAME colliding title for UNCHANGED content after a reject.
	 */
	contentKey?: string;
	/**
	 * The existing target path this proposal would collide with, captured at
	 * proposal time as a UI hint only. OPTIONAL (no collision → unset). Always
	 * re-validated live at accept time, so a stale value never drives a rename.
	 */
	conflictsWith?: string;
}

/**
 * What {@link TitleModule.acceptProposal} did, so auto-accept can announce the
 * REAL outcome — the suffixed name for `iterate`, or "merged into …" for
 * `merge` — instead of always echoing the originally proposed title (#408).
 * `conflict` means a plain accept hit a live collision and surfaced the choice
 * without changing anything; `skipped` means nothing was eligible.
 */
export type TitleAcceptOutcome =
	| { status: 'renamed'; path: string }
	| { status: 'merged'; into: string }
	| { status: 'conflict'; target: string }
	| { status: 'skipped' };
