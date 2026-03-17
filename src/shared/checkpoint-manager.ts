import { App, normalizePath } from 'obsidian';
import { ensureFolder } from './file-utils';
import {
	Checkpoint,
	CheckpointModule,
	CheckpointStatus,
	CheckpointWorkItem,
	DeferredTask,
} from './checkpoint-types';
import { generateId, isValidCheckpointId } from './id-utils';

const CHECKPOINT_FOLDER = '.auto-notes/checkpoints';

/**
 * Manages checkpoint persistence for long-running operations.
 *
 * Usage pattern:
 * 1. `create()` a checkpoint at the start of an operation
 * 2. `completeItem()` after each unit of work
 * 3. `addDeferredTask()` to register cleanup/finalization
 * 4. `complete()` when all items are done (fires deferred tasks via callback)
 * 5. On plugin reload, `listIncomplete()` to find operations to resume
 * 6. `resume()` to load a checkpoint and return remaining work items
 * 7. `discard()` to abandon a checkpoint (deferred tasks are NOT fired)
 */
export class CheckpointManager {
	/** Per-checkpoint write mutex to prevent concurrent read-modify-write. */
	private writeLocks = new Map<string, Promise<void>>();

	constructor(private app: App) {}

	/**
	 * Create a new checkpoint for a long-running operation.
	 */
	async create(params: {
		module: CheckpointModule;
		operationLabel: string;
		items: CheckpointWorkItem[];
		metadata?: Record<string, unknown>;
	}): Promise<Checkpoint> {
		const now = new Date().toISOString();
		const checkpoint: Checkpoint = {
			id: generateId(),
			module: params.module,
			operationLabel: params.operationLabel,
			status: 'active',
			createdAt: now,
			updatedAt: now,
			completedItems: [],
			remainingItems: [...params.items],
			deferredTasks: [],
			metadata: params.metadata ?? {},
		};

		await this.save(checkpoint);
		return checkpoint;
	}

	/**
	 * Resume an incomplete checkpoint. Returns the checkpoint with its
	 * remaining work items, or null if the checkpoint does not exist or
	 * is not active.
	 */
	async resume(checkpointId: string): Promise<Checkpoint | null> {
		this.validateId(checkpointId);
		const checkpoint = await this.load(checkpointId);
		if (!checkpoint || checkpoint.status !== 'active') return null;
		return checkpoint;
	}

	/**
	 * Mark a work item as completed and move it from remaining to completed.
	 * Returns the updated checkpoint.
	 */
	async completeItem(
		checkpointId: string,
		itemId: string
	): Promise<Checkpoint | null> {
		this.validateId(checkpointId);
		return this.withLock(checkpointId, async () => {
			const checkpoint = await this.load(checkpointId);
			if (!checkpoint || checkpoint.status !== 'active') return null;

			const itemIndex = checkpoint.remainingItems.findIndex(
				(item) => item.id === itemId
			);
			if (itemIndex === -1) return checkpoint;

			const [completed] = checkpoint.remainingItems.splice(itemIndex, 1);
			checkpoint.completedItems.push(completed);
			checkpoint.updatedAt = new Date().toISOString();

			await this.save(checkpoint);
			return checkpoint;
		});
	}

	/**
	 * Register a deferred task to run when the operation completes.
	 */
	async addDeferredTask(
		checkpointId: string,
		task: DeferredTask
	): Promise<Checkpoint | null> {
		this.validateId(checkpointId);
		return this.withLock(checkpointId, async () => {
			const checkpoint = await this.load(checkpointId);
			if (!checkpoint || checkpoint.status !== 'active') return null;

			checkpoint.deferredTasks.push(task);
			checkpoint.updatedAt = new Date().toISOString();

			await this.save(checkpoint);
			return checkpoint;
		});
	}

	/**
	 * Mark an operation as completed. The caller is responsible for
	 * executing the deferred tasks returned by this method.
	 * Returns the deferred tasks that should be executed.
	 */
	async complete(checkpointId: string): Promise<DeferredTask[]> {
		this.validateId(checkpointId);
		return this.withLock(checkpointId, async () => {
			const checkpoint = await this.load(checkpointId);
			if (!checkpoint || checkpoint.status !== 'active') return [];

			const tasks = [...checkpoint.deferredTasks];
			checkpoint.status = 'completed';
			checkpoint.updatedAt = new Date().toISOString();

			await this.save(checkpoint);
			return tasks;
		});
	}

