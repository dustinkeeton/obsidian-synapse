import { describe, it, expect, vi } from 'vitest';
import type { Job, JobWait } from './api-types.js';
import { runJob } from './jobs.js';
import type { JobRunContext } from './jobs.js';

const job = (status: Job['status'], extra: Partial<Job> = {}): Job => ({ id: 'j1', verb: 'deepDive.run', status, progress: null, ...extra });
const wait = (j: Job, extra: Partial<JobWait> = {}): JobWait => ({ ok: true, timedOut: false, job: j, ...extra });

/** A plugin stand-in: `start` for the long verb, then each `jobs.wait` returns the next scripted snapshot. */
function script(waits: JobWait[], commits: JobWait[] = []) {
	return vi.fn(async (verb: string, _args: readonly unknown[]): Promise<unknown> => {
		if (verb === 'deepDive.run') return { ok: true, jobId: 'j1' };
		if (verb === 'jobs.wait') return waits.length > 1 ? waits.shift() : waits[0];
		if (verb === 'jobs.commit') return commits.shift();
		if (verb === 'jobs.cancel') return { ok: true, stoppedOperations: 1 };
		throw new Error(`unexpected ${verb}`);
	});
}

const ctx = (extra: Partial<JobRunContext> = {}): JobRunContext => ({ signal: new AbortController().signal, maxWaitMs: 60_000, pollMs: 5000, ...extra });

describe('runJob (#628)', () => {
	it('follows the job to its end, reporting each new progress line with a rising counter', async () => {
		const call = script([
			wait(job('running', { progress: { message: 'Extracting topics' } }), { timedOut: true }),
			wait(job('running', { progress: { message: 'Extracting topics' } }), { timedOut: true }),
			wait(job('running', { progress: { message: 'Generating', current: 1, total: 3 } }), { timedOut: true }),
			wait(job('completed', { result: { ok: true } })),
		]);
		const progress = vi.fn(async () => undefined);
		const result = await runJob(call, 'deepDive.run', ['A.md'], ctx({ progress }));
		expect(result).toMatchObject({ ok: true, timedOut: false, job: { status: 'completed' } });
		expect(progress.mock.calls).toEqual([[1, 'Extracting topics'], [2, 'Generating (1/3)']]);
		expect(call).toHaveBeenCalledWith('jobs.wait', ['j1', 5000]);
	});

	it('returns the start failure as a jobs.wait-shaped result', async () => {
		const call = vi.fn(async () => ({ ok: false, error: 'Note not found' }));
		await expect(runJob(call, 'deepDive.run', ['x.md'], ctx())).resolves.toEqual({ ok: false, timedOut: false, job: null, error: 'Note not found' });
	});

	it('answers an awaiting-output job through sampling and commits the replies', async () => {
		const requests = [
			{ id: 'r1', feature: 'deep-dive', messages: [{ role: 'user' as const, content: 'Topic A' }] },
			{ id: 'r2', feature: 'deep-dive', messages: [{ role: 'user' as const, content: 'Topic B' }] },
		];
		const call = script([wait(job('awaiting-output', { requests })), wait(job('completed'))], [wait(job('running'))]);
		const sample = vi.fn(async (params: { messages: { content: { text?: string } }[] }) => ({
			role: 'assistant' as const, model: 'client-model', stopReason: 'endTurn', content: { type: 'text' as const, text: `About ${params.messages[0]!.content.text}` },
		}));
		const result = await runJob(call, 'deepDive.run', ['A.md'], ctx({ sample: sample as never }));
		expect(result.job?.status).toBe('completed');
		expect(call).toHaveBeenCalledWith('jobs.commit', ['j1', [
			{ requestId: 'r1', text: 'About Topic A', model: 'client-model', stopReason: 'endTurn' },
			{ requestId: 'r2', text: 'About Topic B', model: 'client-model', stopReason: 'endTurn' },
		], 0]);
	});

	it('hands an awaiting-output job back when the client cannot sample, or sampling fails', async () => {
		const awaiting = wait(job('awaiting-output', { requests: [{ id: 'r1', feature: null, messages: [] }] }));
		await expect(runJob(script([awaiting]), 'deepDive.run', [], ctx())).resolves.toMatchObject({ job: { status: 'awaiting-output' } });
		const declined = await runJob(script([awaiting]), 'deepDive.run', [], ctx({ sample: async () => { throw new Error('User declined'); } }));
		expect(declined).toMatchObject({ ok: true, job: { status: 'awaiting-output' } });
		expect(declined.samplingError).toContain('Sampling failed: User declined. Answer job.requests with jobs_commit');
	});

	it('cancels the job when the tool call is cancelled', async () => {
		const controller = new AbortController();
		const call = vi.fn(async (verb: string): Promise<unknown> => {
			if (verb === 'deepDive.run') return { ok: true, jobId: 'j1' };
			if (verb === 'jobs.wait') { controller.abort(); return wait(job('running'), { timedOut: true }); }
			return { ok: true, stoppedOperations: 1 };
		});
		await runJob(call, 'deepDive.run', [], ctx({ signal: controller.signal }));
		expect(call).toHaveBeenCalledWith('jobs.cancel', ['j1']);
	});

	it('returns a job still running after the wait limit as timed out', async () => {
		let clock = 0;
		const call = vi.fn(async (verb: string, args: readonly unknown[]): Promise<unknown> => {
			if (verb === 'deepDive.run') return { ok: true, jobId: 'j1' };
			clock += args[1] as number;
			return wait(job('running'), { timedOut: true });
		});
		const result = await runJob(call, 'deepDive.run', [], ctx({ maxWaitMs: 12_000, now: () => clock }));
		expect(result).toMatchObject({ timedOut: true, job: { status: 'running' } });
		expect(call.mock.calls.filter(([verb]) => verb === 'jobs.wait').map(([, args]) => args[1])).toEqual([5000, 5000, 2000]);
	});
});
