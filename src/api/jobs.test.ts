import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobRegistry, MAX_FINISHED_JOBS, FINISHED_JOB_TTL_MS } from './jobs';
import { NotificationManager, jobOpId } from '../shared';
import type { ApiResult } from './types';

const OK: ApiResult = { ok: true, message: 'done', written: [], proposals: ['p1'], cacheUse: null };

/** A promise the test settles by hand. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

describe('JobRegistry (#624)', () => {
	let notifications: NotificationManager;
	let now: number;
	let jobs: JobRegistry;

	beforeEach(() => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
		notifications = new NotificationManager();
		now = 1_000_000;
		jobs = new JobRegistry(notifications, () => now);
	});

	afterEach(() => {
		notifications.dispose();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('returns an id at once and reports progress from the job\'s operations', async () => {
		const gate = deferred<ApiResult>();
		const id = jobs.start('scanFolder', (jobId) => {
			notifications.startOperation('Scanning', jobOpId('scan', { jobId })).progress(2, 5, 'Generating');
			return gate.promise;
		});

		expect(jobs.get(id)).toMatchObject({ verb: 'scanFolder', status: 'running', progress: { message: 'Generating (2/5)', current: 2, total: 5 } });
		gate.resolve(OK);
		const waited = await jobs.wait(id);
		expect(waited).toMatchObject({ ok: true, timedOut: false, job: { status: 'completed', result: OK } });
	});

	it('fails when the verb fails, with its error', async () => {
		const id = jobs.start('deepDive.run', async () => ({ ...OK, ok: false, error: 'No topics found' }));
		expect((await jobs.wait(id)).job).toMatchObject({ status: 'failed', error: 'No topics found' });
	});

	it('fails when one of its operations ended in an error, even if the verb returned', async () => {
		const id = jobs.start('scanFolder', async (jobId) => {
			notifications.startOperation('Scanning', jobOpId('scan', { jobId })).error('Scan failed -- disk full');
			return OK;
		});
		expect((await jobs.wait(id)).job).toMatchObject({ status: 'failed', error: 'Scan failed -- disk full' });
	});

	it('turns a throw into a failed job', async () => {
		const id = jobs.start('scanFolder', () => Promise.reject(new Error('kaboom')));
		expect((await jobs.wait(id)).job).toMatchObject({ status: 'failed', error: 'kaboom' });
	});

	it('cancels through the operation\'s Cancel path', async () => {
		const gate = deferred<ApiResult>();
		let handle: ReturnType<NotificationManager['startOperation']> | undefined;
		const id = jobs.start('deepDive.run', (jobId) => {
			handle = notifications.startOperation('Generating', jobOpId('gen', { jobId }));
			return gate.promise;
		});

		expect(jobs.cancel(id)).toEqual({ ok: true });
		expect(handle?.cancelled).toBe(true);
		gate.resolve({ ...OK, ok: false, error: 'Deep dive cancelled' });
		expect((await jobs.wait(id)).job?.status).toBe('cancelled');
		expect(jobs.cancel(id).ok).toBe(false);
	});

	it('ends cancelled when the user presses Cancel on the toast', async () => {
		const id = jobs.start('scanFolder', async (jobId) => {
			notifications.startOperation('Scanning', jobOpId('scan', { jobId }));
			notifications.cancelOperation(jobOpId('scan', { jobId }));
			return OK;
		});
		expect((await jobs.wait(id)).job?.status).toBe('cancelled');
	});

	it('times out a wait without ending the job', async () => {
		vi.useFakeTimers();
		const gate = deferred<ApiResult>();
		const id = jobs.start('scanFolder', () => gate.promise);
		const waiting = jobs.wait(id, 1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await waiting).toMatchObject({ ok: true, timedOut: true, job: { status: 'running' } });
		gate.resolve(OK);
	});

	it('reports unknown ids', async () => {
		expect(jobs.get('nope')).toBeNull();
		expect(await jobs.wait('nope')).toMatchObject({ ok: false, job: null });
		expect(jobs.cancel('nope').ok).toBe(false);
	});

	it('lists jobs without their operations', async () => {
		const id = jobs.start('scanFolder', async (jobId) => {
			notifications.startOperation('Scanning', jobOpId('scan', { jobId })).finish();
			return OK;
		});
		await jobs.wait(id);
		expect(jobs.get(id)?.operations).toHaveLength(1);
		expect(jobs.list()[0].operations).toBeUndefined();
	});

	it('drops finished jobs past the TTL and beyond the cap, and their operation logs', async () => {
		const first = jobs.start('scanFolder', async (jobId) => {
			notifications.startOperation('Scanning', jobOpId('scan', { jobId })).finish();
			return OK;
		});
		await jobs.wait(first);
		now += FINISHED_JOB_TTL_MS + 1;
		expect(jobs.list()).toEqual([]);
		expect(notifications.jobOps.list(first)).toEqual([]);

		const ids: string[] = [];
		for (let i = 0; i < MAX_FINISHED_JOBS + 2; i++) {
			now += 1;
			const id = jobs.start('scanFolder', async () => OK);
			await jobs.wait(id);
			ids.push(id);
		}
		const kept = jobs.list().map((job) => job.id);
		expect(kept).toHaveLength(MAX_FINISHED_JOBS);
		expect(kept).not.toContain(ids[0]);
		expect(kept).toContain(ids.at(-1));
	});
});
