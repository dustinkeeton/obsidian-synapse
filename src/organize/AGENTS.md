---
last-updated: 2026-03-17
---

# organize module

AI-powered semantic directory structuring. Analyzes note content to determine the best directory, moves directly to existing directories or creates proposals for new ones.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null

  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
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

- `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, ensureFolder)
- `settings.ts` (AutoNotesSettings)

## Tests

- `content-analyzer.test.ts`
- `directory-matcher.test.ts`
- `organize-store.test.ts`
