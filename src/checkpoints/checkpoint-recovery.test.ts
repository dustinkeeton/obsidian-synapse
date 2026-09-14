import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CheckpointRecoveryModule, STARTUP_CHECK_DELAY_MS } from './checkpoint-recovery';
import type { CheckpointRecoveryDeps } from './checkpoint-recovery';
import type { Checkpoint, CheckpointManager, NotificationManager } from '../shared';
import type { CommandRegistrar } from '../commands';

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		id: 'cp1',
		module: 'audio',
		operationLabel: 'Transcribe audio',
		status: 'active',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		completedItems: [{ id: 'a', label: 'a', payload: {} }],
		remainingItems: [{ id: 'b', label: 'b', payload: {} }, { id: 'c', label: 'c', payload: {} }],
		deferredTasks: [],
		metadata: {},
		...overrides,
	};
}

function makeDeps() {
	const checkpointManager = {
		listIncomplete: vi.fn().mockResolvedValue([]),
		resume: vi.fn().mockResolvedValue(null),
		discard: vi.fn().mockResolvedValue(undefined),
		cleanup: vi.fn().mockResolvedValue(0),
	};
	const notifications = {
		confirm: vi.fn().mockResolvedValue(false),
		info: vi.fn(),
	};
	const registrar = { register: vi.fn<(id: string, userEnabled: boolean, spec: unknown) => void>() };
	const deps = {
		checkpointManager: checkpointManager as unknown as CheckpointManager,
		notifications: notifications as unknown as NotificationManager,
		registrar: registrar as unknown as CommandRegistrar,
		resumeHandlers: { audio: vi.fn().mockResolvedValue(undefined) },
		refreshView: vi.fn().mockResolvedValue(undefined),
	} satisfies CheckpointRecoveryDeps;
	return { deps, checkpointManager, notifications, registrar };
}

