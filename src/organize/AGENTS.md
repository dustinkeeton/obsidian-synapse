---
last-updated: 2026-06-19
---

# organize module

AI-powered semantic directory structuring. Analyzes note content to determine the best directory, moves directly to existing directories or creates proposals for new ones. Supports checkpointed vault scans for resumability.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar,
    shouldAutoAccept?: () => boolean
  )

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<OrganizeProposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  organizeNote(file: TFile): Promise<OrganizeResult | null>
  scanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
}

function buildSummaryPath(timestamp: string): string
```

Re-exported classes: `ContentAnalyzer`, `DirectoryMatcher`

Exported types: `OrganizeProposal`, `OrganizeSnapshot`, `OrganizeResult`, `ContentAnalysis`, `DirectoryScore`, `NoteTopic`, `OrganizeAction`, `OrganizeProposalStatus`

Re-exported settings renderer: `renderOrganizeSettings` (from `./settings-section`)

## ContentAnalyzer (`content-analyzer.ts`)

```ts
class ContentAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  analyze(file: TFile): Promise<ContentAnalysis>
  extractTopics(body: string, tags: string[]): Promise<NoteTopic[]>
  parseTopicResponse(raw: string): NoteTopic[]
  topicsFromTags(tags: string[]): NoteTopic[]
}
```

Note: `extractTopics` on `ContentAnalyzer` takes `(body: string, tags: string[])` — different from `TopicAnalyzer.extractTopics` in `deep-dive` which takes `(content, title, ancestorTopics)`.

## DirectoryMatcher (`directory-matcher.ts`)

```ts
class DirectoryMatcher {
  constructor(app: App)
  scoreDirectories(analysis: ContentAnalysis): DirectoryScore[]
  determineAction(
    analysis: ContentAnalysis,
    minScoreThreshold?: number,    // default 0.6
    confidenceThreshold?: number   // default 0.9
  ): OrganizeAction
  scoreDirectory(dirPath: string, analysis: ContentAnalysis, noteDir: string): number
  collectDirectories(): string[]
  buildDirectoryPath(topicLabel: string): string
}
```

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `OrganizeModule`, `buildSummaryPath` | Module entry point and public API |
| `content-analyzer.ts` | `ContentAnalyzer` | AI topic extraction from note body, tags, and links |
| `directory-matcher.ts` | `DirectoryMatcher` | Scores existing directories; proposes new ones |
| `folder-normalize.ts` | `singularize`, `canonicalKey`, `editDistance`, `isFuzzyMatch` | Morphology-aware canonical keys for coalescing similar folder names (#172) |
| `organize-store.ts` | `OrganizeStore` | JSON persistence for proposals and move snapshots |
| `settings-section.ts` | `renderOrganizeSettings` | Settings UI renderer |
| `types.ts` | -- | All organize types |

`folder-normalize` is the single source of truth for folder-name coalescing, reused in three places: `DirectoryMatcher.buildDirectoryPath` emits new folders in canonical (singular) form; `DirectoryMatcher.scoreDirectory` matches topics to existing folders on canonical keys plus a conservative edit-distance tier; and `OrganizeModule` deduplicates proposed directories across a batch scan.

## Data Flow

```
organizeNote(file) / scanDirectory()
  --> ContentAnalyzer.analyze(file)  [AI: extract topics]
  --> DirectoryMatcher.determineAction(analysis, confidenceThreshold)
    if existing dir matches:
      --> vault.rename(file, newPath)  [direct move]
      --> OrganizeStore.saveSnapshot()  [undo backup]
    if new dir needed:
      --> OrganizeStore.saveProposal()
      --> maybeAutoAccept()  [if shouldAutoAccept() -> acceptProposal()]

acceptProposal(id, options?)
  --> ensureFolder(proposedDirectory)
  --> OrganizeStore.saveSnapshot()
  --> vault.rename(file, newPath)
  --> OrganizeStore.updateProposalStatus('accepted')
  --> writeOrganizeSummary(moveRecords)  [.synapse/organize/summaries/]

