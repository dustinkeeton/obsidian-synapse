import type { Checkpoint, CheckpointManager, CheckpointModule, NotificationManager } from '../shared';
import type { CommandRegistrar } from '../commands';

export type CheckpointResumeHandler = (checkpoint: Checkpoint) => Promise<void>;

/** One resume entry point per owning module; a missing key reports "Unknown module". */
export type CheckpointResumeHandlers = Partial<Record<CheckpointModule, CheckpointResumeHandler>>;

export interface CheckpointRecoveryDeps {
	checkpointManager: CheckpointManager;
	notifications: NotificationManager;
	registrar: CommandRegistrar;
	resumeHandlers: CheckpointResumeHandlers;
	/** Re-render the proposal sidebar after a resume/discard changes the checkpoint list. */
	refreshView: () => Promise<void>;
}
