import type { ImageAnalysis } from './image-analyzer';

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
}
