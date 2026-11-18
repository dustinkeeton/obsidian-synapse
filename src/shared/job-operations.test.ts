import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { jobIdOf, jobOpId, JobOperationLog } from './job-operations';
import { NotificationManager } from './notifications';

describe('jobOpId / jobIdOf', () => {
	it('tags an op id only when the scope carries a job id', () => {
		expect(jobOpId('tidy-vault', { jobId: 'j1' })).toBe('tidy-vault@job:j1');
		expect(jobOpId('tidy-vault', { folder: 'x', recursive: true })).toBe('tidy-vault');
		expect(jobOpId('tidy-vault', 'Projects')).toBe('tidy-vault');
		expect(jobOpId('tidy-vault', undefined)).toBe('tidy-vault');
		expect(jobOpId('tidy-vault', { jobId: '' })).toBe('tidy-vault');
	});

	it('reads the job id back, including from ids that contain paths', () => {
		expect(jobIdOf('deep-dive-scan-notes/a@b.md@job:j9')).toBe('j9');
		expect(jobIdOf('summarize-vault-scan')).toBeNull();
	});
});

describe('JobOperationLog', () => {
	it('keeps one record per op, merging later changes', () => {
		const log = new JobOperationLog();
		log.restart('scan@job:j1', 'Scanning');
		log.record('scan@job:j1', { message: 'Scanning (2/5)', current: 2, total: 5 });
		log.record('untagged', { message: 'ignored' });

		expect(log.list('j1')).toMatchObject([{ id: 'scan@job:j1', label: 'Scanning', message: 'Scanning (2/5)', current: 2, total: 5, state: 'running' }]);
		log.forget('j1');
		expect(log.list('j1')).toEqual([]);
	});
});

describe('NotificationManager job operations', () => {
	let manager: NotificationManager;

	beforeEach(() => {
		manager = new NotificationManager();
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	});

	afterEach(() => {
		manager.dispose();
		vi.unstubAllGlobals();
	});

	it('records a tagged operation from start to finish', () => {
		const op = manager.startOperation('Scanning', 'scan@job:j1');
		op.progress(1, 3, 'Generating');
		expect(manager.jobOps.list('j1')[0]).toMatchObject({ state: 'running', current: 1, total: 3, message: 'Generating (1/3)' });

		op.finish('Done');
		expect(manager.jobOps.list('j1')[0]).toMatchObject({ state: 'done', message: 'Done' });
	});

	it('records an error ending', () => {
		manager.startOperation('Scanning', 'scan@job:j1').error('boom');
		expect(manager.jobOps.list('j1')[0]).toMatchObject({ state: 'error', message: 'boom' });
	});

	it('cancelJob cancels the job\'s running operations and none of another job\'s', () => {
		const mine = manager.startOperation('A', 'a@job:j1');
		const other = manager.startOperation('B', 'b@job:j2');
		const untagged = manager.startOperation('C', 'c');

		manager.cancelJob('j1');

		expect(mine.cancelled).toBe(true);
		expect(other.cancelled).toBe(false);
		expect(untagged.cancelled).toBe(false);
		expect(manager.jobOps.list('j1')[0].state).toBe('cancelled');
	});

	it('cancels an operation a cancelled job starts later', () => {
		manager.cancelJob('j1');
		const late = manager.startOperation('Generating', 'gen@job:j1');
		expect(late.cancelled).toBe(true);
	});

	it('records nothing for untagged operations', () => {
		manager.startOperation('Scanning', 'plain').finish();
		expect(manager.jobOps.list('plain')).toEqual([]);
	});
});