rejectProposal(id)
  --> OrganizeStore.updateProposalStatus('rejected')

undoOrganize(file)  [command: 'undo-organize', private]
  --> OrganizeStore.loadSnapshot(filePath)
  --> vault.rename(file, originalPath)
  --> OrganizeStore.removeSnapshot()
```

## Directory Scan (checkpointed)

```
scanDirectory(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: Collect eligible files (filtered by isExcluded)
  Phase 2: User confirmation (skipped when skipConfirmation=true)
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
  autoAccepted?: boolean  // true when a new-dir proposal was immediately accepted (#228)
}
```

## Commands Registered

| Command ID | Enabled When | Description |
|------------|-------------|-------------|
| `organize-current-note` | `settings.organize.enabled` | Organize the active note |
| `scan-directory-organize` | `settings.organize.enabled` | Scan a directory for organization (opens FolderPickerModal) |
| `undo-organize` | `settings.organize.enabled` | Undo the last organize move on the active note |

## Settings Keys

Path exclusion is centralized (#307): `settings.exclusions: ExclusionRule[]` consulted via `isPathExcluded(path, 'organize', settings)` and `findMatchingRule`. There is no per-module `excludeFolders` key.

| Key | Type | Default |
|-----|------|---------|
| `settings.organize.enabled` | `boolean` | `true` |
| `settings.organize.proposalFolderPath` | `string` | `.synapse/organize/proposals` |
| `settings.organize.snapshotFolderPath` | `string` | `.synapse/organize/snapshots` |
| `settings.organize.excludeTags` | `string[]` | `['no-organize']` |
| `settings.organize.organizeConfidenceThreshold` | `number` | `0.9` |
| `settings.autoAccept.organize` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | `[{pattern:'.synapse/**',features:'all'}, {pattern:'templates/**',features:'all'}]` |

## Dependencies

In: `shared/` (FolderPickerModal, getMarkdownFiles, NotificationManager, ensureFolder, writeNote, generateOrganizeSummary, CheckpointManager, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, Checkpoint, CheckpointWorkItem, DeferredTask, MoveRecord), `settings.ts` (SynapseSettings), `commands.ts` (CommandRegistrar)

Out: `ContentAnalyzer` and `DirectoryMatcher` are re-exported for use by `deep-dive` (auto-organize nesting mode).

## Invariants / Gotchas

- `acceptProposal` guards against double-acceptance: no-ops if `proposal.status !== 'pending'`.
- Move skips if a file already exists at the destination (returns null, does not overwrite).
- Batch scan coalesces near-identical proposed directories via `batchProposedDirs` map — variants like "model"/"models" resolve to a single folder (#172).
- `organizeConfidenceThreshold` gates new-directory proposals; `minScoreThreshold` (0.6, hardcoded in `determineAction` call site) gates existing-directory moves.
- Summary notes written to `.synapse/organize/summaries/{YYYY-MM-DD}-organize-summary.md`.
- `deep-dive` calls `onOrganizeRequested` which invokes `organizeNote` on accepted deep-dive notes (when `deepDive.autoOrganizeOnAccept` is true).

## Tests

| File | Covers |
|------|--------|
| `content-analyzer.test.ts` | ContentAnalyzer.analyze, extractTopics, parseTopicResponse |
| `directory-matcher.test.ts` | DirectoryMatcher.scoreDirectories, determineAction, buildDirectoryPath |
| `folder-normalize.test.ts` | singularize, canonicalKey, editDistance, isFuzzyMatch |
| `organize-store.test.ts` | OrganizeStore persistence |
| `auto-accept.test.ts` | Auto-accept flow (#228) |
| `batch-dedup.test.ts` | Batch directory coalescing (#172) |
| `settings-section.test.ts` | Settings UI renderer |
| `review-toast.test.ts` | Review toast notification |
