import type { Checkpoint, CheckpointModule } from '../shared';

export type CheckpointResumeHandler = (checkpoint: Checkpoint) => Promise<void>;

/** One resume entry point per owning module; a missing key reports "Unknown module". */
export type CheckpointResumeHandlers = Partial<Record<CheckpointModule, CheckpointResumeHandler>>;
