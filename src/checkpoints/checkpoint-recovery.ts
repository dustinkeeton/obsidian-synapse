import { redactError } from '../shared';
import type { CheckpointManager, NotificationManager } from '../shared';
import type { CommandRegistrar } from '../commands';
import type { CheckpointResumeHandlers } from './types';

/** Delay before the startup interrupted-operation check runs. */
export const STARTUP_CHECK_DELAY_MS = 3000;

export interface CheckpointRecoveryDeps {
	checkpointManager: CheckpointManager;
	notifications: NotificationManager;
	registrar: CommandRegistrar;
	resumeHandlers: CheckpointResumeHandlers;
	/** Re-render the proposal sidebar after a resume/discard changes the checkpoint list. */
	refreshView: () => Promise<void>;
}

/**
 * Checkpoint recovery UX: startup interrupted-operation prompt, the
 * `manage-checkpoints` command, and the resume/discard actions the proposal
 * sidebar banner calls. Resume dispatches to the owning module via injected
 * handlers, so this module never imports a feature module.
 */
export class CheckpointRecoveryModule {
	private startupTimeout: number | null = null;

	constructor(private readonly deps: CheckpointRecoveryDeps) {}

	onload(): void {
		this.deps.registrar.register('manage-checkpoints', true, {
			callback: () => this.manage(),
		});
		this.startupTimeout = window.setTimeout(() => {
			void this.checkForIncomplete();
		}, STARTUP_CHECK_DELAY_MS);
	}

	onunload(): void {
		if (this.startupTimeout !== null) {
			window.clearTimeout(this.startupTimeout);
			this.startupTimeout = null;
		}
	}

	async discard(id: string): Promise<void> {
		const { checkpointManager, notifications } = this.deps;
		const proceed = await notifications.confirm(
			'Are you sure you want to discard this interrupted operation? Completed items are kept, but remaining items will be abandoned.',
			{ proceedLabel: 'Discard', cancelLabel: 'Cancel', level: 'warning' }
		);
		if (!proceed) return;

		await checkpointManager.discard(id);
		notifications.info('Interrupted operation discarded');
		await this.deps.refreshView();
	}

	async resume(id: string): Promise<void> {
		const { checkpointManager, notifications, resumeHandlers } = this.deps;
		const checkpoint = await checkpointManager.resume(id);
		if (!checkpoint) {
			notifications.info('Checkpoint not found or already completed');
			return;
		}

		const handler = resumeHandlers[checkpoint.module];
		if (handler) {
			await handler(checkpoint);
		} else {
			notifications.info(`Unknown module: ${checkpoint.module}`);
		}

		await this.deps.refreshView();
	}

	async checkForIncomplete(): Promise<void> {
		const { checkpointManager, notifications } = this.deps;
		try {
			const incomplete = await checkpointManager.listIncomplete();
			if (incomplete.length === 0) return;

			const labels = incomplete
				.map(cp => `${cp.operationLabel} (${cp.completedItems.length}/${cp.completedItems.length + cp.remainingItems.length} done)`)
				.join(', ');

			const proceed = await notifications.confirm(
				`${incomplete.length} interrupted operation${incomplete.length === 1 ? '' : 's'} found: ${labels}. Open manager?`,
				{ proceedLabel: 'Review', cancelLabel: 'Dismiss', level: 'warning' }
			);

			if (proceed) {
				await this.manage();
			}

			await checkpointManager.cleanup();
		} catch (error) {
			console.warn('[Synapse] Failed to check for incomplete checkpoints:', redactError(error));
		}
	}

	async manage(): Promise<void> {
		const { checkpointManager, notifications } = this.deps;
		const incomplete = await checkpointManager.listIncomplete();

		if (incomplete.length === 0) {
			notifications.info('No interrupted operations found');
			return;
		}

		for (const cp of incomplete) {
			const total = cp.completedItems.length + cp.remainingItems.length;
			const done = cp.completedItems.length;
			const remaining = cp.remainingItems.length;

			const wantResume = await notifications.confirm(
				`${cp.operationLabel}: ${done}/${total} completed, ${remaining} remaining. Resume?`,
				{ proceedLabel: 'Resume', cancelLabel: 'More options', level: 'warning' }
			);

			if (wantResume) {
				await this.resume(cp.id);
				continue;
			}

			const wantDiscard = await notifications.confirm(
				`${cp.operationLabel}: Discard remaining items? (Completed items are already saved)`,
				{ proceedLabel: 'Discard', cancelLabel: 'Keep', level: 'warning' }
			);

			if (wantDiscard) {
				await checkpointManager.discard(cp.id);
				notifications.info(`Discarded: ${cp.operationLabel}`);
			}
		}
	}
}
