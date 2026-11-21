import type { ImageAnalysis } from './image-analyzer';
import type { AIRequestOptions, AIResponseInfo, OperationOutcome } from '../shared';

export type DetectionReason =
	| { type: 'short-note'; wordCount: number }
	| { type: 'todo-marker'; markers: string[] }
	| { type: 'empty-section'; heading: string }
	| { type: 'sparse-link'; linkedFrom: string[] }
	| { type: 'user-requested' };

export interface DetectionResult {
	notePath: string;
	reasons: DetectionReason[];
}

export interface Proposal {
	id: string;
	/**
	 * Deterministic hash of the inputs that produced this proposal (note path,
	 * content, detection reasons, and AI settings). Used to dedup re-scans of an
	 * unchanged note. Optional so proposal files written before this field
	 * existed still satisfy the `isProposal` guard and keep loading.
	 */
	contentKey?: string;
	sourceNotePath: string;
	createdAt: string;
	detectionReasons: DetectionReason[];
	originalContent: string;
	/** The full rewritten note body (field name kept so persisted proposal files stay loadable). */
	proposedAdditions: string;
	/** New proposals are always `'replace'`; the other values only exist so legacy proposal files still load. */
	insertionPoint: 'replace' | 'append' | 'after-heading' | 'replace-section';
	insertionTarget?: string;
	status: 'pending' | 'accepted' | 'rejected';
	/** Image analysis results used during proposal generation, if any */
	imageAnalysis?: ImageAnalysis[];
	/** How the rewrite was produced: provider, model, stop reason, usage (#625). Absent on proposals saved before it. */
	generation?: AIResponseInfo;
}

/** What one `scanNote` call did: the proposal generated, and the note when auto-accept rewrote it. `failed` = stopped on an error or produced nothing. */
export type ElaborationOutcome = OperationOutcome;

/** A public-API job running `scanNote` (#624, #626): its op is tagged with `jobOpId`; `ai` joins every model call. Not persisted. */
export interface ElaborationJobOptions {
	jobId?: string;
	ai?: AIRequestOptions;
}

/** `acceptProposal` options: `silent` for batch auto-accept; `onStale` overrides the stale-body guard. */
export interface ElaborationAcceptOptions {
	silent?: boolean;
	onStale?: 'confirm' | 'skip' | 'replace';
}
