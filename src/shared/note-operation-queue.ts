/**
 * Per-note serialization for AI read -> write cycles (#483). Key on the note
 * the operation reads/writes; acquire at most once per operation (public entry
 * points acquire, private cores do not).
 */

/** Options for {@link NoteOperationQueue.run}. */
export interface NoteOperationOptions {
	onWait?: () => void;
}

/** Path-keyed FIFO queue of async operations. One instance per plugin. */
export class NoteOperationQueue {
	/** Per-path chain tail; entries are resolve-only so a failure cannot poison the chain. */
	private tails = new Map<string, Promise<void>>();

	isBusy(notePath: string): boolean {
		return this.tails.has(notePath);
	}

	/** Number of notes with queued or running operations (diagnostics/tests). */
	get size(): number {
		return this.tails.size;
	}

	/**
	 * Run `operation` once every previously submitted operation for `notePath`
	 * has settled. Returns the operation's result; rejections propagate to the
	 * caller and still release the queue.
	 */
	async run<T>(
		notePath: string,
		operation: () => Promise<T>,
		options?: NoteOperationOptions
	): Promise<T> {
		const previous = this.tails.get(notePath);
		if (previous) options?.onWait?.();

		let release!: () => void;
		const current = new Promise<void>((resolve) => { release = resolve; });
		this.tails.set(notePath, current);

		try {
			if (previous) await previous;
			return await operation();
		} finally {
			release();
			// Only clear the map when nothing queued behind us.
			if (this.tails.get(notePath) === current) {
				this.tails.delete(notePath);
			}
		}
	}
}
