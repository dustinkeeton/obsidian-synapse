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
	proposedAdditions: string;
	insertionPoint: 'append' | 'after-heading' | 'replace-section';
	insertionTarget?: string;
	status: 'pending' | 'accepted' | 'rejected';
	/** Image analysis results used during proposal generation, if any */
	imageAnalysis?: ImageAnalysis[];
}
