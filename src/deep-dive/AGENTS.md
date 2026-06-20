---
last-updated: 2026-06-19
---

# deep-dive module

Recursively explores a note by extracting topics and generating child notes via AI. Uses quality scoring to control recursion depth. Generates a syllabus index and inter-note navigation. Supports checkpointed generation for resumability.

## Public API (`index.ts`)

```ts
class DeepDiveModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onNoteAccepted: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null
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
  getPendingProposals(): Promise<DeepDiveProposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
}

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
function buildTreeFromNodes(nodes: TraversalNode[]): TreeNode[]
function syllabusTitle(rootNotePath: string): string
function syllabusPath(rootNotePath: string, outputFolder: string): string
function injectNavigationBlock(content: string, navBlock: string): string
```

Exported types: `DeepDiveProposal`, `DeepDiveRun`, `ExtractedTopic`, `QualityScore`, `DeepDiveProposalStatus`, `DeepDiveRunStatus`, `TraversalNode`, `NavigationContext`

Re-exported settings renderer: `renderDeepDiveSettings` (from `./settings-section`)

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `DeepDiveModule`, `buildDeepDivePath` | Module entry point and public API |
| `topic-analyzer.ts` | `TopicAnalyzer` | AI topic extraction; checks vault for existing notes |
| `note-generator.ts` | `NoteGenerator` | AI content generation for a topic given parent context |
| `quality-scorer.ts` | `scoreQuality` | Local heuristic scoring: word count, child topics, overlap, genericity |
| `syllabus-navigator.ts` | Navigation utilities | Traversal ordering, syllabus index, prev/next navigation blocks |
| `deep-dive-store.ts` | `DeepDiveStore` | JSON persistence for proposals and runs |
| `depth-selector-modal.ts` | `DepthSelectorModal`, `selectDepth`, `MIN_DEPTH`, `MAX_DEPTH` | Modal for user to select recursion depth (1-6) |
| `settings-section.ts` | `renderDeepDiveSettings` | Settings UI renderer |
| `types.ts` | -- | All deep-dive types |

## Dependency on `organize` module

`deep-dive` imports `ContentAnalyzer` and `DirectoryMatcher` directly from `../organize` (the public barrel). These are used only in `auto-organize` nesting mode: `buildAutoOrganizedPath` calls `ContentAnalyzer.extractTopics(topicTitle, [])` to get topic labels, then passes a synthetic `ContentAnalysis` to `DirectoryMatcher.scoreDirectories`. Falls back to `buildDeepDivePath` (nested mode) on AI failure or low score.

Note: `ContentAnalyzer.extractTopics` in the organize module takes `(body: string, tags: string[])`, not the same signature as `TopicAnalyzer.extractTopics` in this module.

## Data Flow

```
deepDive(file)  [private, called by command]
  Phase 1: Extract topics
    --> TopicAnalyzer.extractTopics(content, title, [])  [AI]
    --> filter new vs existing topics
  Phase 2a: Select depth
    --> selectDepth(app, defaultDepth)  [DepthSelectorModal]
  Phase 2b: User confirmation
  Phase 3: Recursive generation (BFS queue, checkpointed)
    --> checkpointManager.create(module: 'deep-dive', items: root topics)
    --> addDeferredTask('refresh-sidebar-view')
    for each topic in BFS queue:
      --> NoteGenerator.generateContent(topic, parentTitle, parentContent)  [AI]
      --> buildProposedPath(title, rootFile, parentProposedPath)
      --> if depth < maxDepth: TopicAnalyzer.extractTopics(childContent)  [AI]
      --> scoreQuality({title, childTopics, wordCount, depth, ancestors})
      --> DeepDiveStore.saveProposal()
      --> checkpointManager.completeItem(checkpoint, 'topic-<title>')
      --> if quality >= threshold && depth+1 < maxDepth: enqueue children
    --> DeepDiveStore.saveRun()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> on error: checkpointManager.discard()
    --> maybeAutoAcceptRun(run.proposalIds)  [if shouldAutoAccept()]

resumeFromCheckpoint(checkpoint)
  --> Deep dive cannot directly resume (recursive BFS state not serializable)
  --> Discards checkpoint, notifies user to re-run on source note
  --> Completed proposals from partial run are already saved

acceptProposal(id, options?)
  --> DeepDiveStore.updateProposalStatus('accepted')
  --> updateRunNavigation(runId, proposedPath, proposedContent)
    --> computeTraversalOrder(proposals, run)
    --> renderSyllabusContent() -> writeNote(syllabusPath)
    --> for each accepted node: injectNavigationBlock() -> writeNote()
  --> onNoteAccepted?.(proposedPath)  [triggers enrichment]
  --> onOrganizeRequested?.(file)  [triggers organize if deepDive.autoOrganizeOnAccept]

rejectProposal(id)
  --> DeepDiveStore.cascadeReject(id)  [rejects children too]
  --> updateRunNavigation(runId)  [refresh remaining notes]
```

## Path Building (nestingMode)

`DeepDiveNestingMode = 'nested' | 'flat' | 'auto-organize'`

| Mode | Behavior |
|------|----------|
| `nested` | Children placed in subfolder named after parent: `Deep Dives/ML/Neural Networks/Backprop.md` |
| `flat` | All notes in root subfolder: `Deep Dives/ML/Backprop.md` |
| `auto-organize` | Uses organize module's `ContentAnalyzer` + `DirectoryMatcher`; falls back to nested on failure or score < 0.6 |

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

| Command ID | Enabled When | Description |
|------------|-------------|-------------|
| `deep-dive` | `settings.deepDive.enabled` | Deep dive into current note |
| `clear-deep-dive` | `settings.deepDive.enabled` | Clear all deep dive proposals |

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
| `settings.autoAccept['deep-dive']` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | see `settings.ts` defaults |

## Dependencies

In: `shared/` (NotificationManager, readNote, writeNote, wordCount, CheckpointManager, generateId, fireAndForget, isPathExcluded, matchesExcludeTag, findMatchingRule, Checkpoint, CheckpointWorkItem, DeferredTask), `organize/` (ContentAnalyzer, DirectoryMatcher — auto-organize mode only), `settings.ts` (SynapseSettings, DeepDiveNestingMode), `commands.ts` (CommandRegistrar)

Out: Nothing consumed by other feature modules.

## Invariants / Gotchas

- `acceptProposal` guards against double-acceptance: no-ops if `proposal.status !== 'pending'`.
- `rejectProposal` cascades to all child proposals (`DeepDiveStore.cascadeReject`).
- Checkpoint item IDs use the stable format `'topic-<title>'` (C2) so completed items survive restart.
- Deep-dive checkpoint cannot be resumed via BFS reconstruction — `resumeFromCheckpoint` discards the checkpoint and prompts user to re-run.
- Auto-accept runs AFTER the full generation loop completes, in creation order (parents before children) so navigation resolves correctly.
- Syllabus note path: `syllabusPath(rootNotePath, deepDive.noteOutputFolder)` — trashed (not hard-deleted) if all proposals in a run are rejected.
- `onNoteAccepted` and `onOrganizeRequested` fire even under `silent: true` (batch auto-accept); they are the intended acyclic follow-on chain.

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
| `settings-section.test.ts` | Settings UI renderer |
