---
last-updated: 2026-11-17
---

# deep-dive module

Recursively explores a note by AI-extracting sub-topics and generating child notes, using a local quality score to bound recursion depth, and emitting a syllabus index plus inter-note navigation under a resumable checkpoint.

## Public API (`index.ts`)

```ts
class DeepDiveModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onNoteAccepted: ((filePath: string, ctx?: SourceContext) => void) | null   // index.ts:92
  onOrganizeRequested: ((file: TFile) => void) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean, suggestDirectory?: SuggestDirectory)   // index.ts:120; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504); suggestDirectory = organize's folder suggestion, injected by modules/registry.ts:110-116 (null -> nested placement only)

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<DeepDiveProposal[]>                          // index.ts:155
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>                 // index.ts:160
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<boolean>   // index.ts:185; true when the note was created
  rejectProposal(id: string): Promise<void>                                   // index.ts:269
  run(notePath: string, options?: DeepDiveRunOptions): Promise<DeepDiveOutcome>   // index.ts:318; the command flow with no depth picker or confirm (#623)
  regenerate(target: DeepDiveRegenerateTarget, job?: DeepDiveJobOptions): Promise<DeepDiveOutcome>   // index.ts:337; rewrite one note from its topic (#623); job (#626) tags the op and joins its AI options
  listContinuableRuns(): Promise<ContinuableDeepDiveRun[]>                       // index.ts:537; DeepDiveStore.loadCappedRuns() (endReason 'cap' with queued topics), newest first, minus any continuing now (#625)
  continueRun(runId: string, options?: Omit<DeepDiveRunOptions, 'depth'>): Promise<DeepDiveOutcome>   // index.ts:556; generate a capped run's queue under a fresh cap (#625)
  discardContinuation(runId: string): Promise<boolean>                          // index.ts:585; drop a capped run's queue (sidebar Discard); endReason stays 'cap'
}

// types.ts; barrel-exported (#623)
interface DeepDiveRunOptions { depth?: number; maxNotes?: number; autoAccept?: boolean; jobId?: string; ai?: AIRequestOptions }   // jobId (#624): tags the run's ops with jobOpId; ai (#626): joined into every model call of the run (combineAIOptions) — the public API's call cap, usage meter and external generator; neither persisted
type DeepDiveJobOptions = Pick<DeepDiveRunOptions, 'jobId' | 'ai'>   // #626; regenerate's job argument; barrel type export   // depth clamped to MIN_DEPTH..MAX_DEPTH; each defaults to its setting
interface DeepDiveOutcome extends OperationOutcome { runId?: string }   // shared OperationOutcome (#624): status completed | failed | cancelled (a cancelled run is `cancelled`), message, proposalIds, writtenPaths, cacheUse
type DeepDiveRegenerateTarget = { proposalId: string } | { notePath: string }

// types.ts:156 — NOT barrel-exported (index.ts:62-77 exports only the proposal/run/topic and navigator types); the registry passes an inline lambda
type SuggestDirectory = (text: string, aiOpts?: AIRequestOptions) => Promise<string | null>

function buildDeepDivePath(               // index.ts:961; file name = private safeNoteName(topicTitle) (index.ts:942)
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
function renderNavigationBlock(ctx: NavigationContext, linkpathFor: LinkpathFor): string
function renderSyllabusContent(nodes: TraversalNode[], run: DeepDiveRun, linkpathFor: LinkpathFor): string
function buildTreeFromNodes(nodes: TraversalNode[], rootTitle: string): TreeNode
function syllabusTitle(rootNotePath: string): string
function syllabusPath(rootNotePath: string, noteOutputFolder: string): string
function injectNavigationBlock(content: string, navBlock: string): string
```

Exported types (all declared in `types.ts`; `TraversalNode` `types.ts:162`, `NavigationContext` `types.ts:178`): `ContinuableDeepDiveRun`, `DeepDiveEndReason`, `DeepDiveProposal`, `DeepDiveRun`, `ExtractedTopic`, `QualityScore`, `DeepDiveProposalStatus`, `DeepDiveRunStatus`, `TraversalNode`, `NavigationContext`

