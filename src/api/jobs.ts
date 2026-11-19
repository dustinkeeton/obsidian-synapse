import { generateId, redactSecrets } from '../shared';
import type { JobOperation, NotificationManager } from '../shared';
import type { ApiJob, ApiJobCancel, ApiJobLookup, ApiJobStatus, ApiJobWait, ApiResult } from './types';

/** Finished jobs kept for `get` / `wait`; the oldest beyond this are dropped. */
export const MAX_FINISHED_JOBS = 50;
/** Finished jobs older than this are dropped. */
export const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_WAIT_MS = 30_000;
export const MAX_WAIT_MS = 10 * 60 * 1000;

interface JobRecord {
	id: string;
	verb: string;
	status: ApiJobStatus;
	startedAt: number;
	finishedAt?: number;
	result?: ApiResult;
	error?: string;
	done: Promise<void>;
}

function unknownJob(id: string): string {
	return `No job with id ${id} (finished jobs are kept for an hour, the last ${MAX_FINISHED_JOBS})`;
}

function failedResult(error: string): ApiResult {
	return { ok: false, error: redactSecrets(error), written: [], proposals: [], cacheUse: null };
}

/**
 * Long API verbs as jobs (#624). A job's progress, failure and cancellation come from the
 * operations it starts, tagged with `jobOpId`; cancel goes through `NotificationManager.cancelJob`,
 * the same path as the toast's Cancel button.
 */
export class JobRegistry {
	private jobs = new Map<string, JobRecord>();

	constructor(private notifications: NotificationManager, private now: () => number = () => Date.now()) {}

	/** Start `run` under a new job id and return the id at once; `run` must not throw (it is settled either way). */
	start(verb: string, run: (jobId: string) => Promise<ApiResult>): string {
		this.prune();
		const id = `job${generateId()}`;
		const record: JobRecord = { id, verb, status: 'running', startedAt: this.now(), done: Promise.resolve() };
		this.jobs.set(id, record);
		record.done = run(id)
			.catch((error: unknown) => failedResult(error instanceof Error ? error.message : String(error)))
			.then((result) => this.finish(record, result));
		return id;
	}

	get(id: string): ApiJobLookup {
		this.prune();
		const record = this.jobs.get(id);
		return record ? { ok: true, job: this.snapshot(record) } : { ok: false, job: null, error: unknownJob(id) };
	}

	list(): ApiJob[] {
		this.prune();
		return [...this.jobs.values()].map((record) => this.snapshot(record, false));
	}

	/** Resolves when the job finishes or `timeoutMs` (default 30 s, at most 10 min) passes. */
	async wait(id: string, timeoutMs = DEFAULT_WAIT_MS): Promise<ApiJobWait> {
		this.prune();
		const record = this.jobs.get(id);
		if (!record) return { ok: false, timedOut: false, job: null, error: unknownJob(id) };
		const limit = Math.min(Math.max(0, timeoutMs), MAX_WAIT_MS);
		let timer: number | undefined;
		const timedOut = await Promise.race([
			record.done.then(() => false),
			new Promise<boolean>((resolve) => { timer = window.setTimeout(() => resolve(true), limit); }),
		]);
		if (timer !== undefined) window.clearTimeout(timer);
		return { ok: true, timedOut, job: this.snapshot(record) };
	}

	/**
	 * Cancel the job's running operations now, and any it starts later. The job ends `cancelled`
	 * only if an operation actually stopped; work outside its operations (e.g. deep dive's
	 * auto-accept after generation) runs to the end.
	 */
	cancel(id: string): ApiJobCancel {
		const record = this.jobs.get(id);
		if (!record) return { ok: false, stoppedOperations: 0, error: unknownJob(id) };
		if (record.status !== 'running') return { ok: false, stoppedOperations: 0, error: `Job ${id} already ${record.status}` };
		return { ok: true, stoppedOperations: this.notifications.cancelJob(id) };
	}

	private finish(record: JobRecord, result: ApiResult): void {
		const ops = this.notifications.jobOps.list(record.id);
		const failedOp = ops.find((op) => op.state === 'error');
		if (ops.some((op) => op.state === 'cancelled')) {
			record.status = 'cancelled';
		} else if (!result.ok) {
			record.status = 'failed';
			record.error = result.error;
		} else if (failedOp) {
			record.status = 'failed';
			record.error = redactSecrets(failedOp.message);
		} else {
			record.status = 'completed';
		}
		record.result = result;
		record.finishedAt = this.now();
	}

	private snapshot(record: JobRecord, withOperations = true): ApiJob {
		const ops = this.notifications.jobOps.list(record.id);
		const job: ApiJob = {
			id: record.id,
			verb: record.verb,
			status: record.status,
			startedAt: new Date(record.startedAt).toISOString(),
			progress: progressOf(ops),
		};
		if (record.finishedAt !== undefined) job.finishedAt = new Date(record.finishedAt).toISOString();
		if (record.error !== undefined) job.error = record.error;
		if (record.result !== undefined) job.result = record.result;
		if (withOperations) job.operations = ops.map(({ id, message, state, current, total }) => ({ id, message, state, current, total }));
		return job;
	}

	/** Drop finished jobs past the TTL, then the oldest beyond the cap. */
	private prune(): void {
		const finished = [...this.jobs.values()]
			.filter((record) => record.finishedAt !== undefined)
			.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
		const cutoff = this.now() - FINISHED_JOB_TTL_MS;
		const excess = finished.length - MAX_FINISHED_JOBS;
		finished.forEach((record, index) => {
			if ((record.finishedAt ?? 0) < cutoff || index < excess) this.forget(record.id);
		});
	}

	private forget(id: string): void {
		this.jobs.delete(id);
		this.notifications.jobOps.forget(id);
	}
}

/** The newest running operation's status line, else the last one that ran. */
function progressOf(ops: JobOperation[]): ApiJob['progress'] {
	const latest = [...ops].reverse().find((op) => op.state === 'running') ?? ops[ops.length - 1];
	if (!latest) return null;
	return {
		message: latest.message,
		...(latest.current !== undefined ? { current: latest.current } : {}),
		...(latest.total !== undefined ? { total: latest.total } : {}),
	};
}
