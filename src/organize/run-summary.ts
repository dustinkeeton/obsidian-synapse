import { normalizePath } from 'obsidian';
import type { MoveRecord } from '../shared';
import type { OrganizeResult } from './types';

/** Counters for one multi-note organize run (scan or resume). */
export interface RunTally {
	proposals: number;
	moveProposals: number;
	newDirectoryProposals: number;
	autoAccepted: number;
	errors: number;
	/** Notes actually relocated by this run; non-empty only under organize auto-accept */
	moveRecords: MoveRecord[];
}

export function emptyTally(): RunTally {
	return { proposals: 0, moveProposals: 0, newDirectoryProposals: 0, autoAccepted: 0, errors: 0, moveRecords: [] };
}

/** Fold one note's result into the tally; `originalPath` is the note's path before any auto-accept move. */
export function tallyResult(tally: RunTally, result: OrganizeResult | null, originalPath: string): void {
	if (!result?.proposalCreated) return;
	tally.proposals++;
	if (result.action.type === 'move') tally.moveProposals++;
	else tally.newDirectoryProposals++;
	if (result.autoAccepted) {
		tally.autoAccepted++;
		const fileName = originalPath.split('/').pop() ?? originalPath;
		tally.moveRecords.push({ originalPath, newPath: normalizePath(`${result.action.targetDirectory}/${fileName}`) });
	}
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** `"3 proposals (2 to existing folders, 1 new folder), 1 failed"`; `"No changes needed"` when nothing happened. */
export function describeRun(tally: RunTally): string {
	const parts: string[] = [];
	if (tally.proposals > 0) {
		const kinds: string[] = [];
		if (tally.moveProposals > 0) kinds.push(`${tally.moveProposals} to existing folder${tally.moveProposals === 1 ? '' : 's'}`);
		if (tally.newDirectoryProposals > 0) kinds.push(plural(tally.newDirectoryProposals, 'new folder'));
		parts.push(`${plural(tally.proposals, 'proposal')} (${kinds.join(', ')})`);
	}
	if (tally.errors > 0) parts.push(`${tally.errors} failed`);
	return parts.length > 0 ? parts.join(', ') : 'No changes needed';
}
