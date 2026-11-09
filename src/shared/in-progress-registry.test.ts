import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InProgressRegistry } from './in-progress-registry';
import { NotificationManager } from './notifications';
import { Notice } from '../__mocks__/obsidian';

describe('InProgressRegistry', () => {
	it('lists begun entries in start order with a start time', () => {
		const registry = new InProgressRegistry();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true, startedAt: 5 });
		registry.begin({ id: 'b', kind: 'title', label: 'Title', cancellable: false });
		const snap = registry.snapshot();
		expect(snap.map((e) => e.id)).toEqual(['a', 'b']);
		expect(snap[0].startedAt).toBe(5);
		expect(typeof snap[1].startedAt).toBe('number');
	});

	it('patches progress on update and ignores unknown ids', () => {
		const registry = new InProgressRegistry();
		const listener = vi.fn();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		registry.subscribe(listener);
		registry.update('a', { current: 1, total: 3 });
		registry.update('missing', { current: 9 });
		expect(registry.snapshot()[0]).toMatchObject({ current: 1, total: 3 });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('removes an entry on end and emits only when something changed', () => {
		const registry = new InProgressRegistry();
		const listener = vi.fn();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		registry.subscribe(listener);
		registry.end('a');
		registry.end('a');
		expect(registry.snapshot()).toEqual([]);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith([]);
	});

	it('returns copies so callers cannot mutate registry state', () => {
		const registry = new InProgressRegistry();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		registry.snapshot()[0].label = 'mutated';
		expect(registry.snapshot()[0].label).toBe('REM');
	});

	it('stops notifying after unsubscribe', () => {
		const registry = new InProgressRegistry();
		const listener = vi.fn();
		const stop = registry.subscribe(listener);
		stop();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		expect(listener).not.toHaveBeenCalled();
	});

	it('keeps notifying other listeners when one throws', () => {
		const registry = new InProgressRegistry();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const good = vi.fn();
		registry.subscribe(() => { throw new Error('boom'); });
		registry.subscribe(good);
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		expect(good).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('clear empties the registry', () => {
		const registry = new InProgressRegistry();
		registry.begin({ id: 'a', kind: 'rem', label: 'REM', cancellable: true });
		registry.clear();
		expect(registry.snapshot()).toEqual([]);
	});
});

describe('NotificationManager in-progress tracking', () => {
	let manager: NotificationManager;

	beforeEach(() => {
		manager = new NotificationManager();
		Notice.instances.length = 0;
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		manager.dispose();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('registers an operation started with proposal metadata', () => {
		manager.startOperation('Generating proposals', 'gen', { kind: 'elaboration', target: 'Projects' });
		expect(manager.inProgress.snapshot()).toEqual([
			expect.objectContaining({ id: 'gen', kind: 'elaboration', label: 'Generating proposals', target: 'Projects', cancellable: true }),
		]);
	});

	it('leaves operations without metadata out of the registry', () => {
		manager.startOperation('Tidying note', 'tidy');
		expect(manager.inProgress.snapshot()).toEqual([]);
	});

	it('mirrors progress and update calls onto the entry', () => {
		const op = manager.startOperation('Organizing notes', 'org', { kind: 'organize' });
		op.progress(2, 7);
		expect(manager.inProgress.snapshot()[0]).toMatchObject({ current: 2, total: 7, label: 'Organizing notes' });
		op.progress(3, 7, 'Organizing alpha');
		expect(manager.inProgress.snapshot()[0]).toMatchObject({ current: 3, label: 'Organizing alpha' });
		op.update('Waiting for another operation...');
		expect(manager.inProgress.snapshot()[0].label).toBe('Waiting for another operation');
	});

	it.each([
		['finish', (op: ReturnType<NotificationManager['startOperation']>) => op.finish('done')],
		['error', (op: ReturnType<NotificationManager['startOperation']>) => op.error('failed')],
	])('deregisters on %s', (_name, settle) => {
		const op = manager.startOperation('Scanning', 'scan', { kind: 'rem' });
		settle(op);
		expect(manager.inProgress.snapshot()).toEqual([]);
	});

	it('deregisters on cancel and marks the handle cancelled', () => {
		const op = manager.startOperation('Scanning', 'scan', { kind: 'rem' });
		manager.cancelOperation('scan');
		expect(op.cancelled).toBe(true);
		expect(manager.inProgress.snapshot()).toEqual([]);
	});

	it('clears every entry on dispose', () => {
		manager.startOperation('Scanning', 'scan', { kind: 'rem' });
		manager.trackInProgress('Checking title', { kind: 'title' });
		manager.dispose();
		expect(manager.inProgress.snapshot()).toEqual([]);
	});

	it('drops the entry when a same-id operation restarts without metadata', () => {
		manager.startOperation('Scanning', 'scan', { kind: 'rem' });
		manager.startOperation('Scanning', 'scan');
		expect(manager.inProgress.snapshot()).toEqual([]);
	});

	it('tracks toast-less work as non-cancellable until its end function runs', () => {
		const end = manager.trackInProgress('Checking the title of note', { kind: 'title', target: 'note.md' });
		expect(manager.inProgress.snapshot()).toEqual([
			expect.objectContaining({ kind: 'title', target: 'note.md', cancellable: false }),
		]);
		expect(Notice.instances).toHaveLength(0);
		end();
		expect(manager.inProgress.snapshot()).toEqual([]);
	});
});
