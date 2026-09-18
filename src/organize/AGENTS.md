---
last-updated: 2026-09-17
---

# organize module

AI-powered semantic directory structuring: analyzes note content to pick the best directory, moves directly into existing directories or proposes new ones, runs resumable checkpointed vault scans, and writes Mermaid move-diagram summaries.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:54; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504)

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<OrganizeProposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>      // index.ts:106
  organizeNote(file: TFile): Promise<OrganizeResult | null>        // index.ts:213
  scanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // index.ts:275
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>   // index.ts:449
  rejectProposal(id: string): Promise<void>
}

function buildSummaryPath(timestamp: string): string
```

Re-exported classes: `ContentAnalyzer`, `DirectoryMatcher`

Exported types: `OrganizeProposal`, `OrganizeSnapshot`, `OrganizeResult`, `ContentAnalysis`, `DirectoryScore`, `NoteTopic`, `OrganizeAction`, `OrganizeProposalStatus`

Re-exported settings renderer: `renderOrganizeSettings` (from `./settings-section`)

## Note Queue (#483)

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`.

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `organizeNote` (index.ts:231) | `file.path` | `organizeFile(file, false, undefined, cacheUse)` | `op.update("Waiting for another Synapse operation on <basename>")` |
| `acceptProposal` (index.ts:456) | `queued.sourceNotePath` (PRE-move) | `applyAccept(id, options)` | none |
| `undoOrganize` (index.ts:565) | `file.path` (current path) | inline `ensureFolder` + `vault.rename` back + snapshot removal | none (local move, no AI call) |
| `resumeFromCheckpoint` loop (index.ts:137) | `file.path` | `organizeFile(file, true, batchProposedDirs, cacheUse)` | none |
| `scanDirectory` loop (index.ts:363) | `eligible[i].path` | `organizeFile(eligible[i], true, batchProposedDirs, cacheUse)` | none |

Key-lifetime note: `acceptProposal` keys on the PRE-move `sourceNotePath`. A move changes the key,
exactly like a title rename — work already queued under the old path runs afterwards, finds no file
there and exits early.

`maybeAutoAccept` (index.ts:534) calls `applyAccept` DIRECTLY, never the public `acceptProposal`.
It runs inside `organizeFile` (called at index.ts:671), which every caller has already queued on that note's
key; routing it through `acceptProposal` would re-enter the same key and self-deadlock. This is the
"acquire at most once per operation" rule in its sharpest form.

`writeOrganizeSummary` (index.ts:738) writes a DIFFERENT note (`.synapse/organize/summaries/...`)
and stays unqueued — incidental writes to other notes are never queued, including from inside
`applyAccept` while it holds the source note's key.

Batch loops (`scanDirectory`, `resumeFromCheckpoint`) take one slot per note, never one per batch.

## ContentAnalyzer (`content-analyzer.ts`)

