---
last-updated: 2026-03-18
---

# Deep Dive Module

Recursively explores a note by extracting topics and generating child notes. Uses quality scoring to control recursion depth. Generates syllabus index and inter-note navigation. Supports checkpointed generation for resumability.

## Public API (`index.ts`)

```ts
class DeepDiveModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onNoteAccepted: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null

  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  getPendingProposals(): Promise<DeepDiveProposal[]>
  acceptProposal(id: string): Promise<void>
  rejectProposal(id: string): Promise<void>
}

function buildDeepDivePath(topicTitle: string, rootFile: TFile, settings: {...}, parentProposedPath?: string): string

// Syllabus navigator exports
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

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `topic-analyzer.ts` | `TopicAnalyzer` | AI topic extraction from note content, checks vault for existing notes |
| `topic-analyzer.test.ts` | Tests | TopicAnalyzer tests |
| `note-generator.ts` | `NoteGenerator` | AI content generation for a topic given parent context |
| `quality-scorer.ts` | `scoreQuality` | Local heuristic scoring: word count, child topics, overlap, genericity |
| `quality-scorer.test.ts` | Tests | Quality scorer tests |
| `syllabus-navigator.ts` | Navigation utilities | Traversal ordering, syllabus index, prev/next navigation blocks |
| `syllabus-navigator.test.ts` | Tests | Syllabus navigator tests |
| `deep-dive-store.ts` | `DeepDiveStore` | JSON persistence for proposals and runs |
| `deep-dive-store.test.ts` | Tests | DeepDiveStore tests |
| `depth-selector-modal.ts` | `DepthSelectorModal`, `selectDepth`, `MIN_DEPTH`, `MAX_DEPTH` | Modal for user to select recursion depth (1-6) |
| `depth-selector-modal.test.ts` | Tests | DepthSelectorModal tests |
| `types.ts` | -- | All deep-dive types |

## Data Flow

```
deepDive(file)
  Phase 1: Extract topics
    --> TopicAnalyzer.extractTopics(content, title, [])  [AI]
    --> filter new vs existing topics
  Phase 2a: Select depth
    --> selectDepth(app, defaultDepth)  [DepthSelectorModal]
  Phase 2b: User confirmation
  Phase 3: Recursive generation (BFS queue, checkpointed)
    --> checkpointManager.create(module: 'deep-dive', items: root topics)
    --> addDeferredTask('refresh-sidebar-view')
    for each topic:
      --> NoteGenerator.generateContent(topic, parentTitle, parentContent)  [AI]
      --> buildProposedPath(title, rootFile, parentPath)
      --> if depth < maxDepth: TopicAnalyzer.extractTopics(childContent)  [AI]
      --> scoreQuality({title, childTopics, wordCount, depth, ancestors})
      --> DeepDiveStore.saveProposal()
      --> checkpointManager.completeItem(checkpoint, topic-title)
      --> if quality >= threshold && depth+1 < maxDepth: queue children
    --> DeepDiveStore.saveRun()
    --> on cancel: checkpointManager.discard()
    --> on success: checkpointManager.complete(), dispatch deferred tasks
    --> on error: checkpointManager.discard()

resumeFromCheckpoint(checkpoint)
  --> Deep dive cannot directly resume (recursive BFS state not serializable)
  --> Discards checkpoint, notifies user to re-run on source note
  --> Completed proposals from partial run are already saved

acceptProposal(id)
  --> updateRunNavigation(runId, proposedPath, proposedContent)
    --> computeTraversalOrder(proposals, run)
    --> renderSyllabusContent() -> writeNote(syllabusPath)
    --> for each accepted node: injectNavigationBlock() -> writeNote()
  --> DeepDiveStore.updateProposalStatus('accepted')
  --> onNoteAccepted?.(proposedPath)  [triggers enrichment]
  --> onOrganizeRequested?.(file)  [triggers organize if enabled]

rejectProposal(id)
  --> DeepDiveStore.cascadeReject(id)  [rejects children too]
  --> updateRunNavigation(runId)  [refresh remaining notes]
```

## Path Building (nestingMode)

| Mode | Behavior |
|------|----------|
| `nested` | Children placed in subfolder named after parent: `Deep Dives/ML/Neural Networks/Backprop.md` |
| `flat` | All notes in root subfolder: `Deep Dives/ML/Backprop.md` |
| `auto-organize` | Uses organize module's ContentAnalyzer + DirectoryMatcher; falls back to nested |

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
  score: number        // 0-1; below threshold stops recursion
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

## Dependencies

- `shared/` (NotificationManager, ensureFolder, readNote, writeNote, wordCount, CheckpointManager, generateId, Checkpoint, CheckpointWorkItem, DeferredTask)
- `organize/` (ContentAnalyzer, DirectoryMatcher -- for auto-organize nesting mode)
- `settings.ts` (SynapseSettings, DeepDiveNestingMode)