describe('CheckpointRecoveryModule', () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it('registers manage-checkpoints and arms the startup check on load', async () => {
		const { deps, registrar, checkpointManager } = makeDeps();
		const mod = new CheckpointRecoveryModule(deps);
		mod.onload();
		expect(registrar.register).toHaveBeenCalledTimes(1);
		expect(registrar.register.mock.calls[0].slice(0, 2)).toEqual(['manage-checkpoints', true]);
		expect(checkpointManager.listIncomplete).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
		expect(checkpointManager.listIncomplete).toHaveBeenCalledTimes(1);
	});

	it('clears the startup timer on unload', async () => {
		const { deps, checkpointManager } = makeDeps();
		const mod = new CheckpointRecoveryModule(deps);
		mod.onload();
		mod.onunload();
		await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
		expect(checkpointManager.listIncomplete).not.toHaveBeenCalled();
	});

	it('discard: cancelled confirm leaves the checkpoint alone', async () => {
		const { deps, checkpointManager } = makeDeps();
		await new CheckpointRecoveryModule(deps).discard('cp1');
		expect(checkpointManager.discard).not.toHaveBeenCalled();
		expect(deps.refreshView).not.toHaveBeenCalled();
	});

	it('discard: confirmed discards, notifies, and refreshes the view', async () => {
		const { deps, checkpointManager, notifications } = makeDeps();
		notifications.confirm.mockResolvedValue(true);
		await new CheckpointRecoveryModule(deps).discard('cp1');
		expect(checkpointManager.discard).toHaveBeenCalledWith('cp1');
		expect(notifications.info).toHaveBeenCalledWith('Interrupted operation discarded');
		expect(deps.refreshView).toHaveBeenCalledTimes(1);
	});

	it('resume: dispatches to the owning module handler then refreshes', async () => {
		const { deps, checkpointManager } = makeDeps();
		const cp = makeCheckpoint();
		checkpointManager.resume.mockResolvedValue(cp);
		await new CheckpointRecoveryModule(deps).resume('cp1');
		expect(deps.resumeHandlers.audio).toHaveBeenCalledWith(cp);
		expect(deps.refreshView).toHaveBeenCalledTimes(1);
	});

	it('resume: reports an unknown module when no handler is wired', async () => {
		const { deps, checkpointManager, notifications } = makeDeps();
		checkpointManager.resume.mockResolvedValue(makeCheckpoint({ module: 'video' }));
		await new CheckpointRecoveryModule(deps).resume('cp1');
		expect(notifications.info).toHaveBeenCalledWith('Unknown module: video');
		expect(deps.refreshView).toHaveBeenCalledTimes(1);
	});

	it('resume: missing checkpoint notifies without refreshing', async () => {
		const { deps, notifications } = makeDeps();
		await new CheckpointRecoveryModule(deps).resume('nope');
		expect(notifications.info).toHaveBeenCalledWith('Checkpoint not found or already completed');
		expect(deps.refreshView).not.toHaveBeenCalled();
	});

	it('checkForIncomplete: no-op when nothing is interrupted', async () => {
		const { deps, notifications, checkpointManager } = makeDeps();
		await new CheckpointRecoveryModule(deps).checkForIncomplete();
		expect(notifications.confirm).not.toHaveBeenCalled();
		expect(checkpointManager.cleanup).not.toHaveBeenCalled();
	});

	it('checkForIncomplete: prompts with progress labels, opens the manager on Review, then cleans up', async () => {
		const { deps, notifications, checkpointManager } = makeDeps();
		checkpointManager.listIncomplete.mockResolvedValue([makeCheckpoint()]);
		notifications.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);
		await new CheckpointRecoveryModule(deps).checkForIncomplete();
		expect(notifications.confirm.mock.calls[0][0]).toBe(
			'1 interrupted operation found: Transcribe audio (1/3 done). Open manager?'
		);
		expect(notifications.confirm).toHaveBeenCalledTimes(3);
		expect(checkpointManager.cleanup).toHaveBeenCalledTimes(1);
	});

	it('checkForIncomplete: swallows errors', async () => {
		const { deps, checkpointManager } = makeDeps();
		checkpointManager.listIncomplete.mockRejectedValue(new Error('disk'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(new CheckpointRecoveryModule(deps).checkForIncomplete()).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('manage: empty list notifies', async () => {
		const { deps, notifications } = makeDeps();
		await new CheckpointRecoveryModule(deps).manage();
		expect(notifications.info).toHaveBeenCalledWith('No interrupted operations found');
	});

	it('manage: Resume path resumes each checkpoint', async () => {
		const { deps, notifications, checkpointManager } = makeDeps();
		const cp = makeCheckpoint();
		checkpointManager.listIncomplete.mockResolvedValue([cp]);
		checkpointManager.resume.mockResolvedValue(cp);
		notifications.confirm.mockResolvedValueOnce(true);
		await new CheckpointRecoveryModule(deps).manage();
		expect(notifications.confirm.mock.calls[0][0]).toBe('Transcribe audio: 1/3 completed, 2 remaining. Resume?');
		expect(deps.resumeHandlers.audio).toHaveBeenCalledWith(cp);
		expect(checkpointManager.discard).not.toHaveBeenCalled();
	});

	it('manage: More options -> Discard discards; Keep leaves it', async () => {
		const { deps, notifications, checkpointManager } = makeDeps();
		checkpointManager.listIncomplete.mockResolvedValue([
			makeCheckpoint({ id: 'cp1' }),
			makeCheckpoint({ id: 'cp2', operationLabel: 'Enrich' }),
		]);
		notifications.confirm
			.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
		await new CheckpointRecoveryModule(deps).manage();
		expect(checkpointManager.discard).toHaveBeenCalledTimes(1);
		expect(checkpointManager.discard).toHaveBeenCalledWith('cp1');
		expect(notifications.info).toHaveBeenCalledWith('Discarded: Transcribe audio');
	});
});
