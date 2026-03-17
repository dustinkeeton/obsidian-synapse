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
	sourceNotePath: string;
	createdAt: string;
	detectionReasons: DetectionReason[];
	originalContent: string;
	proposedAdditions: string;
	insertionPoint: 'append' | 'after-heading' | 'replace-section';
	insertionTarget?: string;
	status: 'pending' | 'accepted' | 'rejected';
}