	/**
	 * Discard a checkpoint. Completed items are kept in the vault
	 * but deferred tasks are NOT executed.
	 */
	async discard(checkpointId: string): Promise<void> {
		this.validateId(checkpointId);
		await this.withLock(checkpointId, async () => {
			const checkpoint = await this.load(checkpointId);
			if (!checkpoint) return;

			checkpoint.status = 'discarded';
			checkpoint.updatedAt = new Date().toISOString();
			await this.save(checkpoint);
		});
	}

	/**
	 * Delete a checkpoint file permanently.
	 */
	async remove(checkpointId: string): Promise<void> {
		this.validateId(checkpointId);
		const path = this.filePath(checkpointId);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (exists) {
				await this.app.vault.adapter.remove(path);
			}
		} catch {
			// Ignore removal errors
		}
	}

	/**
	 * Load a checkpoint by ID.
	 */
	async load(checkpointId: string): Promise<Checkpoint | null> {
		this.validateId(checkpointId);
		const path = this.filePath(checkpointId);
		try {
			const exists = await this.app.vault.adapter.exists(path);
			if (!exists) return null;
			const content = await this.app.vault.adapter.read(path);
			return JSON.parse(content) as Checkpoint;
		} catch {
			return null;
		}
	}

	/**
	 * List all incomplete (active) checkpoints. Used on plugin startup
	 * to detect operations that were interrupted.
	 */
	async listIncomplete(): Promise<Checkpoint[]> {
		return this.listByStatus('active');
	}

	/**
	 * List checkpoints filtered by status.
	 */
	async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
		const all = await this.listAll();
		return all.filter((cp) => cp.status === status);
	}

	/**
	 * List all checkpoints regardless of status.
	 */
	async listAll(): Promise<Checkpoint[]> {
		const folder = normalizePath(CHECKPOINT_FOLDER);
		try {
			const exists = await this.app.vault.adapter.exists(folder);
			if (!exists) return [];

			const listing = await this.app.vault.adapter.list(folder);
			const checkpoints: Checkpoint[] = [];

			for (const filePath of listing.files) {
				if (!filePath.endsWith('.json')) continue;
				try {
					const content = await this.app.vault.adapter.read(filePath);
					checkpoints.push(JSON.parse(content) as Checkpoint);
				} catch {
					// Skip corrupt files
				}
			}

			return checkpoints;
		} catch {
			return [];
		}
	}

	/**
	 * Clean up old completed/discarded checkpoints older than the given age.
	 */
	async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
		const now = Date.now();
		const all = await this.listAll();
		let removed = 0;

		for (const cp of all) {
			if (cp.status === 'active') continue;
			const age = now - new Date(cp.updatedAt).getTime();
			if (age > maxAgeMs) {
				await this.remove(cp.id);
				removed++;
			}
		}

		return removed;
	}

	// -- Private helpers --

	private async save(checkpoint: Checkpoint): Promise<void> {
		await ensureFolder(this.app, CHECKPOINT_FOLDER);
		const path = this.filePath(checkpoint.id);
		await this.app.vault.adapter.write(
			path,
			JSON.stringify(checkpoint, null, 2)
		);
	}

	private filePath(checkpointId: string): string {
		return normalizePath(`${CHECKPOINT_FOLDER}/${checkpointId}.json`);
	}

	/**
	 * Validate that a checkpoint ID is safe. Throws if the ID contains
	 * path traversal characters or anything outside base-36.
	 */
	private validateId(checkpointId: string): void {
		if (!isValidCheckpointId(checkpointId)) {
			throw new Error(`Invalid checkpoint ID: ${checkpointId}`);
		}
	}

	/**
	 * Serialize write operations per checkpoint ID to prevent
	 * concurrent read-modify-write races.
	 */
	private async withLock<T>(checkpointId: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.writeLocks.get(checkpointId) ?? Promise.resolve();
		let resolve: () => void;
		const next = new Promise<void>((r) => { resolve = r; });
		this.writeLocks.set(checkpointId, next);

		try {
			await prev;
			return await fn();
		} finally {
			resolve!();
			// Clean up if this is still the latest lock
			if (this.writeLocks.get(checkpointId) === next) {
				this.writeLocks.delete(checkpointId);
			}
		}
	}
}
