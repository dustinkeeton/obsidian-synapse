/**
 * Per-note serialization for AI operations (#483).
 *
 * Every Synapse AI feature reads a whole note, spends seconds in an AI call,
 * then writes the result back. Two of those cycles overlapping on ONE note
 * interleave destructively: transcribe-then-elaborate had elaboration read the
 * note BEFORE the transcript insert landed, so the model saw only an audio
 * wikilink it cannot open and hallucinated from the filename — and the chained
 * enrichment/title passes then ran against that same stale state. This queue
 * makes operations on one note run in submission order, so each reads the
 * content the previous one produced.
 *
 * Contract for callers:
 *
 * - Key on the note path the operation is ABOUT (the note it reads and writes).
 * - Acquire AT MOST ONCE per operation, so there is no lock ordering and no
 *   self-deadlock. Public entry points acquire; the private cores they delegate
 *   to do not. Incidental writes to OTHER notes (title backlink remediation,
 *   merge targets) stay unqueued for the same reason.
 * - Fire-and-forget follow-ups (post-op enrichment / title check) may be
 *   started from inside a queued operation: nothing awaits them, so they simply
 *   enqueue behind it and run against the post-write content.
 * - A rename inside a queued operation (title accept) changes the note's key.
 *   Work already queued under the OLD path still runs, finds no file there and
 *   exits early — deliberately preferred over re-keying, which would mean
 *   holding two keys at once.
 */

/** Options for {@link NoteOperationQueue.run}. */
export interface NoteOperationOptions {
	/**
	 * Called synchronously at submission time when the operation cannot start
	 * immediately because another operation holds the note. Used to surface a
	 * "waiting" state on user-invoked commands; automatic post-op work queues
	 * silently and passes nothing.
	 */
	onWait?: () => void;
}

/**
 * Path-keyed FIFO queue of async operations.
 *
 * One instance per plugin, injected into every module that runs a
 * read -> AI -> write cycle over a note.
 */
export class NoteOperationQueue {
	/**
	 * Tail of the promise chain per note path. Each entry resolves when the
	 * operation holding it finishes; entries never reject (the chain is built
	 * from internal resolve-only promises), so one failing operation cannot
	 * poison the queue for the next.
	 */
	private tails = new Map<string, Promise<void>>();

	/** Whether an operation is currently queued or running for this note. */
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
