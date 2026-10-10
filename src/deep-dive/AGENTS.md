---
last-updated: 2026-10-09
---

# deep-dive module

Recursively explores a note by AI-extracting sub-topics and generating child notes, using a local quality score to bound recursion depth, and emitting a syllabus index plus inter-note navigation under a resumable checkpoint.

## Public API (`index.ts`)

```ts
class DeepDiveModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onNoteAccepted: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean, suggestDirectory?: SuggestDirectory)   // index.ts:82; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504); suggestDirectory = organize's folder suggestion, injected by modules/registry.ts:111-116 (null -> nested placement only)

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<DeepDiveProposal[]>                          // index.ts:117
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>                 // index.ts:127
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>   // index.ts:145
  rejectProposal(id: string): Promise<void>                                   // index.ts:229
}

// types.ts:85 — NOT barrel-exported (index.ts:33-40 exports only the proposal/run/topic types); the registry passes an inline lambda
type SuggestDirectory = (text: string, aiOpts?: AIRequestOptions) => Promise<string | null>

function buildDeepDivePath(
  topicTitle: string,
  rootFile: TFile,
  settings: { noteOutputFolder: string; nestingMode?: DeepDiveNestingMode },
  parentProposedPath?: string
): string
```

Re-exported syllabus navigator functions:

```ts
function computeTraversalOrder(proposals: DeepDiveProposal[], run: DeepDiveRun): TraversalNode[]
function buildNavigationContext(proposalId: string, nodes: TraversalNode[], run: DeepDiveRun, syllabusPath: string): NavigationContext | null
function renderNavigationBlock(ctx: NavigationContext): string
function renderSyllabusContent(nodes: TraversalNode[], run: DeepDiveRun): string
function buildTreeFromNodes(nodes: TraversalNode[], rootTitle: string): TreeNode
function syllabusTitle(rootNotePath: string): string
function syllabusPath(rootNotePath: string, noteOutputFolder: string): string
function injectNavigationBlock(content: string, navBlock: string): string
```

Exported types: `DeepDiveProposal`, `DeepDiveRun`, `ExtractedTopic`, `QualityScore`, `DeepDiveProposalStatus`, `DeepDiveRunStatus`, `TraversalNode`, `NavigationContext`

Re-exported settings renderer: `renderDeepDiveSettings` (from `./settings-section`)

