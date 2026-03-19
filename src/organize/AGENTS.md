---
last-updated: 2026-03-19
---

# organize module

AI-powered semantic directory structuring. Analyzes note content to determine the best directory, moves directly to existing directories or creates proposals for new ones. Supports checkpointed vault scans for resumability.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null

  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  getPendingProposals(): Promise<OrganizeProposal[]>
  organizeNote(file: TFile): Promise<OrganizeResult | null>
  scanDirectory(folderPath?: string): Promise<number>
  acceptProposal(id: string): Promise<void>
  rejectProposal(id: string): Promise<void>
}
```

Exported: `ContentAnalyzer`, `DirectoryMatcher`, `buildSummaryPath(timestamp: string): string`

Exported types: `OrganizeProposal`, `OrganizeSnapshot`, `OrganizeResult`, `ContentAnalysis`, `DirectoryScore`, `NoteTopic`, `OrganizeAction`, `OrganizeProposalStatus`

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `content-analyzer.ts` | `ContentAnalyzer` | AI topic extraction from note content, tags, and links |
| `directory-matcher.ts` | `DirectoryMatcher` | Matches topics to existing directories or proposes new ones |
| `organize-store.ts` | `OrganizeStore` | JSON persistence for proposals and move snapshots |
| `types.ts` | -- | All organize types |

## Data Flow

```
organizeNote(file) / scanDirectory()
  --> ContentAnalyzer.analyze(file)  [AI: extract topics]
  --> DirectoryMatcher.determineAction(analysis)
    if existing dir matches:
      --> vault.rename(file, newPath)  [direct move]
      --> OrganizeStore.saveSnapshot()  [undo backup]
    if new dir needed:
      --> OrganizeStore.saveProposal()  [user review]

acceptProposal(id)
  --> ensureFolder(proposedDirectory)
  --> OrganizeStore.saveSnapshot()
  --> vault.rename(file, newPath)
  --> OrganizeStore.updateProposalStatus('accepted')

undoOrganize(file)
  --> OrganizeStore.loadSnapshot(filePath)
  --> vault.rename(file, originalPath)
  --> OrganizeStore.removeSnapshot()
```

## Directory Scan (checkpointed)

```
scanDirectory(folderPath?)
  Phase 1: Collect eligible files
  Phase 2: User confirmation
  Phase 3: Checkpointed processing
    --> checkpointManager.create(module: 'organize', items)
    --> addDeferredTask('refresh-sidebar-view')
    --> for each file: organizeFile(), completeItem()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> writeOrganizeSummary() if any files moved

resumeFromCheckpoint(checkpoint)
  --> re-processes remaining items from saved checkpoint
  --> completeItem() after each file
  --> on cancel: discard()
  --> on success: complete(), dispatch deferred tasks, write summary
```

## Key Types

```ts
type OrganizeAction =
  | { type: 'move'; targetDirectory: string }
  | { type: 'propose-new-directory'; targetDirectory: string; reasoning: string }

interface OrganizeProposal {
  id: string
  sourceNotePath: string
  proposedDirectory: string
  reasoning: string
  createdAt: string
  status: 'pending' | 'accepted' | 'rejected'
}

interface OrganizeSnapshot {
  id: string
  currentPath: string
  originalPath: string
  movedAt: string
}

interface OrganizeResult {
  notePath: string
  action: OrganizeAction
  proposalCreated: boolean
  movedDirectly: boolean
}
```

## Dependencies

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, ensureFolder, writeNote, generateOrganizeSummary, CheckpointManager, generateId, Checkpoint, CheckpointWorkItem, DeferredTask, MoveRecord)
- `settings.ts` (SynapseSettings)

## Tests

- `content-analyzer.test.ts`
- `directory-matcher.test.ts`
- `organize-store.test.ts`
