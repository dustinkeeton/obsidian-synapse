/**
 * - `applied`: every accepted item was written.
 * - `partial`: some items were written; the rest were deselected or no longer fit the note.
 * - `skipped`: nothing to do (proposal missing or not pending, nothing selected, or the user cancelled).
 * - `conflict`: nothing written; a decision is needed first (the note changed, or the target name exists).
 * - `failed`: nothing written; the proposal can no longer apply (its note is gone, or a stored path or name is invalid).
 */
export type AcceptStatus = 'applied' | 'partial' | 'skipped' | 'conflict' | 'failed';

/** What a module's `acceptProposal` did (#633). A write error still throws. */
export interface AcceptResult {
	status: AcceptStatus;
	/** Vault files the accept created, changed or moved to. */
	written: string[];
	/** Why nothing, or only part, was written. */
	reason?: string;
}

export function acceptApplied(written: string[], partial = false, reason?: string): AcceptResult {
	return { status: partial ? 'partial' : 'applied', written, ...(reason ? { reason } : {}) };
}

export function acceptNotApplied(status: Exclude<AcceptStatus, 'applied' | 'partial'>, reason: string): AcceptResult {
	return { status, written: [], reason };
}

/** True when the accept wrote something. */
export function acceptWrote(result: AcceptResult): boolean {
	return result.status === 'applied' || result.status === 'partial';
}

export const PROPOSAL_NOT_FOUND = 'Proposal not found';
export const PROPOSAL_NOT_PENDING = 'Proposal is not pending';
export const SOURCE_NOTE_MISSING = 'Source note no longer exists';
