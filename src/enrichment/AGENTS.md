---
last-updated: 2026-03-13
---

# Enrichment Module

Adds tags, internal links, external references, and frontmatter attributes to notes using vault context analysis and AI suggestions.

## Public API

Exported from `index.ts`:

```ts
class EnrichmentModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  enrich(filePath: string, trigger: EnrichmentTrigger): Promise<void>
  getPendingProposals(): Promise<EnrichmentProposal[]>
  acceptSelectedFromView(id: string, accepted: AcceptedItems): Promise<void>
  rejectFromView(id: string): Promise<void>
  onViewRefreshNeeded: (() => Promise<void>) | null
}

type EnrichmentTrigger = 'elaboration' | 'transcription' | 'manual'
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

interface TagCandidate { tag: string; rawScore: number; weightedScore: number; sources: string[] }
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
| `tag-scorer.ts` | `TagScorer` | AI + proximity-weighted tag ranking |
| `link-resolver.ts` | `LinkResolver` | Internal link candidates from graph, tags, proximity |
| `prompt-builder.ts` | `PromptBuilder` | AI-generated external links and frontmatter suggestions |
| `enrichment-store.ts` | `EnrichmentStore` | CRUD for enrichment proposal JSON files |
| `enrichment-store.test.ts` | Tests | EnrichmentStore tests |
| `enrichment-applier.ts` | `EnrichmentApplier` | Applies/undoes enrichments to notes |
| `enrichment-modal.ts` | `EnrichmentDetailModal` | Legacy per-item toggle modal |
| `enrichment-view.ts` | `EnrichmentReviewView` | Legacy sidebar view (not registered) |
| `index.ts` | `EnrichmentModule` | Orchestrator, commands, exclusion logic |

## Data Flow

```
1. enrich(filePath, trigger) -- triggered by callback or command
   |
2. Exclusion check: excludeFolders, excludeTags
   |
3. Parallel scoring:
   |  TagScorer.scoreTags() -- AI candidates + vault tag index + proximity weights
   |  LinkResolver.findInternalLinks() -- link graph hops + shared tags + folder proximity
   |  PromptBuilder.suggestExternalLinks() -- AI with conservative prompt
   |  PromptBuilder.suggestFrontmatter() -- AI with allowlisted keys
   |
4. EnrichmentStore.save(proposal)
   |
5. onViewRefreshNeeded() --> main.refreshUnifiedView()
   |
6. User review via UnifiedProposalView:
   Accept Selected --> EnrichmentApplier.apply(proposal, accepted)
   Reject --> status = 'rejected'
```

## Tag Scoring Algorithm

```
1. AI suggests candidate tags (constrained to vault tags + up to 3 novel)
2. For each candidate, look up vault-wide frequency from TagIndex
3. For each file using the tag, compute proximity weight to source note
4. Score = SUM(proximityWeights) * log2(1 + globalFrequency)
5. Sort descending, take top maxTags
```

Tag validation: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$`

## Link Resolution Strategy

Candidates from three sources (scored by proximity + overlap):
1. Files 1-2 hops away in link graph (score * 0.6)
2. Files sharing 2+ tags (score * 0.3 * sharedCount)
3. Files in same/sibling folders (score * 0.4)

Filtered by `internalLinkThreshold`, capped at `maxInternalLinks`.

## Proximity Weight Algorithm (`weight-calculator.ts`)

Pure function `computeProximityWeight(sourcePath, targetPath, config)`:
1. Split paths into folder segments
2. Find longest common prefix (shared ancestor depth)
3. Hops = (sourceDepth - shared) + (targetDepth - shared)
4. Map to tier: 0 hops = sameFolder, 1 = sibling, 2 = cousin, 3+ = distant
5. Apply linear decay per hop beyond tier minimum
6. Clamp to [minWeight, tierWeight]

## Enrichment Application (`enrichment-applier.ts`)

- Tags: merged into frontmatter `tags` array via `mergeTags()`
- Internal links: appended as `## Related Notes` section with markers
- External links: appended as `## References` section with markers
- Frontmatter: keys added (never overwrites existing)
- Markers: `%% auto-notes-enrichment-start/end %%` for idempotent updates
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
| `maxTags` | Max tags to suggest |
| `maxInternalLinks` | Max related note links |
| `maxExternalLinks` | Max external references (0 = disable) |
| `internalLinkThreshold` | Min relevance score for links |
| `weights.*` | Proximity weight configuration |
| `enrichmentFolderPath` | Proposal JSON storage |
| `excludeFolders` | Folders to skip |
| `excludeTags` | Tags that suppress enrichment |
| `relatedNotesHeading` | Heading for internal links section |
| `referencesHeading` | Heading for external refs section |
