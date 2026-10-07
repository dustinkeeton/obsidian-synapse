---
last-updated: 2026-10-06
---

# organize module

AI-powered semantic directory structuring: analyzes note content to pick the best directory, proposes every relocation (into an existing folder or a new one — a note moves only on accept or under `autoAccept.organize`), runs resumable checkpointed vault scans, writes Mermaid move-diagram summaries, and can move a whole organize run back.

## Public API (`index.ts`)

```ts
class OrganizeModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:66; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504)

  suggestDirectory(text: string, aiOpts?: DecisionRequestOptions): Promise<string | null>   // index.ts:80; ContentAnalyzer.resolvePlacement(text, [], '', aiOpts): a placement of kind 'existing' returns its directoryPath (#558); 'keep' or no topics -> null; else topics -> DirectoryMatcher.scoreDirectories; top directoryPath when score >= SUGGEST_DIRECTORY_MIN_SCORE (0.6, index.ts:41), else null; unqueued, no vault write; the registry injects it into deep-dive
  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<OrganizeProposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>      // index.ts:133
  organizeNote(file: TFile): Promise<OrganizeResult | null>        // index.ts:225
  scanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // index.ts:290; returns the proposal count
  acceptProposal(id: string, options?: { silent?: boolean; runId?: string }): Promise<void>   // index.ts:417
  rejectProposal(id: string): Promise<void>
  undoOrganizeRun(): Promise<void>                                 // index.ts:560; command 'undo-organize-run'
}

function buildSummaryPath(timestamp: string): string
```

`ContentAnalyzer` and `DirectoryMatcher` are internal (constructed by `OrganizeModule`, not barrel-exported since the module-boundary refactor); the only outward seam is `suggestDirectory`.

Exported types: `OrganizeProposal`, `OrganizeProposalKind`, `OrganizeSnapshot`, `OrganizeResult`, `ContentAnalysis`, `DirectoryScore`, `NoteTopic`, `OrganizeAction`, `OrganizeProposalStatus`, `Placement`, `PlacementKind`, `ExistingPlacement`, `NewDirectoryPlacement`, `KeepPlacement`, `UndecidedPlacement`

Re-exported settings renderer: `renderOrganizeSettings` (from `./settings-section`)

## Relocation Rule (binding)

A multi-note or single-note organize never relocates a note without a proposal, regardless of lane. `organizeFile` (index.ts:641) turns a `move` action into a proposal of `proposalKind: 'move'` and a `propose-new-directory` action into `'new-directory'`; both carry the deciding `lane`. Only `maybeAutoAccept` (index.ts:504; `autoAccept.organize` on) moves the note, by applying the proposal immediately. `OrganizeResult.movedDirectly` is therefore `true` only when `autoAccepted` is. Live failure that fixed this rule: 164 of 310 notes moved silently in one scan with auto-accept off, 30 of them into `Media`.

