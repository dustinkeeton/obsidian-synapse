---
last-updated: 2026-09-14
---

# Checkpoints Module

Checkpoint recovery UX (#496): the delayed startup "interrupted operations" prompt, the `synapse:manage-checkpoints` command, and the resume/discard actions behind the proposal sidebar's checkpoint banner. Persistence stays in `shared/checkpoint-manager.ts`; resume dispatch reaches the owning feature module only through injected handlers. Imports `obsidian` (none at runtime), `src/shared/*`, and the `CommandRegistrar` type.

## Public API

Exported from `index.ts`:

```ts
// checkpoint-recovery.ts:7
const STARTUP_CHECK_DELAY_MS = 3000

// checkpoint-recovery.ts:9
interface CheckpointRecoveryDeps {
  checkpointManager: CheckpointManager
  notifications: NotificationManager
  registrar: CommandRegistrar
  resumeHandlers: CheckpointResumeHandlers   // per-module resumeFromCheckpoint; missing key -> "Unknown module: <module>"
  refreshView: () => Promise<void>           // re-render the proposal sidebar after resume/discard
}

// checkpoint-recovery.ts:25
class CheckpointRecoveryModule {
  constructor(deps: CheckpointRecoveryDeps)
  onload(): void                              // registers manage-checkpoints; arms checkForIncomplete after STARTUP_CHECK_DELAY_MS
  onunload(): void                            // clears the startup timer
  discard(id: string): Promise<void>          // confirm -> checkpointManager.discard -> refreshView
  resume(id: string): Promise<void>           // checkpointManager.resume -> resumeHandlers[module] -> refreshView
  checkForIncomplete(): Promise<void>         // startup prompt (Review -> manage()); then checkpointManager.cleanup(); errors swallowed
  manage(): Promise<void>                     // per checkpoint: Resume | More options -> Discard | Keep
}

// types.ts:3 / :6
type CheckpointResumeHandler = (checkpoint: Checkpoint) => Promise<void>
type CheckpointResumeHandlers = Partial<Record<CheckpointModule, CheckpointResumeHandler>>
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `CheckpointRecoveryModule`, `STARTUP_CHECK_DELAY_MS`, `CheckpointRecoveryDeps`, `CheckpointResumeHandler`, `CheckpointResumeHandlers` | Barrel |
| `checkpoint-recovery.ts` | `CheckpointRecoveryModule`, `STARTUP_CHECK_DELAY_MS`, `CheckpointRecoveryDeps` | Recovery flows |
| `types.ts` | `CheckpointResumeHandler`, `CheckpointResumeHandlers` | Handler map type |
| `checkpoint-recovery.test.ts` | Tests | |

## Wiring (main.ts)

`resumeHandlers` maps every `CheckpointModule` to `<module>.resumeFromCheckpoint`; on mobile the `video` entry notifies "Video transcription is not available on mobile" instead. `refreshView` is `views.refreshUnifiedView(...)`. `UnifiedViewCallbacks.onCheckpointDiscard/onCheckpointResume` call `discard`/`resume`.

## Dependencies

| Import | From | File |
|--------|------|------|
| `redactError` | `../shared` | `checkpoint-recovery.ts:1` |
| `CheckpointManager`, `NotificationManager` (types) | `../shared` | `checkpoint-recovery.ts:2` |
| `CommandRegistrar` (type) | `../commands` | `checkpoint-recovery.ts:3` |
| `Checkpoint`, `CheckpointModule` (types) | `../shared` | `types.ts:1` |
