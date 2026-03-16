---
last-updated: 2026-03-16
---

# deep-dive module

Recursively explores a note by extracting topics and generating child notes. Uses quality scoring to control recursion depth.

## Public API (`index.ts`)

```ts
class DeepDiveModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onNoteAccepted: ((filePath: string) => void) | null
  onOrganizeRequested: ((file: TFile) => void) | null

  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<DeepDiveProposal[]>
  acceptProposal(id: string): Promise<void>
  rejectProposal(id: string): Promise<void>
}
```

Exported types: `DeepDiveProposal`, `DeepDiveRun`, `ExtractedTopic`, `QualityScore`, `DeepDiveProposalStatus`, `DeepDiveRunStatus`

## Internal Components

| File | Class/Function | Role |
|------|---------------|------|
| `topic-analyzer.ts` | `TopicAnalyzer` | AI topic extraction from note content, checks vault for existing notes |
| `note-generator.ts` | `NoteGenerator` | AI content generation for a topic given parent context |
| `quality-scorer.ts` | `scoreQuality` | Local heuristic scoring: word count, child topics, overlap, genericity |
| `deep-dive-store.ts` | `DeepDiveStore` | JSON persistence for proposals and runs |
| `types.ts` | -- | All deep-dive types |

## Data Flow

```
deepDive(file)
  Phase 1: Extract topics
    --> TopicAnalyzer.extractTopics(content, title, [])  [AI]
    --> filter new vs existing topics
  Phase 2: User confirmation
  Phase 3: Recursive generation (BFS queue)
    for each topic:
      --> NoteGenerator.generateContent(topic, parentTitle, parentContent)  [AI]
      --> if depth < maxDepth: TopicAnalyzer.extractTopics(childContent)  [AI]
      --> scoreQuality({title, childTopics, wordCount, depth, ancestors})
      --> DeepDiveStore.saveProposal()
      --> if quality >= threshold && depth+1 < maxDepth: queue children
    --> DeepDiveStore.saveRun()

acceptProposal(id)
  --> writeNote(app, proposedPath, proposedContent)
  --> DeepDiveStore.updateProposalStatus('accepted')
  --> onNoteAccepted?.(proposedPath)  [triggers enrichment]
  --> onOrganizeRequested?.(file)  [triggers organize if enabled]

rejectProposal(id)
  --> DeepDiveStore.cascadeReject(id)  [rejects children too]
```

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

- `shared/` (NotificationManager, ensureFolder, readNote, writeNote, wordCount)
- `settings.ts` (AutoNotesSettings)

## Tests

- `deep-dive-store.test.ts`
- `quality-scorer.test.ts`
- `topic-analyzer.test.ts`