## Note Queue (#483)

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`.

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `organizeNote` (index.ts:225) | `file.path` | `organizeFile(file, generateId(), false, undefined, cacheUse)` | `op.update("Waiting for another Synapse operation on <basename>")` |
| `acceptProposal` (index.ts:417) | `queued.sourceNotePath` (PRE-move) | `applyAccept(id, options)` | none |
| `undoOrganize` (index.ts:526) | `file.path` (current path) | inline `ensureFolder` + `vault.rename` back + snapshot removal | none (local move, no AI call) |
| `undoOrganizeRun` loop (index.ts:560) | `snapshot.currentPath` per note | `ensureFolder(original parent)` + `vault.rename(file, originalPath)` | none; yields (`sleep(0)`) between notes |
| `resumeFromCheckpoint` loop (index.ts:133) | `file.path` | `organizeFile(file, checkpoint.id, true, batchProposedDirs, cacheUse)` | none |
| `scanDirectory` loop (index.ts:290) | `eligible[i].path` | `organizeFile(eligible[i], checkpoint.id, true, batchProposedDirs, cacheUse)` | none |

Key-lifetime note: `acceptProposal` keys on the PRE-move `sourceNotePath`. A move changes the key,
exactly like a title rename — work already queued under the old path runs afterwards, finds no file
there and exits early.

`maybeAutoAccept` (index.ts:504) calls `applyAccept` DIRECTLY, never the public `acceptProposal`.
It runs inside `organizeFile`, which every caller has already queued on that note's
key; routing it through `acceptProposal` would re-enter the same key and self-deadlock. This is the
"acquire at most once per operation" rule in its sharpest form. It also hands `applyAccept` the live
`TFile` (`options.file`) so the rename mutates the caller's instance — intake's move detection
(`originalPath !== file.path`) depends on it.

`writeOrganizeSummary` (index.ts:793) writes a DIFFERENT note (`.synapse/organize/summaries/...`)
and stays unqueued — incidental writes to other notes are never queued, including from inside
`applyAccept` while it holds the source note's key. Batch auto-accepts (`silent`) skip the per-accept
summary; `reportRun` (index.ts:192) writes one for the run.

Batch loops (`scanDirectory`, `resumeFromCheckpoint`, `undoOrganizeRun`) take one slot per note, never one per batch.

## ContentAnalyzer (`content-analyzer.ts`)

```ts
interface ResolvedPlacement { topics: NoteTopic[]; placement?: Placement; lane: DecisionLane }   // content-analyzer.ts:9; placement is the lane's answer whenever the lane ran (any kind); topics [] for kind 'existing' | 'keep'
class ContentAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings, placement?: PlacementDecider)   // :40; default PlacementDecider(app, getSettings)
  analyze(file: TFile, aiOpts?: DecisionRequestOptions): Promise<ContentAnalysis>          // :53; reads body/tags/links, derives currentDir from file.parent (vault root -> ''), then resolvePlacement; sets ContentAnalysis.placement and .lane
  resolvePlacement(body: string, tags: string[], currentDir: string, aiOpts?: DecisionRequestOptions): Promise<ResolvedPlacement>   // :82; kind 'existing' | 'keep' -> { topics: [], placement, lane: 'system-one' } + aiOpts.onSystemOne(); 'new-directory' | 'undecided' -> extractTopics + placement carried, lane 'system-two'; lane off / null / any lane error (console.warn via redactError, :92) -> topics only (#558)
  extractTopics(body: string, tags: string[], aiOpts?: AIRequestOptions): Promise<NoteTopic[]>   // aiOpts reaches complete() inside withRetry; unchanged generative path
  parseTopicResponse(raw: string): NoteTopic[]
  topicsFromTags(tags: string[]): NoteTopic[]
}
```

## PlacementDecider (`placement-decider.ts`, #558)

```ts
const NEW_DIRECTORY_OPTION = '<new-directory>'   // :11; '<' cannot appear in a vault folder name
const KEEP_CURRENT_OPTION = '<keep-current>'     // :13; "leave the note in its current folder: <dir | vault root>"
const NONE_OPTION = '<none>'                     // :15; "no listed folder fits; do not move"
const PLACEMENT_MAJORITY = 0.5                   // :18; existing-folder acceptance = strict majority of runoff mass; fixed, not a setting
const FIRST_ROUND_SUPPORT = 0.25                 // :20; AND summed first-round mass >= this — the runoff may sharpen a leader, never invent one
const RUNOFF_SIZE = 5                            // :22; folders carried from round 1 into the runoff
const RUBRIC_TITLES = 5, RUBRIC_TITLE_CHARS = 40, RUBRIC_MAX_CHARS = 200   // :24-26; folder rubric budget
class PlacementDecider {
  constructor(app: App, getSettings: () => SynapseSettings)   // :50; owns a DecisionClient + DirectoryMatcher (for collectDirectories)
  isAvailable(): boolean                                      // :55; DecisionClient.isEnabled()
  decide(body: string, tags: string[], currentDir: string, aiOpts?: DecisionRequestOptions): Promise<Placement | null>   // :60; null for blank body / no eligible folders other than currentDir; round 1 = one choice per 252 candidateDirectories() minus currentDir, each with a folderRubric, + the three escape options (state = body[0:3000] + "Current folder: <dir | vault root>" + tags); shortlist (:106) = top RUNOFF_SIZE folders by summed first-round probability (zero-mass dropped), coalesced on canonical basename (coalesceByBasename, :196); one runoff choice over the shortlist + the same escapes (skipped when round 1 was a single question over exactly the shortlist); resolve (:130) below; throws on lane errors (ContentAnalyzer falls back)
  candidateDirectories(): string[]                            // :96; collectDirectories() minus hidden folders (any segment starting with '.') and folders covered by isPathExcluded(dir | dir/note.md, 'organize', settings)
}
function folderRubric(folder: TFolder | undefined): string | null   // :179; 'Contains notes: "A", "B"' from up to RUBRIC_TITLES markdown basenames (clipped to RUBRIC_TITLE_CHARS, total <= RUBRIC_MAX_CHARS); null for an empty/unknown folder
function coalesceByBasename(options: { directoryPath: string; probability: number }[]): same   // :196
```

Decision rule (`resolve`, :130), evaluated on the runoff probabilities, in order:

| Condition | Result |
|-----------|--------|
| P(`<new-directory>`) >= `organize.organizeConfidenceThreshold` | `{ kind: 'new-directory', confidence }` — System 2 names the folder (`allowNewDirectory: true`) |
| else max(P(`<keep-current>`), P(`<none>`)) > top folder's runoff P | `{ kind: 'keep', confidence }` — the note stays; no generative call, no proposal (`organizeFile` returns null) |
| else top folder runoff P >= `PLACEMENT_MAJORITY` (0.5) AND its summed first-round mass >= `FIRST_ROUND_SUPPORT` (0.25) | `{ kind: 'existing', directoryPath, confidence }` — a `move` proposal, no generative call |
| else | `{ kind: 'undecided', leading, confidence }` — System 2 may score existing folders but never proposes a new one (`allowNewDirectory: false`) |

Ties between an escape option and the leading folder go to the folder (undecided). `organizeConfidenceThreshold` is never the acceptance floor for an existing folder; a synonym-rich vault (`AI` / `artificial-intelligence` / `ai-agent`) splits mass so a 0.52 / 0.30 answer is a near-unanimous decision reported as low confidence. The escape options and the two-condition rule exist because a forced choice over five folders manufactures majorities: with no way to say "none", a mediocre leader like `Media` reached 0.5 against four weak alternatives, and folder NAMES alone (null rubrics) let the lane treat `Media` as a catch-all (30 unrelated notes in one scan).

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

## Undo (`undo-run.ts`)

```ts
const RUN_WINDOW_MS = 5000                                                       // :7
interface UndoRun { snapshots: OrganizeSnapshot[]; startedAt: string }          // newest move first
interface SkippedRevert { path: string; reason: string }
function selectLastRun(snapshots: OrganizeSnapshot[], checkpoints: Checkpoint[]): UndoRun | null   // :27; stamped snapshots group by runId; unstamped ones belong to the latest non-active 'organize' checkpoint whose [createdAt - window, updatedAt + window] covers movedAt; the candidate whose newest movedAt is latest wins; null when nothing matches
function buildUndoSummaryPath(timestamp: string): string                          // :63; .synapse/organize/summaries/{YYYY-MM-DD}-undo-summary.md
function generateUndoSummary(reverted: MoveRecord[], skipped: SkippedRevert[], timestamp: string): string   // :68; move diagram + "Moved back" + "Needs attention" lists
```

`undoOrganizeRun` (index.ts:560): `store.loadAllSnapshots()` + `checkpointManager.listAll()` -> `selectLastRun` -> "No organize run to undo" | `ConfirmModal` ("Undo last organize run?", confirm "Move back"; dismiss = cancel) -> per snapshot, newest first: skip when the note is missing at `currentPath` or `originalPath` is occupied (reported, snapshot kept); else `ensureFolder(original parent)`, `vault.rename(file, originalPath)` (so Obsidian rewrites links), `removeSnapshot` -> `op.finish("Moved N notes back — K need attention")` -> undo summary written. Every snapshot saved by `organizeFile`/`applyAccept` carries `runId` (checkpoint id for scans/resume, a fresh id for a single-note organize or a sidebar accept); the checkpoint-window fallback exists for snapshots written before the stamp.

## Run Summary (`run-summary.ts`)

```ts
interface RunTally { proposals; moveProposals; newDirectoryProposals; autoAccepted; errors; moveRecords: MoveRecord[] }
function emptyTally(): RunTally                                                           // :16
function tallyResult(tally: RunTally, result: OrganizeResult | null, originalPath: string): void   // :21; counts proposals by action.type; a moveRecord only when result.autoAccepted
function describeRun(tally: RunTally): string                                             // :36; "N proposals (M to existing folders, K new folders), E failed" | "No changes needed"
```

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `OrganizeModule`, `buildSummaryPath` | Module entry point and public API |
| `content-analyzer.ts` | `ContentAnalyzer`, `ResolvedPlacement` | System 1 placement routing (#558) over AI topic extraction from note body, tags, and links |
| `placement-decider.ts` | `PlacementDecider`, `NEW_DIRECTORY_OPTION`, `KEEP_CURRENT_OPTION`, `NONE_OPTION`, `PLACEMENT_MAJORITY`, `FIRST_ROUND_SUPPORT`, `RUNOFF_SIZE`, `RUBRIC_*`, `folderRubric`, `coalesceByBasename` | System 1 `choice` over rubric-described eligible folders + three escape options, runoff, four-way decision rule (#558) |
| `directory-matcher.ts` | `DirectoryMatcher` | Scores existing directories; proposes new ones only when the canonical path does not exist (#565); honours `ContentAnalysis.placement` |
| `folder-normalize.ts` | `singularize`, `canonicalKey`, `editDistance`, `isFuzzyMatch` | Morphology-aware canonical keys for coalescing similar folder names (#172) |
| `organize-store.ts` | `OrganizeStore` | JSON persistence for proposals and move snapshots; reads legacy proposal files (no `proposalKind`) as `'new-directory'` |
| `undo-run.ts` | `selectLastRun`, `buildUndoSummaryPath`, `generateUndoSummary`, `RUN_WINDOW_MS` | Pure helpers behind "Undo last organize run" |
| `run-summary.ts` | `RunTally`, `emptyTally`, `tallyResult`, `describeRun` | Scan / resume counters and finish wording |
| `settings-section.ts` | `renderOrganizeSettings` | Settings UI renderer |
| `types.ts` | -- | All organize types |

`folder-normalize` is the single source of truth for folder-name coalescing, reused in three places: `DirectoryMatcher.buildDirectoryPath` emits new folders in canonical (singular) form; `DirectoryMatcher.scoreDirectory` matches topics to existing folders on canonical keys plus a conservative edit-distance tier; and `OrganizeModule` deduplicates proposed directories across a batch scan.

## Data Flow

```
organizeNote(file) / scanDirectory() / resumeFromCheckpoint()
  --> noteQueue.run(file.path, () => organizeFile(...))   [#483: slot held for the whole cycle]
        organizeFile(file, runId, batch?, batchProposedDirs?, cacheUse?)    [queue-free core, index.ts:641]
          --> ContentAnalyzer.analyze(file, trackAiCache(cacheUse))  [#558: System 1 runoff -> analysis.placement of kind existing | keep (topics []) | new-directory | undecided (both with AI topics); lane off/error -> AI topic extraction only; #527]
          --> return null when placement.kind === 'keep' (index.ts:651)
          --> return null when topics is empty AND placement.kind !== 'existing' (index.ts:654)
          --> DirectoryMatcher.determineAction(analysis, undefined, confidenceThreshold, { allowNewDirectory: placement?.kind !== 'undecided' })   [index.ts:660; existing -> move action; own folder -> null "already placed"; OrganizeResult.placement = placement.kind]
            if move (target != current dir, destination free):
              --> OrganizeStore.saveProposal({ proposalKind: 'move', lane, reasoning: moveReasoning() })   [index.ts:826]
              --> maybeAutoAccept(proposal.id, file, runId, batch)
            if new dir needed:
              --> coalesceProposedDirectory (#172)
              --> OrganizeStore.saveProposal({ proposalKind: 'new-directory', lane })
              --> maybeAutoAccept(proposal.id, file, runId, batch)  [if shouldAutoAccept() -> applyAccept() DIRECTLY,
                                                                      never acceptProposal — same key, would deadlock]
          --> { proposalCreated: true, movedDirectly: autoAccepted, autoAccepted, placement }

acceptProposal(id, options?)                              [public, index.ts:417]
  --> OrganizeStore.loadProposal(id)  [null -> "Proposal not found"]
  --> noteQueue.run(proposal.sourceNotePath, () => applyAccept(id, options))
        applyAccept(id, options?)                         [queue-free core, index.ts:428]
          --> re-load proposal (double-accept guard evaluated UNDER the slot)
          --> ensureFolder(proposedDirectory)             [no-op for 'move'; creates the folder for 'new-directory']
          --> OrganizeStore.saveSnapshot({ runId: options.runId ?? generateId() })
          --> vault.rename(options.file ?? lookup, newPath)   [changes the note's queue key]
          --> OrganizeStore.updateProposalStatus('accepted')
          --> unless silent: writeOrganizeSummary(moveRecords)  [DIFFERENT note, unqueued;
                                                  Mermaid move diagram ->
                                                  .synapse/organize/summaries/]

rejectProposal(id)                                        [no note write -> unqueued]
  --> OrganizeStore.updateProposalStatus('rejected')

undoOrganize(file)  [command: 'undo-organize', private, index.ts:526]
  --> OrganizeStore.loadSnapshot(filePath)
  --> noteQueue.run(file.path, ...)  [silent, no onWait]
        --> ensureFolder(original parent)
        --> vault.rename(file, originalPath)
        --> OrganizeStore.removeSnapshot()

undoOrganizeRun()  [command: 'undo-organize-run', index.ts:560]
  --> OrganizeStore.loadAllSnapshots() + checkpointManager.listAll() -> selectLastRun()
  --> ConfirmModal -> per snapshot (newest first): skip missing/occupied, else
        noteQueue.run(currentPath, ensureFolder + vault.rename back) -> removeSnapshot(); sleep(0)
  --> op.finish("Moved N notes back — K need attention"); writeNote(buildUndoSummaryPath())
```

## Directory Scan (checkpointed)

```
scanDirectory(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: Collect eligible files (filtered by isExcluded)
  Phase 2: User confirmation (skipped when skipConfirmation=true)
  Phase 3: Checkpointed processing
    --> checkpointManager.create(module: 'organize', items)   [checkpoint.id = runId stamped on every snapshot]
    --> addDeferredTask('refresh-sidebar-view')
    --> for each file: noteQueue.run(path, () => organizeFile(file, checkpoint.id, true, batchProposedDirs, cacheUse)),
                       push cacheUse, tallyResult(), completeItem()   [#483: one slot per note, not per batch]
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> reportRun(): genOp.finish(withCacheReport(describeRun(tally), cacheUses, 'note'), reviewAction(...))   // one aggregated cache line, one CacheUse per note processed (#527)
                     writeOrganizeSummary(tally.moveRecords) if any auto-accepted moves; "Auto-accepted N organize proposals (notes moved)"; onViewRefreshNeeded when proposals > 0

resumeFromCheckpoint(checkpoint)
  --> re-processes remaining items from saved checkpoint (same per-note noteQueue.run shape, runId = checkpoint.id)
  --> completeItem() after each file
  --> on cancel: discard()
  --> on success: complete(), dispatch deferred tasks, reportRun(prefix 'Resumed -- ')
```

## Key Types

```ts
type OrganizeAction =
  | { type: 'move'; targetDirectory: string }
  | { type: 'propose-new-directory'; targetDirectory: string; reasoning: string }

type PlacementKind = 'existing' | 'new-directory' | 'keep' | 'undecided'   // types.ts:12
type Placement =                                                            // types.ts; System 1 lane answer (#558)
  | { kind: 'existing'; directoryPath: string; confidence: number }
  | { kind: 'new-directory'; confidence: number }
  | { kind: 'keep'; confidence: number }
  | { kind: 'undecided'; leading: string; confidence: number }
// ContentAnalysis.placement?: Placement; ContentAnalysis.lane?: DecisionLane; OrganizeResult.placement?: PlacementKind

type OrganizeProposalKind = 'move' | 'new-directory'
interface OrganizeProposal {
  id: string
  sourceNotePath: string
  proposedDirectory: string          // existing folder for 'move'; created on accept for 'new-directory'
  proposalKind: OrganizeProposalKind // absent on legacy files -> read as 'new-directory'
  lane?: 'system-one' | 'system-two'
  reasoning: string
  createdAt: string
  status: 'pending' | 'accepted' | 'rejected'
}

interface OrganizeSnapshot {
  id: string
  currentPath: string
  originalPath: string
  movedAt: string
  runId?: string   // checkpoint id (scan/resume) or fresh id; absent on snapshots written before bulk undo
}

interface OrganizeResult {
  notePath: string
  action: OrganizeAction
  proposalCreated: boolean
  movedDirectly: boolean  // true only via organize auto-accept
  placement?: PlacementKind
  autoAccepted?: boolean  // true when the proposal was immediately accepted (#228)
}
```

## Commands Registered

| Command ID | Enabled When | Description |
|------------|-------------|-------------|
| `organize-current-note` | `settings.organize.enabled` | Organize the active note (proposes; moves only under auto-accept) |
| `scan-directory-organize` | `settings.organize.enabled` | Scan a directory for organization (opens FolderPickerModal) |
| `undo-organize` | `settings.organize.enabled` | Undo the last organize move on the active note (registry status `disabled`) |
| `undo-organize-run` | `settings.organize.enabled` | Move every note of the last organize run back (ConfirmModal-gated) |

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
| `settings.autoAccept.organize` | `boolean` | `false` — the ONLY path by which a scan or single-note organize moves a note |
| `settings.exclusions` | `ExclusionRule[]` | `[{pattern:'.synapse/**',features:'all'}, {pattern:'templates/**',features:'all'}]` |

## Dependencies

In: `shared/` (getMarkdownFiles, NotificationManager, ensureFolder, writeNote, generateOrganizeSummary, generateMoveDiagram, CheckpointManager, NoteOperationQueue, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, ConfirmModal, sleep, CacheUse, AIRequestOptions, openScanFolderPicker, Checkpoint, CheckpointWorkItem, DeferredTask, MoveRecord, OperationHandle, DecisionLane — see `index.ts:4-12`), `settings.ts` (SynapseSettings), `commands/` (CommandRegistrar, `index.ts:3`)

Out: nothing is imported by another feature. `modules/registry.ts:111-116` wraps `OrganizeModule.suggestDirectory` in a lambda and passes it to `DeepDiveModule` (its `SuggestDirectory` type, `deep-dive/types.ts:85`) for auto-organize nesting mode; `deep-dive` has no `../organize` import. `views/unified-proposal-view.ts` renders `proposalKind` ("Move to X" vs "New folder X") and the lane.

## Invariants / Gotchas

- No relocation without a proposal: `organizeFile` never calls `vault.rename`; only `applyAccept` does (via accept or `maybeAutoAccept`). Intake's `moveWhenDone` fallback therefore handles notes that organize only proposed.
- Double-acceptance guard lives in `applyAccept`, not `acceptProposal`: the proposal is re-loaded inside the queue slot and the call no-ops if `proposal.status !== 'pending'`, so a pre-wait snapshot can never authorize a second move (index.ts:433).
- `maybeAutoAccept` must call `applyAccept`, never `acceptProposal` — it already runs under the note's queue key (#483) — and passes the live `TFile`.
- A move proposal is skipped (null) when a file already exists at the destination; accept re-checks and refuses to overwrite.
- Batch scan coalesces near-identical proposed directories via `batchProposedDirs` map — variants like "model"/"models" resolve to a single folder (#172).
- `organizeConfidenceThreshold` has one meaning in both lanes: confidence required before a new folder is proposed. Existing-folder acceptance is `PLACEMENT_MAJORITY` (0.5) AND `FIRST_ROUND_SUPPORT` (0.25), both fixed, in the lane and `minScoreThreshold` (0.6, hardcoded at the `determineAction` call site) in System 2.
- The System 1 lane never creates a folder, and an existing folder leading its runoff is evidence AGAINST a new one: `undecided` runs `determineAction` with `allowNewDirectory: false` (`index.ts:660`). Only `new-directory` (P >= threshold), lane off, or a lane error can reach the propose-new-folder path (`placement-decider.ts:130`, `content-analyzer.ts:82`).
- `keep` is terminal: no topics, no `determineAction`, no proposal; `suggestDirectory` returns null for it.
- The note's current folder is never offered as a folder option (it is `<keep-current>`), so "stay" mass concentrates on one option; the state names the current folder.
- `propose-new-directory` is never returned for a path that already exists (full-path or basename canonical match, `findExistingDirectory`, `directory-matcher.ts:103`); a hit is a move, or a no-op when it is the note's own folder (#565). The batch coalescer (`batchProposedDirs`) only dedups within a run.
- Lane options exclude hidden folders and folders covered by organize exclusion rules (`candidateDirectories`, `placement-decider.ts:96`); folders like `attachments` stay eligible unless the user excludes them.
- Summary notes (Mermaid `graph LR` move diagram via `generateOrganizeSummary`) written to `.synapse/organize/summaries/{YYYY-MM-DD}-organize-summary.md` by `writeOrganizeSummary` / `buildSummaryPath`; undo runs write `{YYYY-MM-DD}-undo-summary.md`.
- `undoOrganizeRun` reverts through `vault.rename` only (never the adapter) so `alwaysUpdateLinks` rewrites links back; skipped notes keep their snapshot for a later per-note undo.
- `deep-dive` calls `onOrganizeRequested` which invokes `organizeNote` on accepted deep-dive notes (when `deepDive.autoOrganizeOnAccept` is true). Same for `summarize.autoOrganizeOnSummarize`. `main.ts` dispatches both through `fireAndForget` — never awaited — so they simply enqueue behind whatever holds the note's slot (#483), no cycle.
- Completion toasts carry a "Review" action via `reviewAction({ generated, shouldAutoAccept, openProposalView })` (#366) — gated on `generated && !shouldAutoAccept() && !postOp`; the action opens the proposal view through `onOpenProposalView`. Used in the `finish()` handlers of `organizeNote` ("Proposed move to X" | "Proposal created for new directory"), `scanDirectory`, and `resumeFromCheckpoint`. When organize auto-accept is on the note is already moved ("Moved to X"), so no Review button appears.

## Tests

| File | Covers |
|------|--------|
| `content-analyzer.test.ts` | ContentAnalyzer.analyze, extractTopics, parseTopicResponse |
| `directory-matcher.test.ts` | DirectoryMatcher.scoreDirectories, determineAction, buildDirectoryPath |
| `folder-normalize.test.ts` | singularize, canonicalKey, editDistance, isFuzzyMatch |
| `organize-store.test.ts` | OrganizeStore persistence, legacy proposal files read as `new-directory` |
| `placement-decider.test.ts` | candidateDirectories, rubrics, escape options, runoff/coalescing, two-condition rule, keep |
| `system-one-placement.test.ts` | determineAction with placements, resolvePlacement lanes, OrganizeModule end-to-end with the lane |
| `relocation-proposals.test.ts` | Scan/single-note relocations are proposals; auto-accept moves + stamps runId; accept of a `move` proposal; `describeRun` |
| `undo-run.test.ts` | selectLastRun (runId / checkpoint window), undoOrganizeRun (reverse order, skips, folder recreation, cancel) |
| `auto-accept.test.ts` | Auto-accept flow (#228) |
| `batch-dedup.test.ts` | Batch directory coalescing (#172) |
| `settings-section.test.ts` | Settings UI renderer |
| `review-toast.test.ts` | Review toast notification |
| `cache-report.test.ts` | #527 finish wording: single-note hit/miss, no-topics hit, directory-scan aggregate hit/miss |
