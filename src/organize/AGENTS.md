---
last-updated: 2026-10-06
---

# organize module

AI-powered semantic directory structuring: analyzes note content to pick the best directory, moves directly into existing directories or proposes new ones, runs resumable checkpointed vault scans, and writes Mermaid move-diagram summaries.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:54; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504)

  suggestDirectory(text: string, aiOpts?: DecisionRequestOptions): Promise<string | null>   // index.ts:74; ContentAnalyzer.resolvePlacement(text, [], aiOpts): a placement of kind 'existing' returns its directoryPath directly (#558); else topics -> DirectoryMatcher.scoreDirectories; top directoryPath when score >= SUGGEST_DIRECTORY_MIN_SCORE (0.6, index.ts:31), else null; unqueued, no vault write; the registry injects it into deep-dive
  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<OrganizeProposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>      // index.ts:114
  organizeNote(file: TFile): Promise<OrganizeResult | null>        // index.ts:221
  scanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // index.ts:283
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>   // index.ts:457
  rejectProposal(id: string): Promise<void>
}

function buildSummaryPath(timestamp: string): string
```

`ContentAnalyzer` and `DirectoryMatcher` are internal (constructed by `OrganizeModule`, not barrel-exported since the module-boundary refactor); the only outward seam is `suggestDirectory`.

Exported types: `OrganizeProposal`, `OrganizeSnapshot`, `OrganizeResult`, `ContentAnalysis`, `DirectoryScore`, `NoteTopic`, `OrganizeAction`, `OrganizeProposalStatus`

Re-exported settings renderer: `renderOrganizeSettings` (from `./settings-section`)

## Note Queue (#483)

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`.

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `organizeNote` (index.ts:239) | `file.path` | `organizeFile(file, false, undefined, cacheUse)` | `op.update("Waiting for another Synapse operation on <basename>")` |
| `acceptProposal` (index.ts:464) | `queued.sourceNotePath` (PRE-move) | `applyAccept(id, options)` | none |
| `undoOrganize` (index.ts:573) | `file.path` (current path) | inline `ensureFolder` + `vault.rename` back + snapshot removal | none (local move, no AI call) |
| `resumeFromCheckpoint` loop (index.ts:145) | `file.path` | `organizeFile(file, true, batchProposedDirs, cacheUse)` | none |
| `scanDirectory` loop (index.ts:371) | `eligible[i].path` | `organizeFile(eligible[i], true, batchProposedDirs, cacheUse)` | none |

Key-lifetime note: `acceptProposal` keys on the PRE-move `sourceNotePath`. A move changes the key,
exactly like a title rename — work already queued under the old path runs afterwards, finds no file
there and exits early.

`maybeAutoAccept` (index.ts:542) calls `applyAccept` DIRECTLY, never the public `acceptProposal`.
It runs inside `organizeFile` (called at index.ts:679), which every caller has already queued on that note's
key; routing it through `acceptProposal` would re-enter the same key and self-deadlock. This is the
"acquire at most once per operation" rule in its sharpest form.

`writeOrganizeSummary` (index.ts:746) writes a DIFFERENT note (`.synapse/organize/summaries/...`)
and stays unqueued — incidental writes to other notes are never queued, including from inside
`applyAccept` while it holds the source note's key.

Batch loops (`scanDirectory`, `resumeFromCheckpoint`) take one slot per note, never one per batch.

## ContentAnalyzer (`content-analyzer.ts`)