Re-exported settings renderer: `renderDeepDiveSettings` (from `./settings-section`)

## Note Queue (#483)

Serialization contract: see `src/shared/AGENTS.md` → `note-operation-queue.ts`. ONE acquisition site.

| Site | Key | Wrapped core | onWait |
|------|-----|--------------|--------|
| `acceptProposal` (index.ts:191) | `queued.proposedPath` | `applyAccept(id, options)` | none |
| `regenerate` (index.ts:359) | `proposal.proposedPath` | `applyRegenerated(id, content)` (index.ts:376) -> `rewriteAcceptedNote` (index.ts:419) when accepted | none |

- Key choice: `proposal.proposedPath` is the note the accept CREATES — also what `onNoteAccepted` (enrichment, REM) and `onOrganizeRequested` then target, so those follow-ups enqueue behind the accept instead of racing it.
- `applyAccept` (index.ts:194) re-loads the proposal so the double-accept guard (`status !== 'pending'`, index.ts:200) is evaluated UNDER the slot, not against a pre-wait snapshot.
- `updateRunNavigation` (index.ts:820) rewrites the syllabus note (index.ts:847; trashed instead when the run has no accepted note, index.ts:838) and every accepted note in the run (index.ts:859, index.ts:865). Those are OTHER notes and stay UNQUEUED — acquiring a second key while holding one is the lock-ordering case the contract forbids.
- `autoAcceptRun` (index.ts:249) loops over distinct proposals calling the PUBLIC `acceptProposal` (index.ts:255); each iteration takes a DIFFERENT key sequentially — not a nested acquisition. This is deliberately UNLIKE organize, whose `maybeAutoAccept` must call the private `applyAccept` because it runs inside a slot its caller already holds (`organize/AGENTS.md`). Do not "harmonize" the two: pointing deep-dive at `applyAccept` would skip a needed acquisition, and pointing organize at `acceptProposal` would self-deadlock.
- `rejectProposal` (index.ts:269) is unqueued: no note of its own, and its `updateRunNavigation(proposal.runId)` refresh only touches the same other-note writes as above.
- The generation loop (`deepDive`) is unqueued — it writes proposals to the store, not to vault notes; nothing exists at `proposedPath` until an accept.

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `DeepDiveModule` (index.ts:90), `buildDeepDivePath` (index.ts:961) | Module entry point and public API |
| `topic-analyzer.ts` | `TopicAnalyzer` (topic-analyzer.ts:11) | AI topic extraction; matches titles against included vault notes. `extractTopics(content, noteTitle, ancestorTopics, aiOpts?)` — `aiOpts` reaches `complete()` (#527) |
| `note-generator.ts` | `NoteGenerator` (note-generator.ts:10; `constructor(getSettings, linkpathFor: LinkpathFor)`) | AI content generation for a topic given parent title+content. `generateContent(topic, sourceTitle, sourcePath, sourceContent, aiOpts?)` — `aiOpts` reaches `complete()` (#527); `sourcePath` is the target of the injected `parent:` link, written via `wikiLink` with `\` and `"` escaped for the quoted YAML value (#607) |
| `quality-scorer.ts` | `scoreQuality` (quality-scorer.ts:30) | Local heuristic scoring: topic count, word count, genericity, overlap, depth decay |
| `syllabus-navigator.ts` | navigation utilities (syllabus-navigator.ts:11 onward) | Traversal ordering, syllabus index, prev/next navigation blocks; its `TraversalNode` / `NavigationContext` types are imported from `types.ts` |
| `deep-dive-store.ts` | `DeepDiveStore` (deep-dive-store.ts:49) | JSON persistence for proposals and runs (`loadAllRuns`, deep-dive-store.ts:237; `loadCappedRuns`, deep-dive-store.ts:204, #625: lists the run folder each call; reads every run file only when the listing gained a file (first call, or one synced in), else only watched runs, i.e. capped or in-progress so a synced run that became capped is seen; `saveRun` keeps the set current, including saves made during a build; concurrent calls share one build); run ids gated by the private `isSafeRunId` (`/^[A-Za-z0-9_-]+$/`, deep-dive-store.ts:42) before they become a file name |
| `depth-selector-modal.ts` | `DepthSelectorModal` (depth-selector-modal.ts:7), `selectDepth` (:83), `MIN_DEPTH`, `MAX_DEPTH` (:4-5) | Modal for user to select recursion depth (1-6) |
| `settings-section.ts` | `renderDeepDiveSettings` (settings-section.ts:12) | Settings UI renderer (accordion key `deepDive`) |
| `types.ts` | -- | All deep-dive types, incl. the `SuggestDirectory` injection contract (types.ts:156; imports `AIRequestOptions` type from `../shared`) and the navigator's `TraversalNode` (types.ts:162) / `NavigationContext` (types.ts:178) |

`syllabus-navigator.ts` also exports `wikiLink` (syllabus-navigator.ts:66) and `buildBreadcrumbs` (syllabus-navigator.ts:76); these are internal helpers and are NOT re-exported through `index.ts`. `wikiLink(path, linkpathFor)` writes `[[linkpath|Note]]` (`[[Note]]` when the linkpath is the basename). `DeepDiveModule` passes `shared` `linkpathFor(app, path)`: bare while the basename is unique (so a moved note keeps resolving), folder-qualified once another note shares it, so nav, syllabus and `parent:` links resolve to their own run when basenames collide across runs (#607); a qualified path holding `#` `^` `|` `[` `]` falls back to the bare basename; `injectNavigationBlock` matches the nav callout by header, so bare-link blocks from older runs are replaced the same way.

## Dependency on `organize` module

`deep-dive` has NO `../organize` import. In `auto-organize` nesting mode, `buildAutoOrganizedPath` (index.ts:894) calls the injected `this.suggestDirectory(topicTitle, aiOpts)` (the proposal's `aiOpts`, #527) when it is non-null; a non-null directory becomes `normalizePath(`${directory}/${safeName}.md`)` with `safeName = safeNoteName(topicTitle)` (index.ts:905), otherwise (null result, thrown error, or no callback wired) it falls back to `buildDeepDivePath` (nested mode, index.ts:912). The topic-extraction + directory-scoring + 0.6 score floor live on the organize side (`OrganizeModule.suggestDirectory`, `organize/index.ts:82`); the registry wires the two (`modules/registry.ts:110-116`).

## Data Flow

```
deepDive(file)  [private, called by command; phase 1 = prepareRun, phase 3 = startRun, both shared with run()]
  Phase 1: Extract topics
    --> TopicAnalyzer.extractTopics(content, title, [], trackAiCache(scanUse))  [AI]
    --> filter new vs existing topics
    --> scanOp.finish(withCacheReport('Found N topics (X new, Y existing)' | 'No topics found', [scanUse]))  (#527)
  Phase 2a: Select depth
    --> selectDepth(app, defaultDepth)  [DepthSelectorModal]
  Phase 2b: User confirmation
  Phase 3: Recursive generation (BFS queue, checkpointed)
    --> run.pending = { tasks: DeepDiveTask[] (one per new root topic), processedCount: 0 }; saveRun(run)
    --> createRunCheckpoint(run, file, tasks) (index.ts:515): checkpointManager.create(module: 'deep-dive', items: the tasks, metadata: { runId, rootNotePath }) + addDeferredTask('refresh-sidebar-view')   [shared with continueRun]
    --> runGeneration(rootFile, rootContent, run, checkpointId, job = { jobId?, ai? })   [shared with resumeFromCheckpoint and continueRun; sets status 'in-progress' and clears endReason on entry]
    --> watchMobilePause(): Platform.isMobile only; hidden -> visible during the loop -> info 'Deep dive paused while Obsidian was in the background — resuming' (listener removed in finally)
    for each task in run.pending.tasks (source = root note, or parent proposal via parentProposalId; rejected/missing parent -> task skipped):
      --> aiOpts = combineAIOptions(trackAiCache(cacheUse), job.ai)   [one CacheUse per proposal, #527; job.ai from a public-API job, #626]
      --> NoteGenerator.generateContent(topic, parentTitle, parentPath, parentContent, combineAIOptions(aiOpts, { onResponse }))  [AI; the reply's AIResponseInfo becomes proposal.generation, #625]
      --> buildProposedPath(title, rootFile, parentProposedPath, aiOpts)   [auto-organize mode only: AI]
      --> if depth < maxDepth: TopicAnalyzer.extractTopics(childContent, ..., aiOpts)  [AI]
      --> scoreQuality({title, childTopics, wordCount, depth, ancestors})
      --> DeepDiveStore.saveProposal()
      --> checkpointManager.completeItem(checkpoint, 'topic-<title>')
      --> if quality >= threshold && depth+1 < maxDepth: enqueue children (new topics only)
      --> DeepDiveStore.saveRun(run)   [persists the remaining queue after every proposal]
    --> on cancel (genOp.cancelled after the loop, or in the catch when a cancel failed the model call in flight, e.g. an external request, #626): endCancelled(): status and endReason 'cancelled', run.pending deleted, saveRun, checkpointManager.discard(), info 'Deep dive cancelled'
    --> endReason = tasks left ? 'cap' : 'exhausted' (#625); status 'completed'; run.pending deleted unless 'cap'; DeepDiveStore.saveRun()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> on success: genOp.finish(withCacheReport(`Generated N proposals (depthSummary)[ -- stopped at the M-note cap with K topics left]`, cacheUses, 'proposal'), action)
          action = 'cap' ? { label: 'Continue' -> continueRun(run.id) } : reviewAction({generated, shouldAutoAccept, openProposalView})  [Review only if generated && !shouldAutoAccept() (#366)]
    --> on error (not cancelled): endReason 'error'; run stays 'in-progress' with run.pending; checkpoint stays ACTIVE (resumable); genOp.error('Deep dive interrupted -- ...')
    --> autoAcceptRun(generatedIds)  [this pass's proposals; if run.autoAccept ?? shouldAutoAccept(); returns created paths]

resumeFromCheckpoint(checkpoint)
  --> store.loadRun(checkpoint.metadata.runId); re-read root note
  --> run.pending present + root note readable: runGeneration(...) continues the queue under the same checkpoint
  --> otherwise (pre-resume checkpoint, root note gone): info Notice, checkpointManager.discard()

continueRun(runId, options)   [public; toast Continue, sidebar "Capped deep dives" banner, api.deepDive.continue] (#625)
  --> refuse (info toast + failed outcome, nothing written): unknown run; already continuing (private `continuing` Set); endReason !== 'cap' or empty queue; root note missing (toast points at the sidebar's Discard)
  --> pending.processedCount = 0 (fresh cap = options.maxNotes ?? run.maxNotes ?? maxNotesPerRun); options.maxNotes / autoAccept persist on the run
  --> createRunCheckpoint(run, rootFile, pending.tasks); runGeneration(..., options)   [jobId + ai, #626; same run id; outcome.proposalIds = this pass only; auto-accept covers this pass's generatedIds only, so first-pass proposals left pending stay pending]

acceptProposal(id, options?)                            [public, index.ts:185]
  --> DeepDiveStore.loadProposal(id)  [null -> "Proposal not found"]
  --> noteQueue.run(proposal.proposedPath, () => applyAccept(id, options))   [#483]
        applyAccept(id, options?)                       [queue-free core, index.ts:194]
          --> re-load proposal (double-accept guard evaluated UNDER the slot)
          --> assertVaultRelativePath(proposal.proposedPath)   [index.ts:203; throws before the status update]
          --> DeepDiveStore.updateProposalStatus('accepted')
          --> stripUnresolvedLinks(proposedContent, metadataCache, proposedPath)   [#581; unaccepted parent -> plain text]
          --> updateRunNavigation(runId, proposedPath, content)
            --> computeTraversalOrder(proposals, run)
            --> renderSyllabusContent() -> writeNote(syllabusPath)      [OTHER note, unqueued]
            --> for each accepted node: injectNavigationBlock() -> writeNote()
                                                                        [OTHER notes, unqueued]
          --> onNoteAccepted?.(proposedPath)  [post-op chain: enrichment, REM if deepDive.autoRemOnAccept (#581); enqueues behind this accept]
          --> onOrganizeRequested?.(file)  [triggers organize if deepDive.autoOrganizeOnAccept]

rejectProposal(id)                                      [unqueued, index.ts:269]
  --> DeepDiveStore.cascadeReject(id)  [rejects children too]
  --> updateRunNavigation(runId)  [refresh remaining notes]
```

## Headless verbs (#623)

```
run(notePath, options)           [public; api.deepDive.run]
  --> prepareRun(file, { jobId?, ai? }): same exclusion / read / topic-extraction stops as the command, each toasted; returns { ok: false, message } instead of opening anything; a scan op cancelled during extraction (or whose cancel failed the extraction call, #626) stops it ('Deep dive cancelled') before any run or checkpoint exists, flagged `cancelled: true` so `run()` returns status 'cancelled'
  --> startRun(file, content, newTopics, { depth: clampDepth(options.depth ?? maxDepth), maxNotes?, autoAccept? })   [shared with the command after its modals]
  --> runGeneration returns DeepDiveOutcome { ..., endReason, remainingTopics (when 'cap') }; cap = run.maxNotes ?? maxNotesPerRun; auto-accept = run.autoAccept ?? shouldAutoAccept()
  --> autoAcceptRun(proposalIds) returns the created paths -> outcome.writtenPaths

regenerate(target, job?)         [public; api.deepDive.regenerate]
  --> findProposal: by id, or newest non-rejected proposal with proposedPath === notePath
  --> rejected, or accepted with no file at proposedPath (renamed / moved / deleted since accept) -> ok: false, no AI call
  --> source = sourceNotePath read from the vault, else the run's non-rejected proposal at that path (its proposedContent)
  --> NoteGenerator.generateContent(topic, sourceTitle, sourceNotePath, sourceContent, combineAIOptions(trackAiCache(use), { bypassCache: true, onResponse }, job.ai))   [always a fresh reply; its AIResponseInfo replaces proposal.generation]
  --> noteQueue.run(proposedPath, applyRegenerated) (index.ts:376): re-loads the proposal UNDER the slot, so an accept that landed mid-generation is honored
        rejected / removed meanwhile -> ok: false, nothing written
        accepted -> rewriteAcceptedNote: vault.process(mergeRegeneratedNote(existing, stripUnresolvedLinks(generated)))
          regenerate.ts mergeRegeneratedNote: note's own frontmatter + findNavigationBlock (syllabus-navigator.ts:335) + new body (generated frontmatter dropped) + every ENRICHMENT_START..ENRICHMENT_END block, in that order
        then proposal.proposedContent replaced (pending or accepted)
  --> op id `deep-dive-regenerate-<proposalId>` (+ `@job:<jobId>`, #626) (kind deep-dive, target proposedPath)
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
  generation?: AIResponseInfo   // provider, wire model, stopReason, usage, cached of the note's generating call (#625); absent on older proposals
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
  endReason?: DeepDiveEndReason   // types.ts:71; 'cap' | 'exhausted' | 'cancelled' | 'error'; absent while running and on pre-#625 runs
  pending?: DeepDivePendingWork   // kept on 'cap' (continueRun) and 'error' (resume); deleted otherwise
  maxNotes?: number     // per-run cap from run(); absent = deepDive.maxNotesPerRun (read again on resume)
  autoAccept?: boolean  // per-run auto-accept from run(); absent = autoAccept['deep-dive']
}

interface ContinuableDeepDiveRun {   // types.ts:128 (#625)
  runId: string; rootNotePath: string; remainingTopics: number; totalProposals: number; createdAt: string
}
```

## Commands Registered

Registered at runtime in `index.ts:138` and `index.ts:146` via `registrar.register(id, deepDive.enabled, ...)`. Declared with metadata in `commands/registry.ts:43-44`. Gate order: registry `status` (dev) -> flow membership (dev) -> `settings.deepDive.enabled` (user).

| Command ID | Name (registry.ts) | Callback | Context | Registry status | Runtime gate |
|------------|--------------------|----------|---------|-----------------|--------------|
| `deep-dive` | Deep dive current note | editorCallback | note | active | `settings.deepDive.enabled` |
| `clear-deep-dive` | Clear deep dive proposals | callback | global | disabled (dev kill switch) | `settings.deepDive.enabled` |

## Callouts

| Callout | Defined / used | Emitted by |
|---------|----------------|-----------|
| `synapse-nav` | `syllabus-navigator.ts:166` (`calloutHeaderLine`, written as `[!note|synapse-nav]`; `injectNavigationBlock` replaces either spelling via `calloutHeaderSource`, #554) | `renderNavigationBlock`; injected at the top of each accepted note body and replaced on every nav refresh |
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
| `settings.deepDive.autoRemOnAccept` | `boolean` | `true` (toggle "Auto-REM on accept", settings-section.ts:129-140; gated with `rem.enabled` by the pipeline post-op REM leg, #581) |
| `settings.deepDive.agentBilling` | `'plugin-key' \| 'external'` | `'plugin-key'` (toggle "Agents generate the text", settings-section.ts:154; read only by `api/` `defaultBilling`, overridden per call; commands always use the key, #626) |
| `settings.autoAccept['deep-dive']` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | see `settings.ts` defaults |
| `settings.ai.voice` / `settings.ai.voiceCustom` | `VoiceMode` / `string` | `'neutral'` / `''` |

`NoteGenerator.generateContent` asks for plain prose with no `[[wikilinks]]` and a `tags`-only frontmatter (#581); the only deep-dive-written links are `parent:`, navigation and syllabus links to accepted notes. `NoteGenerator.generateContent` keeps the encyclopedic-tone rule and appends `voiceInstruction(settings.ai)` as the last rule, read per call (note-generator.ts:42, #540).

## In-Progress Rows (#577)

`startOperation(label, id, { kind: 'deep-dive', target })` registers a cancellable unified-sidebar row (`NotificationManager.inProgress`).

| Op id | Site | Target |
|-------|------|--------|
| `deep-dive-scan-<path>` (+ `@job:<jobId>` under a public-API job, #624) | `index.ts:447` | root note path |
| `deep-dive-regenerate-<id>` (+ `@job:<jobId>` under a public-API job, #626) | `index.ts:351` | proposal's `proposedPath` |
| `deep-dive-generate-<runId>` (+ `@job:<jobId>` under a public-API job, #624) | `index.ts:607` | root note path (one row per run, so parallel runs keep their own progress and Cancel) |

## Dependencies

In: `shared/` (NotificationManager, readNote, writeNote, wordCount, CheckpointManager, NoteOperationQueue, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, reviewAction, trackAiCache, withCacheReport, stripUnresolvedLinks, assertVaultRelativePath, combineAIOptions, CacheUse, AIRequestOptions, ModuleDeps, FeatureModule, Checkpoint, CheckpointWorkItem, DeferredTask, SourceContext, extractUrls — see `index.ts:2-12`), `settings.ts` (SynapseSettings, DeepDiveNestingMode, `index.ts:4`), `commands/` (CommandRegistrar, `index.ts:5`). No feature-module import: organize's folder suggestion arrives as the constructor's `SuggestDirectory` callback.

Out: Nothing consumed by other feature modules. `modules/registry.ts:110-116` constructs the module with `built.organize.suggestDirectory` wrapped in a lambda.

## Error States

| Condition | Handling (index.ts) |
|-----------|---------------------|
| Note excluded by rule or excludeTag | `isExcluded` true -> info Notice naming the matched rule pattern; abort before any AI call (index.ts:432) |
| Empty/unreadable note | info Notice "Could not read note content"; abort (index.ts:443) |
| Topic extraction throws (Phase 1) | `scanOp.error(...)`; abort, no run created (index.ts:458) |
| Zero topics found / all already in vault | `scanOp.finish(withCacheReport('No topics found', [scanUse]))` or info Notice; abort (index.ts:465) |
| Depth modal dismissed / user declines confirm | info Notice "Deep dive cancelled"; abort (index.ts:295, index.ts:305); `run()` never opens either |
| Child topic extraction throws (per-node) | caught; `childTopics = []`, score from content alone, recursion stops for that branch (index.ts:657) |
| User cancels mid-generation (`genOp.cancelled`) | run.status='cancelled', `checkpointManager.discard`, info Notice; partial proposals stay saved (index.ts:720-727) |
| Run reaches its note cap with topics left (#625) | `endReason: 'cap'`, status `completed`, `run.pending` kept; finish toast names the cap and the topics left with a Continue action; listed by `listContinuableRuns` |
| Generation loop throws (e.g. iOS backgrounding drops the connection after `safeRequest`'s retries) | `endReason: 'error'`; run stays `in-progress` with `run.pending`, checkpoint kept active, `genOp.error('Deep dive interrupted -- ...')`; resume via `resumeFromCheckpoint` |
| `acceptProposal` on missing proposal | info Notice "Proposal not found"; no-op BEFORE taking the queue slot (index.ts:187-189) |
| `applyAccept` on non-pending proposal | silent no-op (double-accept guard, re-checked under the slot) (index.ts:200) |
| `applyAccept` on a stored `proposedPath` that is empty, absolute, or has a `..` segment or null byte | `assertVaultRelativePath` throws (index.ts:203) before the status update and any write; proposal stays `pending`; same `notifyError` + rethrow as a write failure |
| `applyAccept` write failure | `notifyError`, then rethrows `Accept proposal failed: <msg>`; the `noteQueue.run` rejection propagates to the caller and still releases the slot (index.ts:236-237) |
| `DeepDiveStore.saveRun` with a run id outside `/^[A-Za-z0-9_-]+$/` | throws `Invalid deep dive run id` (deep-dive-store.ts:185); nothing written |
| `DeepDiveStore.loadRun` with an unsafe id (e.g. a tampered `checkpoint.metadata.runId`) | returns `null` (deep-dive-store.ts:198); no file read |
| auto-organize callback unwired, returns null, or throws (incl. organize's < 0.6 score floor) | caught; falls back to `buildDeepDivePath` (nested) (index.ts:901-912) |

## Invariants / Gotchas

- The double-acceptance guard lives in `applyAccept`, not `acceptProposal`: the proposal is re-loaded inside the queue slot and the call no-ops if `proposal.status !== 'pending'`, so a pre-wait snapshot can never authorize a second note creation (index.ts:200).
- File/folder names from AI topic titles go through the private `safeNoteName` (index.ts:942): path separators and `: * ? " < > |` become `-`, leading dots are stripped (no `..` segment, no hidden file), empty result -> `'Untitled'`. Both path builders use it (index.ts:905, index.ts:967).
- Run ids read back from proposals or checkpoints never reach a path unchecked: `saveRun` / `loadRun` gate them with `isSafeRunId` (deep-dive-store.ts:42, :185, :198).
- Stored paths are re-validated at accept: `applyAccept` runs `assertVaultRelativePath(proposal.proposedPath)` (index.ts:203) on the path read back from the proposal JSON before it writes.
- `rejectProposal` cascades to all child proposals (`DeepDiveStore.cascadeReject`).
- Checkpoint item IDs use the stable format `'topic-<title>'` (C2) so completed items survive restart.
- Resume state lives in `DeepDiveRun.pending` (`types.ts`), not checkpoint metadata; tasks reference the parent proposal by id instead of copying its content.
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
| `headless-run.test.ts` | `run` (no modal, note cap, depth clamp, autoAccept override, missing note) per-run cap kept on resume, per-run op id, command asks depth before confirm; end reasons cap / exhausted / error, queue kept on cap, `generation` recorded; job AI options joined into every call, cancel failing the call in flight ends as cancelled (generation and extraction) (#626); `continueRun` (fresh cap, new cap, list + discard, refusals, toast Continue) (#625); `regenerate` (job op tag + joined AI options with bypassCache, #626; pending, accepted merge, fresh model call, missing accepted note, accept during generation, rejected refusal, parent-proposal fallback) (#623) |
| `regenerate.test.ts` | `mergeRegeneratedNote` keeps frontmatter, nav (both spellings) and every enrichment block |
