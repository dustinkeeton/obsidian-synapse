import type { NoticeAction } from './notifications';

/**
 * Inputs to {@link reviewAction} — the single decision point for whether a
 * completion toast should carry a "Review" button (#366).
 */
export interface ReviewActionOptions {
	/**
	 * `true` when the run produced at least one proposal/result. A toast with
	 * nothing generated has nothing to review.
	 */
	generated: boolean;
	/**
	 * Live accessor for the action-kind's own auto-accept flag (#228). Read
	 * through a getter (not a captured boolean) so a settings change takes
	 * effect without a reload — mirroring each module's `shouldAutoAccept`.
	 */
	shouldAutoAccept: () => boolean;
	/**
	 * Opens the unified proposal review view — each module's `onOpenProposalView`
	 * hook (may be `null` before main.ts wires it).
	 */
	openProposalView: (() => void) | null;
	/**
	 * `true` when the completion toast fires as an automatic post-op side effect
	 * (a chained `enrich()` / `checkTitle()` run), not a user-invoked action.
	 * Suppresses the Review affordance entirely so auto-accepting a PRIMARY
	 * action never surfaces an unrelated SECONDARY Review prompt every time
	 * (#366).
	 */
	postOp?: boolean;
}

/**
 * Centralized gate for the "Review" completion-toast action (#366), shared by
 * every proposal-producing module so the six flows stay in sync instead of
 * re-deriving the rule four divergent ways (setting-based, per-proposal
 * `!autoAccepted`, and `proposalCount - autoAcceptedCount > 0`).
 *
 * Returns a {@link NoticeAction} that opens the unified proposal view **iff**:
 *   1. something was generated this run (`generated`), AND
 *   2. auto-accept is OFF for this action's own kind (`!shouldAutoAccept()`) —
 *      an auto-accepted proposal is already applied, leaving nothing to
 *      review, AND
 *   3. this is not an automatic post-op side effect (`!postOp`).
 *
 * Otherwise returns `undefined` (the toast renders with no button). This is the
 * deep-dive pattern (`totalProposals > 0 && !shouldAutoAccept()`) generalized
 * with post-op suppression.
 */
export function reviewAction(opts: ReviewActionOptions): NoticeAction | undefined {
	if (opts.postOp) return undefined;
	if (!opts.generated) return undefined;
	if (opts.shouldAutoAccept()) return undefined;
	const open = opts.openProposalView;
	return { label: 'Review', onClick: () => open?.() };
}