```ts
interface ResolvedPlacement { topics: NoteTopic[]; placement?: Placement; lane: DecisionLane }   // content-analyzer.ts:9; placement is the lane's answer whenever the lane ran (any kind); topics [] only for kind 'existing'
class ContentAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings, placement?: PlacementDecider)   // :40; default PlacementDecider(app, getSettings)
  analyze(file: TFile, aiOpts?: DecisionRequestOptions): Promise<ContentAnalysis>          // :53; reads body/tags/links, then resolvePlacement; sets ContentAnalysis.placement when the lane answered
  resolvePlacement(body: string, tags: string[], aiOpts?: DecisionRequestOptions): Promise<ResolvedPlacement>   // :79; kind 'existing' -> { topics: [], placement, lane: 'system-one' } + aiOpts.onSystemOne(); 'new-directory' | 'undecided' -> extractTopics + placement carried, lane 'system-two'; lane off / null / any lane error (console.warn via redactError, :89) -> topics only (#558)
  extractTopics(body: string, tags: string[], aiOpts?: AIRequestOptions): Promise<NoteTopic[]>   // aiOpts reaches complete() inside withRetry; unchanged generative path
  parseTopicResponse(raw: string): NoteTopic[]
  topicsFromTags(tags: string[]): NoteTopic[]
}
```

## PlacementDecider (`placement-decider.ts`, #558)

```ts
const NEW_DIRECTORY_OPTION = '<new-directory>'   // :10; '<' cannot appear in a vault folder name
const PLACEMENT_MAJORITY = 0.5                   // :12; existing-folder acceptance = strict majority of runoff mass; fixed, not a setting
const RUNOFF_SIZE = 5                            // :14; folders carried from round 1 into the runoff
class PlacementDecider {
  constructor(app: App, getSettings: () => SynapseSettings)   // :36; owns a DecisionClient + DirectoryMatcher (for collectDirectories)
  isAvailable(): boolean                                      // :41; DecisionClient.isEnabled()
  decide(body: string, tags: string[], aiOpts?: DecisionRequestOptions): Promise<Placement | null>   // :45; null for blank body / no eligible folders; round 1 = one choice per 254 candidateDirectories() + '<new-directory>' (state = body[0:3000] + tags); shortlist (:88) = top RUNOFF_SIZE folders by summed probability (zero-mass dropped), coalesced on canonical basename (coalesceByBasename, :137: summed probability, first path represents); one runoff choice over the shortlist + '<new-directory>' (skipped when round 1 was a single question over exactly the shortlist); resolve (:110) below; throws on lane errors (ContentAnalyzer falls back)
  candidateDirectories(): string[]                            // :78; collectDirectories() minus hidden folders (any segment starting with '.') and folders covered by isPathExcluded(dir | dir/note.md, 'organize', settings); the note's own folder stays eligible ("stay" is a valid answer)
}
function coalesceByBasename(options: { directoryPath: string; probability: number }[]): same   // :137
```

Decision rule (`resolve`, :110), evaluated on the runoff probabilities:

| Condition | Result |
|-----------|--------|
| P(`<new-directory>`) >= `organize.organizeConfidenceThreshold` | `{ kind: 'new-directory', confidence }` — System 2 names the folder (`allowNewDirectory: true`) |
| else top existing folder >= `PLACEMENT_MAJORITY` (0.5) | `{ kind: 'existing', directoryPath, confidence }` — direct move, no generative call |
| else | `{ kind: 'undecided', leading, confidence }` — System 2 may score existing folders but never proposes a new one (`allowNewDirectory: false`) |

`organizeConfidenceThreshold` is never the acceptance floor for an existing folder; a synonym-rich vault (`AI` / `artificial-intelligence` / `ai-agent`) splits mass so a 0.52 / 0.30 answer is a near-unanimous decision reported as low confidence.

Note: `extractTopics` on `ContentAnalyzer` takes `(body: string, tags: string[])` — different from `TopicAnalyzer.extractTopics` in `deep-dive` which takes `(content, title, ancestorTopics)`.

## DirectoryMatcher (`directory-matcher.ts`)

