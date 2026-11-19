import type { CacheUse } from './cache-notice';

export type OperationStatus = 'completed' | 'failed' | 'cancelled';

/** What one module operation did; returned by deep dive's run/regenerate and elaboration's scanNote, read by the public API (#624). */
export interface OperationOutcome {
	status: OperationStatus;
	/** The operation toast's finish line, or why it stopped. */
	message: string;
	/** Proposals created or rewritten. */
	proposalIds: string[];
	/** Vault notes written. */
	writtenPaths: string[];
	cacheUse: CacheUse;
}
