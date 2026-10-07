import { normalizePath } from 'obsidian';
import type { Checkpoint, MoveRecord } from '../shared';
import { generateMoveDiagram } from '../shared';
import type { OrganizeSnapshot } from './types';

/** Slack around a checkpoint's lifetime when matching unstamped snapshots to it. */
export const RUN_WINDOW_MS = 5000;

/** The snapshots of one organize run, newest move first. */
export interface UndoRun {
	snapshots: OrganizeSnapshot[];
	/** `movedAt` of the run's first move */
	startedAt: string;
}

export interface SkippedRevert {
	path: string;
	reason: string;
}

/**
 * Pick the most recent organize run. Snapshots stamped with a `runId` group by
 * that id; unstamped snapshots belong to the latest non-active organize
 * checkpoint whose `[createdAt - window, updatedAt + window]` covers their
 * `movedAt`. Whichever candidate moved a note most recently wins.
 */
export function selectLastRun(snapshots: OrganizeSnapshot[], checkpoints: Checkpoint[]): UndoRun | null {
	const candidates: OrganizeSnapshot[][] = [];

	const byRun = new Map<string, OrganizeSnapshot[]>();
	for (const snapshot of snapshots) {
		if (!snapshot.runId) continue;
		const group = byRun.get(snapshot.runId) ?? [];
		group.push(snapshot);
		byRun.set(snapshot.runId, group);
	}
	candidates.push(...byRun.values());

	const legacy = snapshots.filter((s) => !s.runId);
	const checkpoint = checkpoints
		.filter((c) => c.module === 'organize' && c.status !== 'active')
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
	if (legacy.length > 0 && checkpoint) {
		const from = Date.parse(checkpoint.createdAt) - RUN_WINDOW_MS;
		const to = Date.parse(checkpoint.updatedAt) + RUN_WINDOW_MS;
		const inWindow = legacy.filter((s) => {
			const at = Date.parse(s.movedAt);
			return at >= from && at <= to;
		});
		if (inWindow.length > 0) candidates.push(inWindow);
	}

	const newest = candidates
		.map((group) => ({ group, latest: Math.max(...group.map((s) => Date.parse(s.movedAt))) }))
		.sort((a, b) => b.latest - a.latest)[0];
	if (!newest) return null;

	const ordered = [...newest.group].sort((a, b) => Date.parse(b.movedAt) - Date.parse(a.movedAt));
	return { snapshots: ordered, startedAt: ordered[ordered.length - 1].movedAt };
}

/** `.synapse/organize/summaries/{YYYY-MM-DD}-undo-summary.md` */
export function buildUndoSummaryPath(timestamp: string): string {
	const date = timestamp.split('T')[0] || timestamp;
	return normalizePath(`.synapse/organize/summaries/${date}-undo-summary.md`);
}

export function generateUndoSummary(reverted: MoveRecord[], skipped: SkippedRevert[], timestamp: string): string {
	const date = timestamp.split('T')[0] || timestamp;
	const lines: string[] = [];
	lines.push('# Organize Undo Summary');
	lines.push('');
	lines.push(`**Date:** ${date}`);
	lines.push(`**Files moved back:** ${reverted.length}`);
	lines.push(`**Need attention:** ${skipped.length}`);
	lines.push('');
	if (reverted.length > 0) {
		lines.push('## Move Diagram');
		lines.push('');
		lines.push(generateMoveDiagram(reverted));
		lines.push('');
		lines.push('## Moved back');
		lines.push('');
		for (const move of reverted) {
			lines.push(`- \`${move.originalPath}\` -> \`${move.newPath}\``);
		}
		lines.push('');
	}
	if (skipped.length > 0) {
		lines.push('## Needs attention');
		lines.push('');
		for (const item of skipped) {
			lines.push(`- \`${item.path}\` — ${item.reason}`);
		}
		lines.push('');
	}
	return lines.join('\n');
}
