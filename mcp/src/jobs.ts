import type { CreateMessageRequest, CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
import type { GenerationOutput, JobWait } from './api-types.js';
import { toGenerationOutput, toSamplingParams } from './sampling.js';

export type CallVerb = (verb: string, args: readonly unknown[]) => Promise<unknown>;

export interface JobRunContext {
	/** Aborted when the client cancels the tool call; the job is then cancelled too. */
	signal: AbortSignal;
	/** Sends one MCP progress notification; absent when the client asked for none. */
	progress?: (progress: number, message: string) => Promise<void>;
	/** Asks the client's model; absent when the client has no sampling capability. */
	sample?: (params: CreateMessageRequest['params']) => Promise<CreateMessageResult>;
	/** How long to follow the job before returning it still running. */
	maxWaitMs: number;
	/** Length of each `jobs.wait` inside Obsidian, and the progress heartbeat interval. */
	pollMs: number;
	now?: () => number;
}

export const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
export const DEFAULT_POLL_MS = 5000;
/** Under the plugin's 30-minute request expiry, so a slow reply or a user's approval still lands. */
export const DEFAULT_SAMPLING_TIMEOUT_MS = 25 * 60 * 1000;

function progressLine(wait: JobWait): string | null {
	const progress = wait.job?.progress;
	if (!progress) return null;
	return progress.current !== undefined && progress.total !== undefined ? `${progress.message} (${progress.current}/${progress.total})` : progress.message;
}

/**
 * Start a long verb and follow its job: progress notifications while it runs, sampling for its
 * model requests, `jobs.cancel` when the call is cancelled. Resolves with a `jobs.wait` result.
 */
export async function runJob(call: CallVerb, verb: string, args: readonly unknown[], ctx: JobRunContext): Promise<JobWait> {
	const start = await call(verb, args) as { ok: boolean; jobId?: string; error?: string };
	if (!start.ok || !start.jobId) return { ok: false, timedOut: false, job: null, error: start.error ?? `${verb} started no job` };
	const jobId = start.jobId;
	const now = ctx.now ?? Date.now;
	const deadline = now() + ctx.maxWaitMs;
	const cancel = () => { void call('jobs.cancel', [jobId]).catch(() => undefined); };
	ctx.signal.addEventListener('abort', cancel, { once: true });
	// A cancel that arrived while the start call was in flight has already fired.
	if (ctx.signal.aborted) cancel();
	// Progress goes out on every new status line and as a heartbeat every pollMs, sampling included,
	// so a client that resets its own timeout on progress never gives up (and cancels) a slow job.
	let ticks = 0;
	let lastLine: string | null = null;
	const report = (line: string) => { if (ctx.progress) void ctx.progress(++ticks, line).catch(() => undefined); };
	const heartbeat = ctx.progress ? setInterval(() => report(lastLine ?? 'Waiting for the job'), ctx.pollMs) : undefined;
	heartbeat?.unref?.();
	let wait: JobWait | null = null;
	try {
		for (;;) {
			const remaining = deadline - now();
			if (remaining <= 0 && wait) return { ...wait, timedOut: true };
			wait = await call('jobs.wait', [jobId, Math.max(0, Math.min(ctx.pollMs, remaining))]) as JobWait;
			if (ctx.signal.aborted || !wait.ok || !wait.job) return wait;
			const line = progressLine(wait);
			if (line && line !== lastLine) {
				lastLine = line;
				report(line);
			}
			if (wait.job.status === 'awaiting-output') {
				if (!ctx.sample) return { ...wait, timedOut: false };
				const outputs = await answer(wait, ctx.sample);
				if ('error' in outputs) return { ...wait, timedOut: false, samplingError: outputs.error };
				wait = await call('jobs.commit', [jobId, outputs.outputs, 0]) as JobWait;
				if (!wait.ok) return wait;
				continue;
			}
			if (wait.job.status !== 'running') return { ...wait, timedOut: false };
		}
	} catch (error) {
		// The job outlives a failed call into Obsidian, so its id goes back with the error.
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, timedOut: false, job: wait?.job ?? null, jobId, error: `${reason}. Job ${jobId} may still be running in Obsidian: follow it with jobs_wait, answer its requests with jobs_commit, or stop it with jobs_cancel.` };
	} finally {
		clearInterval(heartbeat);
		ctx.signal.removeEventListener('abort', cancel);
	}
}

async function answer(wait: JobWait, sample: NonNullable<JobRunContext['sample']>): Promise<{ outputs: GenerationOutput[] } | { error: string }> {
	try {
		const requests = wait.job?.requests ?? [];
		const outputs = await Promise.all(requests.map(async (request) => toGenerationOutput(request.id, await sample(toSamplingParams(request)))));
		return { outputs };
	} catch (error) {
		return { error: `Sampling failed: ${error instanceof Error ? error.message : String(error)}. Answer job.requests with jobs_commit, or cancel the job with jobs_cancel.` };
	}
}
