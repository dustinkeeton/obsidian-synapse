/** Op ids ending in this marker plus a job id belong to that job (#624). */
export const JOB_OP_MARKER = '@job:';

/** An operation's id with the job id appended when `scope` carries one; otherwise `base` unchanged. */
export function jobOpId(base: string, scope?: unknown): string {
	const jobId = scope !== null && typeof scope === 'object' ? (scope as { jobId?: unknown }).jobId : undefined;
	return typeof jobId === 'string' && jobId ? `${base}${JOB_OP_MARKER}${jobId}` : base;
}

/** The job an op id belongs to, or null. */
export function jobIdOf(opId: string): string | null {
	const at = opId.lastIndexOf(JOB_OP_MARKER);
	return at === -1 ? null : opId.slice(at + JOB_OP_MARKER.length) || null;
}

export type JobOperationState = 'running' | 'done' | 'error' | 'cancelled';

/** One operation a job started, as its toast last showed it. */
export interface JobOperation {
	id: string;
	label: string;
	message: string;
	state: JobOperationState;
	current?: number;
	total?: number;
	startedAt: number;
	endedAt?: number;
}

/** Every operation started under a job id, running or finished, until the job is forgotten. */
export class JobOperationLog {
	private byJob = new Map<string, Map<string, JobOperation>>();
	private cancelled = new Set<string>();

	/** Record a start or change for a job-tagged op id; ignored for untagged ids. */
	record(opId: string, patch: Partial<Omit<JobOperation, 'id'>> & { label?: string }): void {
		const jobId = jobIdOf(opId);
		if (!jobId) return;
		let ops = this.byJob.get(jobId);
		if (!ops) {
			ops = new Map();
			this.byJob.set(jobId, ops);
		}
		const existing = ops.get(opId);
		const base: JobOperation = existing ?? { id: opId, label: patch.label ?? '', message: patch.label ?? '', state: 'running', startedAt: Date.now() };
		ops.set(opId, { ...base, ...patch });
	}

	/** A same-id restart begins a fresh record. */
	restart(opId: string, label: string): void {
		const jobId = jobIdOf(opId);
		if (!jobId) return;
		this.byJob.get(jobId)?.delete(opId);
		this.record(opId, { label, message: label, state: 'running', startedAt: Date.now() });
	}

	list(jobId: string): JobOperation[] {
		return [...(this.byJob.get(jobId)?.values() ?? [])].map((op) => ({ ...op }));
	}

	markCancelled(jobId: string): void {
		this.cancelled.add(jobId);
	}

	isCancelled(jobId: string): boolean {
		return this.cancelled.has(jobId);
	}

	forget(jobId: string): void {
		this.byJob.delete(jobId);
		this.cancelled.delete(jobId);
	}

	clear(): void {
		this.byJob.clear();
		this.cancelled.clear();
	}
}
