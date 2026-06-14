---
last-updated: 2026-03-19
---

# Enrichment Module

Adds tags, internal links, external references, and frontmatter attributes to notes using vocabulary-based metadata classification, AI topic extraction, vault graph analysis, and AI suggestions.

## Public API

Exported from `index.ts`:

```ts
class EnrichmentModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, notifications: NotificationManager, checkpointManager: CheckpointManager)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  enrich(filePath: string, trigger: EnrichmentTrigger): Promise<void>
  scanVault(folderPath?: string): Promise<number>
  getPendingProposals(): Promise<EnrichmentProposal[]>
  acceptSelectedFromView(id: string, accepted: AcceptedItems): Promise<void>
  rejectFromView(id: string): Promise<void>
  onViewRefreshNeeded: (() => Promise<void>) | null
}

type EnrichmentTrigger = 'elaboration' | 'transcription' | 'summarization' | 'deep-dive' | 'manual'
type EnrichmentStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected'

interface EnrichmentProposal {
  id: string
  sourceNotePath: string
  createdAt: string
  triggerSource: EnrichmentTrigger
  result: EnrichmentResult
  status: EnrichmentStatus
  acceptedItems?: AcceptedItems
}

interface EnrichmentResult {
  tags: TagCandidate[]
  internalLinks: InternalLinkCandidate[]
  externalLinks: ExternalLinkCandidate[]
  frontmatter: FrontmatterEnrichment[]
}

interface AcceptedItems {
  tags: string[]
  internalLinks: string[]
  externalLinks: string[]
  frontmatter: string[]
}

interface TagCandidate { tag: string; category: string; confidence: number; rawScore: number; weightedScore: number; sources: string[] }
interface TagVocabularyEntry { category: string; tags: string[]; description: string }
interface InternalLinkCandidate { targetPath: string; displayText: string; relevanceScore: number; reason: string }
interface ExternalLinkCandidate { url: string; title: string; reason: string }
interface FrontmatterEnrichment { key: string; value: string | string[]; action: 'add' | 'merge' }
interface WeightConfig { sameFolder: number; siblingFolder: number; cousinFolder: number; distantFolder: number; decayPerLevel: number; minWeight: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | All interfaces and types | Type definitions, `TagIndex`, `LinkGraph` |
| `vault-analyzer.ts` | `VaultAnalyzer` | Cached vault-wide tag index and link graph from MetadataCache |
| `vault-analyzer.test.ts` | Tests | VaultAnalyzer tests |
| `weight-calculator.ts` | `computeProximityWeight` | Pure function: folder proximity scoring |
| `weight-calculator.test.ts` | Tests | Weight calculator tests |
| `metadata-classifier.ts` | `MetadataClassifier` | AI-powered tag classification using user-defined vocabulary |
| `metadata-classifier.test.ts` | Tests | MetadataClassifier tests |
| `topic-extractor.ts` | `TopicExtractor` | AI-powered topic extraction, converts topics to internal link candidates |
| `topic-extractor.test.ts` | Tests | TopicExtractor tests |
| `link-resolver.ts` | `LinkResolver` | Graph-based internal link candidates, merges with topic candidates |
| `link-resolver.test.ts` | Tests | LinkResolver tests |
| `prompt-builder.ts` | `PromptBuilder` | AI-generated external links and frontmatter suggestions |
| `enrichment-store.ts` | `EnrichmentStore` | CRUD for enrichment proposal JSON files |
| `enrichment-store.test.ts` | Tests | EnrichmentStore tests |
| `enrichment-applier.ts` | `EnrichmentApplier` | Applies/undoes enrichments to notes |
| `enrichment-modal.ts` | `EnrichmentDetailModal` | Legacy per-item toggle modal |
| `enrichment-view.ts` | `EnrichmentReviewView` | Legacy sidebar view (not registered) |
| `index.ts` | `EnrichmentModule` | Orchestrator, commands, exclusion logic, vault scan |

## Data Flow

```
1. enrich(filePath, trigger) -- triggered by callback or command
   |
2. Exclusion check: centralized isPathExcluded (feature 'enrichment') + excludeTags
   |
3. Parallel enrichment (enrichFile):
   |  MetadataClassifier.classify() -- vocabulary-based tag classification via AI
   |  TopicExtractor.extractTopics() -- AI topic extraction -> internal link candidates
   |  LinkResolver.findInternalLinks() -- graph hops + shared tags + folder proximity
   |  PromptBuilder.suggestExternalLinks() -- AI with conservative prompt
   |  PromptBuilder.suggestFrontmatter() -- AI with allowlisted keys
   |
4. LinkResolver.mergeTopicCandidates(topicLinks, graphLinks) -- merge and deduplicate
   |
5. EnrichmentStore.save(proposal)
   |
6. onViewRefreshNeeded() --> main.refreshUnifiedView()
   |