## Note Queue (#483)

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`. ONE acquisition site.

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `acceptProposal` (index.ts:151) | `queued.proposedPath` | `applyAccept(id, options)` | none |

- Key choice: `proposal.proposedPath` is the note the accept CREATES — also what `onNoteAccepted` (enrichment, REM) and `onOrganizeRequested` then target, so those follow-ups enqueue behind the accept instead of racing it.
- `applyAccept` (index.ts:155) re-loads the proposal so the double-accept guard (`status !== 'pending'`, index.ts:160) is evaluated UNDER the slot, not against a pre-wait snapshot.
- `updateRunNavigation` (index.ts:557) rewrites the syllabus note (index.ts:584) and every previously-accepted sibling note in the run (index.ts:596, index.ts:602). Those are OTHER notes and stay UNQUEUED — acquiring a second key while holding one is the lock-ordering case the contract forbids.
- `maybeAutoAcceptRun` (index.ts:208) loops over distinct proposals calling the PUBLIC `acceptProposal` (index.ts:214); each iteration takes a DIFFERENT key sequentially — not a nested acquisition. This is deliberately UNLIKE organize, whose `maybeAutoAccept` must call the private `applyAccept` because it runs inside a slot its caller already holds (`organize/AGENTS.md`). Do not "harmonize" the two: pointing deep-dive at `applyAccept` would skip a needed acquisition, and pointing organize at `acceptProposal` would self-deadlock.
- `rejectProposal` (index.ts:229) is unqueued: no note of its own, and its `updateRunNavigation(proposal.runId)` refresh only touches the same other-note writes as above.
- The generation loop (`deepDive`) is unqueued — it writes proposals to the store, not to vault notes; nothing exists at `proposedPath` until an accept.

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `DeepDiveModule` (index.ts:54), `buildDeepDivePath` (index.ts:693) | Module entry point and public API |
| `topic-analyzer.ts` | `TopicAnalyzer` (topic-analyzer.ts:11) | AI topic extraction; matches titles against included vault notes. `extractTopics(content, noteTitle, ancestorTopics, aiOpts?)` — `aiOpts` reaches `complete()` (#527) |
| `note-generator.ts` | `NoteGenerator` (note-generator.ts:9) | AI content generation for a topic given parent title+content. `generateContent(topic, sourceTitle, sourceContent, aiOpts?)` — `aiOpts` reaches `complete()` (#527) |
| `quality-scorer.ts` | `scoreQuality` (quality-scorer.ts:30) | Local heuristic scoring: topic count, word count, genericity, overlap, depth decay |
| `syllabus-navigator.ts` | navigation utilities (syllabus-navigator.ts:50 onward) | Traversal ordering, syllabus index, prev/next navigation blocks |
| `deep-dive-store.ts` | `DeepDiveStore` (deep-dive-store.ts:36) | JSON persistence for proposals and runs |
| `depth-selector-modal.ts` | `DepthSelectorModal` (depth-selector-modal.ts:7), `selectDepth` (:83), `MIN_DEPTH`, `MAX_DEPTH` (:4-5) | Modal for user to select recursion depth (1-6) |
| `settings-section.ts` | `renderDeepDiveSettings` (settings-section.ts:12) | Settings UI renderer (accordion key `deepDive`) |
| `types.ts` | -- | All deep-dive types, incl. the `SuggestDirectory` injection contract (types.ts:85; imports `AIRequestOptions` type from `../shared`) |

`syllabus-navigator.ts` also exports `wikiLink` (syllabus-navigator.ts:107) and `buildBreadcrumbs` (syllabus-navigator.ts:115); these are internal helpers and are NOT re-exported through `index.ts`.

## Dependency on `organize` module

`deep-dive` has NO `../organize` import. In `auto-organize` nesting mode, `buildAutoOrganizedPath` (index.ts:631) calls the injected `this.suggestDirectory(topicTitle, aiOpts)` (the proposal's `aiOpts`, #527) when it is non-null; a non-null directory becomes `normalizePath(`${directory}/${safeName}.md`)`, otherwise (null result, thrown error, or no callback wired) it falls back to `buildDeepDivePath` (nested mode, index.ts:649). The topic-extraction + directory-scoring + 0.6 score floor live on the organize side (`OrganizeModule.suggestDirectory`, `organize/index.ts:80`); the registry wires the two (`modules/registry.ts:111-116`).

## Data Flow

```
deepDive(file)  [private, called by command]
  Phase 1: Extract topics
    --> TopicAnalyzer.extractTopics(content, title, [], trackAiCache(scanUse))  [AI]
    --> filter new vs existing topics
    --> scanOp.finish(withCacheReport('Found N topics (X new, Y existing)' | 'No topics found', [scanUse]))  (#527)
  Phase 2a: Select depth
    --> selectDepth(app, defaultDepth)  [DepthSelectorModal]
  Phase 2b: User confirmation
  Phase 3: Recursive generation (BFS queue, checkpointed)
    --> checkpointManager.create(module: 'deep-dive', items: root topics)
    --> addDeferredTask('refresh-sidebar-view')
    for each topic in BFS queue:
      --> aiOpts = trackAiCache(cacheUse)   [one CacheUse per proposal, #527]
      --> NoteGenerator.generateContent(topic, parentTitle, parentContent, aiOpts)  [AI]
      --> buildProposedPath(title, rootFile, parentProposedPath, aiOpts)   [auto-organize mode only: AI]
      --> if depth < maxDepth: TopicAnalyzer.extractTopics(childContent, ..., aiOpts)  [AI]
      --> scoreQuality({title, childTopics, wordCount, depth, ancestors})
      --> DeepDiveStore.saveProposal()
      --> checkpointManager.completeItem(checkpoint, 'topic-<title>')
      --> if quality >= threshold && depth+1 < maxDepth: enqueue children
    --> DeepDiveStore.saveRun()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> on success: genOp.finish(withCacheReport(`Generated N proposals (depthSummary)`, cacheUses, 'proposal'), reviewAction({generated, shouldAutoAccept, openProposalView}))  [Review button only if generated && !shouldAutoAccept() (#366); opens via onOpenProposalView]
    --> on error: checkpointManager.discard()
    --> maybeAutoAcceptRun(run.proposalIds)  [if shouldAutoAccept()]

resumeFromCheckpoint(checkpoint)
  --> Deep dive cannot directly resume (recursive BFS state not serializable)
  --> Discards checkpoint, notifies user to re-run on source note
  --> Completed proposals from partial run are already saved

acceptProposal(id, options?)                            [public, index.ts:145]
  --> DeepDiveStore.loadProposal(id)  [null -> "Proposal not found"]
  --> noteQueue.run(proposal.proposedPath, () => applyAccept(id, options))   [#483]
        applyAccept(id, options?)                       [queue-free core, index.ts:155]
          --> re-load proposal (double-accept guard evaluated UNDER the slot)
          --> DeepDiveStore.updateProposalStatus('accepted')
          --> stripUnresolvedLinks(proposedContent, metadataCache, proposedPath)   [#581; unaccepted parent -> plain text]
          --> updateRunNavigation(runId, proposedPath, content)
            --> computeTraversalOrder(proposals, run)
            --> renderSyllabusContent() -> writeNote(syllabusPath)      [OTHER note, unqueued]
            --> for each accepted node: injectNavigationBlock() -> writeNote()
                                                                        [OTHER notes, unqueued]
          --> onNoteAccepted?.(proposedPath)  [post-op chain: enrichment, REM if deepDive.autoRemOnAccept (#581); enqueues behind this accept]
          --> onOrganizeRequested?.(file)  [triggers organize if deepDive.autoOrganizeOnAccept]

rejectProposal(id)                                      [unqueued, index.ts:229]
  --> DeepDiveStore.cascadeReject(id)  [rejects children too]
  --> updateRunNavigation(runId)  [refresh remaining notes]
```

## Path Building (nestingMode)

`DeepDiveNestingMode = 'nested' | 'flat' | 'auto-organize'`

| Mode | Behavior |
|------|----------|
| `nested` | Children placed in subfolder named after parent: `Deep Dives/ML/Neural Networks/Backprop.md` |
| `flat` | All notes in root subfolder: `Deep Dives/ML/Backprop.md` |
| `auto-organize` | Calls the injected `SuggestDirectory` callback (organize's `suggestDirectory`, score floor 0.6 applied there); falls back to nested when it is unwired, returns null, or throws |

## Key Types

```ts
interface ExtractedTopic {
  title: string
  description: string
  relevance: number
  existsInVault: boolean
  existingPath?: string
  relatedUrls: string[]
}

interface QualityScore {
  score: number         // 0-1; below qualityThreshold stops recursion
  topicCount: number
  wordCount: number
  isTooGeneric: boolean
  hasHighOverlap: boolean
  reasoning: string
}

interface DeepDiveProposal {
  id: string
  runId: string
  sourceNotePath: string
  topic: ExtractedTopic
  proposedPath: string
  proposedContent: string
  depth: number
  qualityScore: QualityScore
  childProposalIds: string[]
  createdAt: string
  status: 'pending' | 'accepted' | 'rejected'
}

interface DeepDiveRun {
  id: string
  rootNotePath: string
  maxDepth: number
  qualityThreshold: number
  proposalIds: string[]
  stats: { totalProposals: number; byDepth: Record<number, number>; earlyTerminations: number }
  createdAt: string
  status: 'in-progress' | 'completed' | 'cancelled'
}
```

## Commands Registered

Registered at runtime in `index.ts:100` and `index.ts:108` via `registrar.register(id, deepDive.enabled, ...)`. Declared with metadata in `commands/registry.ts:43-44`. Gate order: registry `status` (dev) -> flow membership (dev) -> `settings.deepDive.enabled` (user).

| Command ID | Name (registry.ts) | Callback | Context | Registry status | Runtime gate |
|------------|--------------------|----------|---------|-----------------|--------------|
| `deep-dive` | Deep dive current note | editorCallback | note | active | `settings.deepDive.enabled` |
| `clear-deep-dive` | Clear deep dive proposals | callback | global | disabled (dev kill switch) | `settings.deepDive.enabled` |

## Callouts

| Callout | Defined / used | Emitted by |
|---------|----------------|-----------|
| `synapse-nav` | `syllabus-navigator.ts:205` (`calloutHeaderLine`, written as `[!note|synapse-nav]`; `injectNavigationBlock` replaces either spelling via `calloutHeaderSource`, #554) | `renderNavigationBlock`; injected at the top of each accepted note body and replaced on every nav refresh |
| `synapse-deep-dive` | `shared/callouts.ts:18` (`CALLOUT_TYPES.deepDive`), command icon `commands/icons.ts:31` | registered callout type + command/brand icon; not written into note bodies by this module |

## Settings Keys

Path exclusion is centralized (#307): `settings.exclusions: ExclusionRule[]` consulted via `isPathExcluded(path, 'deep-dive', settings)` and `findMatchingRule`. There is no per-module `excludeFolders` key.

| Key | Type | Default |
|-----|------|---------|
| `settings.deepDive.enabled` | `boolean` | `true` |
| `settings.deepDive.proposalFolderPath` | `string` | `.synapse/deep-dive` |
| `settings.deepDive.maxDepth` | `number` | `3` |
| `settings.deepDive.qualityThreshold` | `number` | `0.4` |
| `settings.deepDive.maxNotesPerRun` | `number` | `50` |
| `settings.deepDive.noteOutputFolder` | `string` | `Deep Dives` |
| `settings.deepDive.nestingMode` | `DeepDiveNestingMode` | `'nested'` |
| `settings.deepDive.excludeTags` | `string[]` | `['no-deep-dive']` |
| `settings.deepDive.autoEnrichOnAccept` | `boolean` | `true` |
| `settings.deepDive.autoOrganizeOnAccept` | `boolean` | `false` |
| `settings.deepDive.autoRemOnAccept` | `boolean` | `true` (toggle "Auto-REM on accept", settings-section.ts:129-139; gated with `rem.enabled` by the pipeline post-op REM leg, #581) |
| `settings.autoAccept['deep-dive']` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | see `settings.ts` defaults |
| `settings.ai.voice` / `settings.ai.voiceCustom` | `VoiceMode` / `string` | `'neutral'` / `''` |

`NoteGenerator.generateContent` asks for plain prose with no `[[wikilinks]]` and a `tags`-only frontmatter (#581); the only deep-dive-written links are `parent:`, navigation and syllabus links to accepted notes. `NoteGenerator.generateContent` keeps the encyclopedic-tone rule and appends `voiceInstruction(settings.ai)` as the last rule, read per call (note-generator.ts:39, #540).

## Dependencies

In: `shared/` (NotificationManager, readNote, writeNote, wordCount, CheckpointManager, NoteOperationQueue, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, stripUnresolvedLinks, CacheUse, AIRequestOptions, ModuleDeps, FeatureModule, Checkpoint, CheckpointWorkItem, DeferredTask — see `index.ts:2-12`), `settings.ts` (SynapseSettings, DeepDiveNestingMode, `index.ts:4`), `commands/` (CommandRegistrar, `index.ts:5`). No feature-module import: organize's folder suggestion arrives as the constructor's `SuggestDirectory` callback.

Out: Nothing consumed by other feature modules. `modules/registry.ts:111-116` constructs the module with `built.organize.suggestDirectory` wrapped in a lambda.

## Error States

| Condition | Handling (index.ts) |
|-----------|---------------------|
| Note excluded by rule or excludeTag | `isExcluded` true -> info Notice naming the matched rule pattern; abort before any AI call (index.ts:252) |
| Empty/unreadable note | info Notice "Could not read note content"; abort (index.ts:265) |
| Topic extraction throws (Phase 1) | `scanOp.error(...)`; abort, no run created (index.ts:281) |
| Zero topics found / all already in vault | `scanOp.finish(withCacheReport('No topics found', [scanUse]))` or info Notice; abort (index.ts:286) |
| Depth modal dismissed / user declines confirm | info Notice "Deep dive cancelled"; abort (index.ts:305, index.ts:316) |
| Child topic extraction throws (per-node) | caught; `childTopics = []`, score from content alone, recursion stops for that branch (index.ts:438) |
| User cancels mid-generation (`genOp.cancelled`) | run.status='cancelled', `checkpointManager.discard`, info Notice; partial proposals stay saved (index.ts:507-513) |
| Generation loop throws | run.status='cancelled', `checkpointManager.discard`, `genOp.error(...)` (index.ts:540-542) |
| `acceptProposal` on missing proposal | info Notice "Proposal not found"; no-op BEFORE taking the queue slot (index.ts:147-148) |
| `applyAccept` on non-pending proposal | silent no-op (double-accept guard, re-checked under the slot) (index.ts:160) |
| `applyAccept` write failure | `notifyError`, then rethrows `Accept proposal failed: <msg>`; the `noteQueue.run` rejection propagates to the caller and still releases the slot (index.ts:195) |
| auto-organize callback unwired, returns null, or throws (incl. organize's < 0.6 score floor) | caught; falls back to `buildDeepDivePath` (nested) (index.ts:638-649) |

## Invariants / Gotchas

- The double-acceptance guard lives in `applyAccept`, not `acceptProposal`: the proposal is re-loaded inside the queue slot and the call no-ops if `proposal.status !== 'pending'`, so a pre-wait snapshot can never authorize a second note creation (index.ts:160).
- `rejectProposal` cascades to all child proposals (`DeepDiveStore.cascadeReject`).
- Checkpoint item IDs use the stable format `'topic-<title>'` (C2) so completed items survive restart.
- Deep-dive checkpoint cannot be resumed via BFS reconstruction — `resumeFromCheckpoint` discards the checkpoint and prompts user to re-run.
- Auto-accept runs AFTER the full generation loop completes, in creation order (parents before children) so navigation resolves correctly.
- Syllabus note path: `syllabusPath(rootNotePath, deepDive.noteOutputFolder)` — trashed (not hard-deleted) if all proposals in a run are rejected.
- `onNoteAccepted` and `onOrganizeRequested` fire even under `silent: true` (batch auto-accept); they are the intended acyclic follow-on chain. They fire from inside `applyAccept` while it still holds `proposedPath`'s queue slot, but `main.ts` dispatches both through `fireAndForget` (never awaited), so they simply enqueue behind the accept and read the note it just wrote (#483).

## Tests

| File | Covers |
|------|--------|
| `topic-analyzer.test.ts` | TopicAnalyzer.extractTopics |
| `note-generator.test.ts` | NoteGenerator.generateContent |
| `quality-scorer.test.ts` | scoreQuality heuristics |
| `syllabus-navigator.test.ts` | computeTraversalOrder, buildNavigationContext, render functions |
| `deep-dive-store.test.ts` | DeepDiveStore persistence and cascadeReject |
| `depth-selector-modal.test.ts` | DepthSelectorModal, selectDepth |
| `auto-accept.test.ts` | Auto-accept flow (#228) |
| `review-toast.test.ts` | Review completion-toast gate (#366) |
| `cache-report.test.ts` | #527 finish wording: topic-scan hit/miss, no-topics hit, generation-run aggregate hit/miss |
| `settings-section.test.ts` | Settings UI renderer |
