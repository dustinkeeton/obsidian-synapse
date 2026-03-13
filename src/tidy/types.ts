/** Snapshot of a note's content before tidy, enabling undo. */
export interface TidySnapshot {
	id: string;
	filePath: string;
	originalContent: string;
	createdAt: string;
}
