import { describe, it, expect, vi } from 'vitest';
import {
	ActivityLog, ACTIVITY_LOG_PATH, ACTIVITY_LOG_ROTATED_PATH, ACTIVITY_LOG_MAX_BYTES, ACTIVITY_MESSAGE_MAX_CHARS, MAX_EVENTS_LIMIT,
} from './activity-log';
import type { ActivityInput } from './activity-log';
import { NotificationManager } from './notifications';
import { jobOpId } from './job-operations';
import { memoryAdapter } from '../__test-utils__/mock-factories';

describe('ActivityLog (#627)', () => {
	it('appends redacted JSON lines with increasing seq and reads them back after a cursor', async () => {
		const adapter = memoryAdapter();
		const log = new ActivityLog(adapter, () => 0);
		log.record({ level: 'finish', message: 'Generated 3 proposals', opId: 'op@job:j1', label: 'Deep dive', jobId: 'j1' });
		log.record({ level: 'error', message: 'Request failed: key sk-ant-api03-abcdefghijklmnop' });
		log.record({ level: 'info', message: 'third' });

		const page = await log.since();
		expect(page.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(page.entries[0]).toEqual({ seq: 1, at: new Date(0).toISOString(), level: 'finish', message: 'Generated 3 proposals', opId: 'op@job:j1', label: 'Deep dive', jobId: 'j1' });
		expect(page.entries[1].message).not.toContain('abcdefghijklmnop');
		expect(page).toMatchObject({ cursor: 3, more: false, missed: false });
		expect(adapter.files.get(ACTIVITY_LOG_PATH)?.trim().split('\n')).toHaveLength(3);

		expect(await log.since(1, 1)).toMatchObject({ entries: [{ seq: 2 }], cursor: 2, more: true });
		expect(await log.since(3)).toMatchObject({ entries: [], cursor: 3, more: false });
	});

	it('continues seq from the file after a restart and skips a torn line', async () => {
		const adapter = memoryAdapter(new Map([[ACTIVITY_LOG_PATH, '{"seq":7,"at":"x","level":"info","message":"old"}\n{"seq":8,"at":']]));
		const log = new ActivityLog(adapter);
		log.record({ level: 'info', message: 'new' });
		const page = await log.since(0);
		expect(page.entries.map((e) => [e.seq, e.message])).toEqual([[7, 'old'], [8, 'new']]);
	});

	it('rotates past the size cap, keeps one previous file, and reports missed entries', async () => {
		const adapter = memoryAdapter();
		const log = new ActivityLog(adapter);
		const big = 'x'.repeat(ACTIVITY_MESSAGE_MAX_CHARS);
		const perLine = JSON.stringify({ seq: 100, at: new Date().toISOString(), level: 'info', message: `${big}…` }).length + 1;
		const perFile = Math.floor(ACTIVITY_LOG_MAX_BYTES / perLine);
		for (let i = 0; i < perFile * 2 + 1; i++) log.record({ level: 'info', message: `${big}${big}` });
		await log.flush();

		expect(adapter.files.has(ACTIVITY_LOG_ROTATED_PATH)).toBe(true);
		const page = await log.since(0, MAX_EVENTS_LIMIT);
		expect(page.missed).toBe(true);
		expect(page.entries[0].seq).toBeGreaterThan(1);
		expect(page.entries[0].message.length).toBe(ACTIVITY_MESSAGE_MAX_CHARS + 1);
		expect((await log.since(page.entries[0].seq - 1)).missed).toBe(false);
	});

	it('reports a cursor past a deleted log as missed and reads from the start', async () => {
		const adapter = memoryAdapter();
		const first = new ActivityLog(adapter);
		for (const message of ['a', 'b', 'c']) first.record({ level: 'info', message });
		const { cursor } = await first.since();
		adapter.files.clear();

		const restarted = new ActivityLog(adapter);
		expect(await restarted.since(cursor)).toMatchObject({ entries: [], cursor: 0, more: false, missed: true });
		restarted.record({ level: 'info', message: 'after' });
		expect(await restarted.since(cursor)).toMatchObject({ entries: [{ seq: 1, message: 'after' }], cursor: 1, missed: true });
		expect((await restarted.since(1)).missed).toBe(false);
	});

	it('continues after entries another writer appended to the same file', async () => {
		const adapter = memoryAdapter();
		const log = new ActivityLog(adapter);
		log.record({ level: 'info', message: 'here' });
		await log.flush();
		await adapter.append(ACTIVITY_LOG_PATH, '{"seq":2,"at":"x","level":"info","message":"élsewhere"}\n');
		log.record({ level: 'info', message: 'here again' });
		log.record({ level: 'info', message: 'and again' });
		const page = await log.since();
		expect(page.entries.map((e) => [e.seq, e.message])).toEqual([[1, 'here'], [2, 'élsewhere'], [3, 'here again'], [4, 'and again']]);
	});

	it('drops an entry whose write fails without breaking later ones', async () => {
		const adapter = memoryAdapter();
		const log = new ActivityLog(adapter);
		log.record({ level: 'info', message: 'first' });
		await log.flush();
		const append = vi.spyOn(adapter, 'append').mockRejectedValueOnce(new Error('disk full'));
		log.record({ level: 'info', message: 'lost' });
		log.record({ level: 'info', message: 'kept' });
		const page = await log.since();
		expect(append).toHaveBeenCalled();
		expect(page.entries.map((e) => [e.seq, e.message])).toEqual([[1, 'first'], [2, 'kept']]);
	});
});

describe('NotificationManager activity sink (#627)', () => {
	it('reports operation ends with their op id, label and job, and shown one-shot toasts', () => {
		const manager = new NotificationManager();
		const sink = vi.fn<(entry: ActivityInput) => void>();
		manager.setActivitySink(sink);

		manager.startOperation('Scanning', jobOpId('scan-a', { jobId: 'j1' })).finish('Done');
		manager.startOperation('Tidying', 'tidy-b').error('Tidy failed');
		manager.startOperation('Organizing', 'org-c');
		manager.cancelOperation('org-c');
		manager.info('Heads up');
		manager.info('Heads up');
		manager.success('Saved');
		manager.error('Bad thing');
		manager.notifyError('Accept failed', new Error('boom'));

		expect(sink.mock.calls.map(([entry]) => entry)).toEqual([
			{ level: 'finish', message: 'Done', opId: 'scan-a@job:j1', label: 'Scanning', jobId: 'j1' },
			{ level: 'error', message: 'Tidy failed', opId: 'tidy-b', label: 'Tidying' },
			{ level: 'cancelled', message: 'Operation cancelled', opId: 'org-c', label: 'Organizing' },
			{ level: 'info', message: 'Heads up' },
			{ level: 'success', message: 'Saved' },
			{ level: 'error', message: 'Bad thing' },
			{ level: 'error', message: 'Accept failed — boom' },
		]);
		manager.dispose();
	});

	it('a throwing sink never reaches the caller', () => {
		const manager = new NotificationManager();
		manager.setActivitySink(() => { throw new Error('sink'); });
		expect(() => manager.info('fine')).not.toThrow();
		manager.dispose();
	});
});