```ts
class ContentAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  analyze(file: TFile, aiOpts?: AIRequestOptions): Promise<ContentAnalysis>          // aiOpts forwarded to extractTopics (#527)
  extractTopics(body: string, tags: string[], aiOpts?: AIRequestOptions): Promise<NoteTopic[]>   // aiOpts reaches complete() inside withRetry
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
organizeNote(file) / scanDirectory() / resumeFromCheckpoint()
  --> noteQueue.run(file.path, () => organizeFile(...))   [#483: slot held for the whole cycle]
        organizeFile(file, batch?, batchProposedDirs?, cacheUse?)    [queue-free core, index.ts:596]
          --> ContentAnalyzer.analyze(file, trackAiCache(cacheUse))  [AI: extract topics; #527]
          --> DirectoryMatcher.determineAction(analysis, confidenceThreshold)
            if existing dir matches:
              --> OrganizeStore.saveSnapshot()  [undo backup]
              --> vault.rename(file, newPath)  [direct move]
            if new dir needed:
              --> OrganizeStore.saveProposal()
              --> maybeAutoAccept()  [if shouldAutoAccept() -> applyAccept() DIRECTLY,
                                      never acceptProposal — same key, would deadlock]

acceptProposal(id, options?)                              [public, index.ts:449]
  --> OrganizeStore.loadProposal(id)  [null -> "Proposal not found"]
  --> noteQueue.run(proposal.sourceNotePath, () => applyAccept(id, options))
        applyAccept(id, options?)                         [queue-free core, index.ts:460]
          --> re-load proposal (double-accept guard evaluated UNDER the slot)
          --> ensureFolder(proposedDirectory)
          --> OrganizeStore.saveSnapshot()
          --> vault.rename(file, newPath)                 [changes the note's queue key]
          --> OrganizeStore.updateProposalStatus('accepted')
          --> writeOrganizeSummary(moveRecords)  [DIFFERENT note, unqueued;
                                                  Mermaid move diagram ->
                                                  .synapse/organize/summaries/]

rejectProposal(id)                                        [no note write -> unqueued]
  --> OrganizeStore.updateProposalStatus('rejected')

undoOrganize(file)  [command: 'undo-organize', private, index.ts:556]
  --> OrganizeStore.loadSnapshot(filePath)
  --> noteQueue.run(file.path, ...)  [silent, no onWait]
        --> ensureFolder(original parent)
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
    --> for each file: noteQueue.run(path, () => organizeFile(file, true, batchProposedDirs, cacheUse)),
                       push cacheUse, completeItem()   [#483: one slot per note, not per batch]
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> genOp.finish(withCacheReport(parts.join(', ') | 'No changes needed', cacheUses, 'note'))   // one aggregated cache line, one CacheUse per note processed (#527)
    --> writeOrganizeSummary() if any files moved

resumeFromCheckpoint(checkpoint)
  --> re-processes remaining items from saved checkpoint (same per-note noteQueue.run shape)
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

In: `shared/` (getMarkdownFiles, NotificationManager, ensureFolder, writeNote, generateOrganizeSummary, CheckpointManager, NoteOperationQueue, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, CacheUse, AIRequestOptions, openScanFolderPicker, Checkpoint, CheckpointWorkItem, DeferredTask, MoveRecord — see `index.ts:4-11`), `settings.ts` (SynapseSettings), `commands/` (CommandRegistrar, `index.ts:3`)

Out: `ContentAnalyzer` and `DirectoryMatcher` are re-exported for use by `deep-dive` (auto-organize nesting mode).

## Invariants / Gotchas

- Double-acceptance guard lives in `applyAccept`, not `acceptProposal`: the proposal is re-loaded inside the queue slot and the call no-ops if `proposal.status !== 'pending'`, so a pre-wait snapshot can never authorize a second move (index.ts:465).
- `maybeAutoAccept` must call `applyAccept`, never `acceptProposal` — it already runs under the note's queue key (#483).
- Move skips if a file already exists at the destination (returns null, does not overwrite).
- Batch scan coalesces near-identical proposed directories via `batchProposedDirs` map — variants like "model"/"models" resolve to a single folder (#172).
- `organizeConfidenceThreshold` gates new-directory proposals; `minScoreThreshold` (0.6, hardcoded in `determineAction` call site) gates existing-directory moves.
- Summary notes (Mermaid `graph LR` move diagram via `generateOrganizeSummary`) written to `.synapse/organize/summaries/{YYYY-MM-DD}-organize-summary.md` by `writeOrganizeSummary` / `buildSummaryPath`.
- `deep-dive` calls `onOrganizeRequested` which invokes `organizeNote` on accepted deep-dive notes (when `deepDive.autoOrganizeOnAccept` is true). Same for `summarize.autoOrganizeOnSummarize`. `main.ts` dispatches both through `fireAndForget` — never awaited — so they simply enqueue behind whatever holds the note's slot (#483), no cycle.
- Completion toasts carry a "Review" action via `reviewAction({ generated, shouldAutoAccept, openProposalView })` (#366) — gated on `generated && !shouldAutoAccept() && !postOp`; the action opens the proposal view through `onOpenProposalView`. Used in the `finish()` handlers of `organizeNote`, `scanDirectory`, and `resumeFromCheckpoint`. When organize auto-accept is on the note is already moved, so no Review button appears.

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
| `cache-report.test.ts` | #527 finish wording: single-note hit/miss, no-topics hit, directory-scan aggregate hit/miss |