```ts
class DirectoryMatcher {
  constructor(app: App)
  scoreDirectories(analysis: ContentAnalysis): DirectoryScore[]
  determineAction(
    analysis: ContentAnalysis,
    minScoreThreshold?: number,    // default 0.6
    confidenceThreshold?: number,  // default 0.9
    opts?: { allowNewDirectory?: boolean }   // default true; false skips the new-directory branch entirely (#558 undecided)
  ): OrganizeAction                // :54; placement.kind 'existing' -> { type: 'move', targetDirectory } before any scoring (#558); candidates exclude noteDir; top candidate >= minScoreThreshold -> move; else (allowNewDirectory && topTopic.confidence >= confidenceThreshold) -> findExistingDirectory(buildDirectoryPath(label)): hit -> move there (noteDir hit = caller no-op), miss -> propose-new-directory (reasoning names the lane when placement.kind is 'new-directory'); else move to noteDir (#565)
  findExistingDirectory(path: string): string | null   // :103; existing folder sharing path's canonicalKey — full path first, then basename; null when none
  scoreDirectory(dirPath: string, analysis: ContentAnalysis, noteDir: string): number   // exact canonical topic match = EXACT_MATCH_BASE 0.4 + 0.4 x confidence (:5; clears 0.6 alone from confidence 0.5 up, #565); partial / path-segment / fuzzy tiers stay weak (max 0.4 x confidence)
  collectDirectories(): string[]
  buildDirectoryPath(topicLabel: string): string
}
```

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `OrganizeModule`, `buildSummaryPath` | Module entry point and public API |
| `content-analyzer.ts` | `ContentAnalyzer`, `ResolvedPlacement` | System 1 placement routing (#558) over AI topic extraction from note body, tags, and links |
| `placement-decider.ts` | `PlacementDecider`, `NEW_DIRECTORY_OPTION`, `PLACEMENT_MAJORITY`, `RUNOFF_SIZE`, `coalesceByBasename` | System 1 `choice` over eligible folders + new-directory, runoff, three-way decision rule (#558) |
| `directory-matcher.ts` | `DirectoryMatcher` | Scores existing directories; proposes new ones only when the canonical path does not exist (#565); honours `ContentAnalysis.placement` |
| `folder-normalize.ts` | `singularize`, `canonicalKey`, `editDistance`, `isFuzzyMatch` | Morphology-aware canonical keys for coalescing similar folder names (#172) |
| `organize-store.ts` | `OrganizeStore` | JSON persistence for proposals and move snapshots |
| `settings-section.ts` | `renderOrganizeSettings` | Settings UI renderer |
| `types.ts` | -- | All organize types |

`folder-normalize` is the single source of truth for folder-name coalescing, reused in three places: `DirectoryMatcher.buildDirectoryPath` emits new folders in canonical (singular) form; `DirectoryMatcher.scoreDirectory` matches topics to existing folders on canonical keys plus a conservative edit-distance tier; and `OrganizeModule` deduplicates proposed directories across a batch scan.

## Data Flow

```
organizeNote(file) / scanDirectory() / resumeFromCheckpoint()
  --> noteQueue.run(file.path, () => organizeFile(...))   [#483: slot held for the whole cycle]
        organizeFile(file, batch?, batchProposedDirs?, cacheUse?)    [queue-free core, index.ts:604]
          --> ContentAnalyzer.analyze(file, trackAiCache(cacheUse))  [#558: System 1 runoff -> analysis.placement of kind existing (topics []) | new-directory | undecided (both with AI topics); lane off/error -> AI topic extraction only; #527]
          --> return null when topics is empty AND placement.kind !== 'existing' (index.ts:619)
          --> DirectoryMatcher.determineAction(analysis, undefined, confidenceThreshold, { allowNewDirectory: placement?.kind !== 'undecided' })   [index.ts:626; existing -> direct move; own folder -> null "already placed"; OrganizeResult.placement = placement.kind]
            if existing dir matches:
              --> OrganizeStore.saveSnapshot()  [undo backup]
              --> vault.rename(file, newPath)  [direct move]
            if new dir needed:
              --> OrganizeStore.saveProposal()
              --> maybeAutoAccept()  [if shouldAutoAccept() -> applyAccept() DIRECTLY,
                                      never acceptProposal — same key, would deadlock]

acceptProposal(id, options?)                              [public, index.ts:457]
  --> OrganizeStore.loadProposal(id)  [null -> "Proposal not found"]
  --> noteQueue.run(proposal.sourceNotePath, () => applyAccept(id, options))
        applyAccept(id, options?)                         [queue-free core, index.ts:468]
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

undoOrganize(file)  [command: 'undo-organize', private, index.ts:564]
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

type PlacementKind = 'existing' | 'new-directory' | 'undecided'   // types.ts:10
type Placement =                                                   // types.ts:35; System 1 lane answer (#558)
  | { kind: 'existing'; directoryPath: string; confidence: number }
  | { kind: 'new-directory'; confidence: number }
  | { kind: 'undecided'; leading: string; confidence: number }
// ContentAnalysis.placement?: Placement; OrganizeResult.placement?: PlacementKind

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
| `settings.organize.organizeConfidenceThreshold` | `number` | `0.9` — confidence required before a NEW folder is proposed, in both lanes (System 2 top-topic confidence; System 1 P(`<new-directory>`)); never the floor for picking an existing folder (#558, #565) |
| `settings.ai.systemOne` (top-level) | `SystemOneSettings` | `enabled: false` — gates `PlacementDecider`; its `confidenceFloor` is NOT used by organize |
| `settings.autoAccept.organize` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | `[{pattern:'.synapse/**',features:'all'}, {pattern:'templates/**',features:'all'}]` |

## Dependencies

In: `shared/` (getMarkdownFiles, NotificationManager, ensureFolder, writeNote, generateOrganizeSummary, CheckpointManager, NoteOperationQueue, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, CacheUse, AIRequestOptions, openScanFolderPicker, Checkpoint, CheckpointWorkItem, DeferredTask, MoveRecord — see `index.ts:4-11`), `settings.ts` (SynapseSettings), `commands/` (CommandRegistrar, `index.ts:3`)

Out: nothing is imported by another feature. `modules/registry.ts:111-116` wraps `OrganizeModule.suggestDirectory` in a lambda and passes it to `DeepDiveModule` (its `SuggestDirectory` type, `deep-dive/types.ts:85`) for auto-organize nesting mode; `deep-dive` has no `../organize` import.

## Invariants / Gotchas

- Double-acceptance guard lives in `applyAccept`, not `acceptProposal`: the proposal is re-loaded inside the queue slot and the call no-ops if `proposal.status !== 'pending'`, so a pre-wait snapshot can never authorize a second move (index.ts:473).
- `maybeAutoAccept` must call `applyAccept`, never `acceptProposal` — it already runs under the note's queue key (#483).
- Move skips if a file already exists at the destination (returns null, does not overwrite).
- Batch scan coalesces near-identical proposed directories via `batchProposedDirs` map — variants like "model"/"models" resolve to a single folder (#172).
- `organizeConfidenceThreshold` has one meaning in both lanes: confidence required before a new folder is proposed. Existing-folder acceptance is `PLACEMENT_MAJORITY` (0.5, fixed) in the lane and `minScoreThreshold` (0.6, hardcoded at the `determineAction` call site) in System 2.
- The System 1 lane never creates a folder, and an existing folder leading its runoff is evidence AGAINST a new one: `undecided` runs `determineAction` with `allowNewDirectory: false` (`index.ts:626`). Only `new-directory` (P >= threshold), lane off, or a lane error can reach the propose-new-folder path (`placement-decider.ts:110`, `content-analyzer.ts:79`).
- `propose-new-directory` is never returned for a path that already exists (full-path or basename canonical match, `findExistingDirectory`, `directory-matcher.ts:103`); a hit is a move, or a no-op when it is the note's own folder (#565). The batch coalescer (`batchProposedDirs`) only dedups within a run.
- Lane options exclude hidden folders and folders covered by organize exclusion rules (`candidateDirectories`, `placement-decider.ts:78`); folders like `attachments` stay eligible unless the user excludes them.
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
