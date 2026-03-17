/**
 * Checkpoint data model for long-running operations.
 *
 * Each checkpoint captures the state of a resumable operation:
 * which items are done, which remain, and what cleanup tasks
 * should run on completion.
 */

/** Identifies the module that owns the operation. */
export type CheckpointModule =
	| 'deep-dive'
	| 'elaboration'
	| 'enrichment'
	| 'audio'
	| 'video'
	| 'summarize'
	| 'organize';

/** Status of a checkpoint lifecycle. */
export type CheckpointStatus = 'active' | 'completed' | 'discarded';

/**
 * A single work item in the queue. Generic payload allows each module
 * to store whatever context it needs to resume processing the item.
 */
export interface CheckpointWorkItem {
	/** Unique identifier for this work item */
	id: string;
	/** Human-readable label (e.g., file path, topic title) */
	label: string;
	/** Module-specific payload needed to resume this item */
	payload: Record<string, unknown>;
}

/**
 * A deferred task that should run when the operation completes.
 * Tasks are identified by a type string so the module can dispatch them.
 */
export interface DeferredTask {
	/** Unique identifier for this task */
	id: string;
	/** Discriminator for the module to dispatch on */
	type: string;
	/** Arbitrary data the task needs (e.g., file paths, IDs) */
	data: Record<string, unknown>;
}

/**
 * The persisted checkpoint document, stored as JSON in
 * `.auto-notes/checkpoints/{id}.json`.
 */
export interface Checkpoint {
	/** Unique checkpoint ID */
	id: string;
	/** Which module owns this operation */
	module: CheckpointModule;
	/** Human-readable operation description (shown in sidebar) */
	operationLabel: string;
	/** Current status */
	status: CheckpointStatus;
	/** ISO timestamp when the checkpoint was created */
	createdAt: string;
	/** ISO timestamp of the last update */
	updatedAt: string;
	/** Items that have been completed */
	completedItems: CheckpointWorkItem[];
	/** Items remaining in the queue */
	remainingItems: CheckpointWorkItem[];
	/** Tasks to execute when the operation completes (not on discard) */
	deferredTasks: DeferredTask[];
	/** Module-specific metadata (e.g., deep dive run ID, settings snapshot) */
	metadata: Record<string, unknown>;
}