7. User review via UnifiedProposalView:
   Accept Selected --> EnrichmentApplier.apply(proposal, accepted)
   Reject --> status = 'rejected'
```

## Vault Scan Flow (scanVault)

```
Phase 1: Collect eligible files, warm VaultAnalyzer caches (tag index, link graph)
Phase 2: User confirmation via NotificationManager.confirm()
Phase 3: Cancellable per-file enrichFile() -- accumulates TopicExtractor pending topics
Phase 4: TopicExtractor.resolveNewNoteCandidates() -- topics referenced by 2+ notes
         become new-note link suggestions, injected into existing proposals via
         LinkResolver.mergeTopicCandidates()
```

On error or cancel in Phase 3: clears pending topics, rejects all created proposals.

## Metadata Classification (metadata-classifier.ts)

Replaces the former `TagScorer`. Tags are now rare, purposeful metadata classifiers (status, type, source) rather than topic labels.

```
1. AI classifies note content against user-defined tagVocabulary
2. Validates results against vocabulary lookup -- rejects hallucinated tags
3. Filters out tags already on the note
4. Validates tag format: ^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,49}$
5. Sorts by confidence descending, caps at maxTags
```

TagCandidate output: `{ tag, category, confidence, rawScore: 0, weightedScore: confidence, sources: [] }`

## Topic Extraction (topic-extractor.ts)

Converts note content into internal link candidates via AI-identified topics.

```
1. AI extracts 5-15 key concepts/topics from note content
2. Matched topics (existing vault notes by title) become InternalLinkCandidate immediately
   - Score: 0.7 base + proximity * 0.2
3. Unmatched topics accumulated in pendingNewTopics (Map<normalized, {displayText, notePaths}>)
4. resolveNewNoteCandidates(): only topics with 2+ referencing notes become suggestions
   - Score: 0.5 fixed
5. clearPending(): discards accumulated state (called after single-note enrichment)
```

## Link Resolution Strategy (link-resolver.ts)

Graph-based candidates from three sources (scored by proximity):
1. Files 1-2 hops away in link graph (proximity * 0.25)
2. Files sharing 2+ tags (proximity * sharedCount * 0.15)
3. Files in same/sibling folders (proximity * 0.15)

`mergeTopicCandidates(topicCandidates, graphCandidates)`:
- Topic relevance dominates; graph proximity adds a small bonus (existing.score * 0.2)
- Deduplicates by targetPath, combines reasons

Filtered by `internalLinkThreshold`, capped at `maxInternalLinks`.

## Proximity Weight Algorithm (weight-calculator.ts)

Pure function `computeProximityWeight(sourcePath, targetPath, config)`:
1. Split paths into folder segments
2. Find longest common prefix (shared ancestor depth)
3. Hops = (sourceDepth - shared) + (targetDepth - shared)
4. Map to tier: 0 hops = sameFolder, 1 = sibling, 2 = cousin, 3+ = distant
5. Apply linear decay per hop beyond tier minimum
6. Clamp to [minWeight, tierWeight]

## Enrichment Application (enrichment-applier.ts)

- Tags: merged into frontmatter `tags` array via `mergeTags()`
- Internal links: appended as `## Related Notes` section with markers
- External links: appended as `## References` section with markers
- Frontmatter: keys added (never overwrites existing)
- Markers: `%% synapse-enrichment-start/end %%` for idempotent updates
- Undo: removes accepted tags, deletes added frontmatter keys, strips marker sections

## Security

- External URLs validated via `isValidExternalUrl()` (HTTP/HTTPS only)
- Frontmatter keys validated: `^[a-z][a-z0-9_-]{0,49}$`, forbidden keys blocked (`__proto__`, `constructor`, etc.)
- AI-generated display text/reasons sanitized (strips `[](){}|<>`)
- Tags validated against alphanumeric pattern
- `sanitizeAIResponse()` applied to all AI outputs

## Settings Keys

All under `settings.enrichment`:

| Key | Controls |
|-----|----------|
| `enabled` | Module activation |
| `autoEnrich` | Auto-trigger after elaboration/transcription |
| `maxTags` | Max tags to suggest (default: 5) |
| `maxInternalLinks` | Max related note links |
| `maxExternalLinks` | Max external references (0 = disable) |
| `maxTopicLinks` | Max topic-extracted link candidates per note (default: 10) |
| `suggestNewNotes` | Enable new-note suggestions for unmatched topics (default: true) |
| `tagVocabulary` | TagVocabularyEntry[] defining classification categories |
| `internalLinkThreshold` | Min relevance score for links |
| `weights.*` | Proximity weight configuration |
| `enrichmentFolderPath` | Proposal JSON storage |
| `exclusions` (top-level, feature `'enrichment'`) | Paths to skip (centralized) |
| `excludeTags` | Tags that suppress enrichment |
| `relatedNotesHeading` | Heading for internal links section |
| `referencesHeading` | Heading for external refs section |
