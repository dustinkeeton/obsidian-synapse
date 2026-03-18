---
last-updated: 2026-03-13
status: planned
module-path: src/enrichment/
---

# Enrichment Module

Analyzes vault context (tags, links, folder structure) to propose metadata enrichments for notes -- tags, internal/external links, and frontmatter fields -- using proximity-weighted scoring and AI-assisted relevance ranking.

## Status

This module does not yet exist in the codebase. This document is a design specification for implementation.

## File Structure

```
src/enrichment/
  index.ts           # EnrichmentModule class (public API)
  types.ts           # All enrichment-specific interfaces
  weight-engine.ts   # Proximity-weighted tag/link scoring
  enricher.ts        # AI-driven enrichment generation
  proposal-store.ts  # Persistence for EnrichmentProposal objects
  undo-manager.ts    # Tracks applied enrichments for rollback
  views/
    enrichment-view.ts  # Sidebar ItemView for reviewing proposals
```

## Types (types.ts)

```ts
interface WeightConfig {
  sameFolder: number;       // default: 1.0
  siblingFolder: number;    // default: 0.8
  cousinFolder: number;     // default: 0.5
  distantFolder: number;    // default: 0.2
  decayPerLevel: number;    // default: 0.15
  minWeight: number;        // default: 0.1
}

interface TagCandidate {
  tag: string;              // e.g. "#project/web"
  rawScore: number;         // pre-weight score from global frequency
  weightedScore: number;    // after proximity weighting
  sources: string[];        // vault paths of files that contributed this tag
}

interface InternalLinkCandidate {
  targetPath: string;       // vault-relative path to target note
  displayText: string;      // link display text
  relevanceScore: number;   // 0.0-1.0
  reason: string;           // human-readable justification
}

interface ExternalLinkCandidate {
  url: string;              // validated via sanitizeUrl
  title: string;
  reason: string;
}

interface FrontmatterEnrichment {
  key: string;
  value: string | string[];
  action: 'add' | 'merge';  // add: set key; merge: append to existing array
}

interface EnrichmentResult {
  tags: TagCandidate[];
  internalLinks: InternalLinkCandidate[];
  externalLinks: ExternalLinkCandidate[];
  frontmatter: FrontmatterEnrichment[];
}

type EnrichmentTrigger = 'elaboration' | 'transcription' | 'manual';
type EnrichmentStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected';

interface AcceptedItems {
  tags: string[];                // accepted tag strings
  internalLinks: string[];       // accepted target paths
  externalLinks: string[];       // accepted URLs
  frontmatter: string[];         // accepted frontmatter keys
}

interface EnrichmentProposal {
  id: string;                    // unique ID (UUID or nanoid)
  sourceNotePath: string;        // vault-relative path of enriched note
  createdAt: string;             // ISO 8601
  triggerSource: EnrichmentTrigger;
  result: EnrichmentResult;
  status: EnrichmentStatus;
  acceptedItems?: AcceptedItems;
}
```

## Settings (extends SynapseSettings)

The enrichment module adds `SynapseSettings.enrichment` of type `EnrichmentSettings`:

```ts
interface EnrichmentSettings {
  enabled: boolean;                 // default: false
  autoEnrichOnElaboration: boolean; // default: true
  autoEnrichOnTranscription: boolean; // default: true
  weightConfig: WeightConfig;
  maxTagSuggestions: number;        // default: 10
  maxLinkSuggestions: number;       // default: 5
  maxExternalLinks: number;         // default: 3
  frontmatterKeys: string[];       // default: ['topics', 'related']
  proposalFolder: string;          // default: '.synapse/enrichments'
}
```

This requires adding `enrichment: EnrichmentSettings` to `SynapseSettings` in `src/settings.ts:L110-115` and a corresponding default block in `DEFAULT_SETTINGS`.

## Public API (index.ts)

```ts
class EnrichmentModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager
  )

  async onload(): Promise<void>
  onunload(): void

  // Trigger enrichment for a specific note
  async enrichNote(file: TFile, trigger: EnrichmentTrigger): Promise<EnrichmentProposal>

  // Accept an enrichment proposal (full or partial)
  async acceptProposal(proposalId: string, acceptedItems?: AcceptedItems): Promise<void>

  // Reject a proposal
  async rejectProposal(proposalId: string): Promise<void>

  // Undo a previously accepted enrichment
  async undoEnrichment(proposalId: string): Promise<void>

  // Open the enrichment review sidebar
  activateEnrichmentView(): void
}
```

## Weight Algorithm (weight-engine.ts)

### computeProximityWeight

```ts
function computeProximityWeight(
  sourcePath: string,
  targetPath: string,
  config: WeightConfig
): number
```

Algorithm:

```
1. Split sourcePath and targetPath into folder segments
2. Find longest common prefix length (sharedDepth)
3. sourceDepth = sourcePath segment count (excluding filename)
4. targetDepth = targetPath segment count (excluding filename)
5. hops = (sourceDepth - sharedDepth) + (targetDepth - sharedDepth)
6. Map hops to tier:
   hops == 0  -> config.sameFolder    (1.0)
   hops == 1  -> config.siblingFolder  (0.8)
   hops == 2  -> config.cousinFolder   (0.5)
   hops >= 3  -> config.distantFolder  (0.2)
7. Apply decay: weight = tierWeight * (1 - config.decayPerLevel) ^ (hops - tierMinHops)
8. Clamp: max(config.minWeight, min(tierWeight, weight))
9. Return weight
```

### computeTagScore

```ts
function computeTagScore(
  tag: string,
  sourcePath: string,
  vault: MetadataCache
): TagCandidate
```

Formula:

```
finalScore = SUM(proximityWeight(sourcePath, fileUsingTag)) * log2(1 + globalTagCount)
```

Where `globalTagCount` is the total number of files in the vault using this tag.

### computeLinkRelevance

```ts
function computeLinkRelevance(
  sourcePath: string,
  candidatePath: string,
  vault: MetadataCache
): number
```

Factors proximity weight with shared-tag overlap and backlink density.

## Dependency Graph

```
src/enrichment/
  index.ts
    <- types.ts
    <- weight-engine.ts
    <- enricher.ts
    <- proposal-store.ts
    <- undo-manager.ts
    <- views/enrichment-view.ts
    <- shared/notifications.ts       (NotificationManager, OperationHandle)
    <- shared/file-utils.ts          (ensureFolder, writeNote)

  weight-engine.ts
    <- types.ts                      (WeightConfig, TagCandidate)
    <- obsidian                      (MetadataCache, getAllTags, resolvedLinks)

  enricher.ts
    <- types.ts                      (EnrichmentResult)
    <- weight-engine.ts
    <- shared/ai-client.ts           (AIClient)
    <- shared/validation.ts          (sanitizeAIResponse, sanitizeUrl)
    <- obsidian                      (MetadataCache, TFile)

  proposal-store.ts
    <- types.ts                      (EnrichmentProposal)
    <- shared/file-utils.ts          (ensureFolder)

  undo-manager.ts
    <- types.ts                      (EnrichmentProposal, AcceptedItems)
    <- shared/frontmatter-utils.ts   (parseFrontmatter, serializeFrontmatter) [NEW]
    <- obsidian                      (processFrontMatter, TFile)

  views/enrichment-view.ts
    <- types.ts
    <- obsidian                      (ItemView, WorkspaceLeaf)
```

Cross-module dependencies:

```
main.ts
  -> enrichment/index.ts             (EnrichmentModule)

enrichment/index.ts
  -> shared/ai-client.ts
  -> shared/notifications.ts
  -> shared/file-utils.ts
  -> shared/validation.ts
  -> shared/frontmatter-utils.ts     [NEW - must be created]
```

No dependencies on other feature modules (elaboration, audio, video). Integration is via callback hooks in `main.ts`.

## Integration Points

### Callback Hooks (main.ts)

```ts
// After elaboration proposal is accepted:
onProposalAccepted(sourceNotePath: string): void
  -> enrichmentModule.enrichNote(file, 'elaboration')

// After transcription completes:
onTranscriptionComplete(outputPath: string): void
  -> enrichmentModule.enrichNote(file, 'transcription')
```

These hooks must be wired in `main.ts` after the enrichment module is loaded.

### Commands

| Command ID | Name | Callback |
|-----------|------|----------|
| `synapse:enrich-current-note` | Enrich current note | `enrichNote(activeFile, 'manual')` |
| `synapse:review-enrichments` | Review enrichment proposals | `activateEnrichmentView()` |
| `synapse:undo-enrichment` | Undo last enrichment | `undoEnrichment(lastAcceptedId)` |

### Views

| View Type Constant | Class | Location |
|--------------------|-------|----------|
| `ENRICHMENT_VIEW_TYPE` | `EnrichmentView extends ItemView` | Right sidebar leaf |

### Obsidian APIs Used

| API | Usage |
|-----|-------|
| `MetadataCache` | Read vault tag index, resolved links graph |
| `processFrontMatter(file, fn)` | Mutate frontmatter on acceptance |
| `generateMarkdownLink(file, sourcePath)` | Create wiki/markdown links |
| `resolvedLinks` | Traverse existing link graph for relevance scoring |
| `getAllTags(cache)` | Enumerate tags from a file's metadata cache entry |
| `TFile` | File references throughout |

## New Shared Dependency: frontmatter-utils.ts

Must be created at `src/shared/frontmatter-utils.ts`:

```ts
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string }
function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string
```

Add re-export in `src/shared/index.ts`.

## Data Flow

```
Manual command / elaboration hook / transcription hook
  |
  v
EnrichmentModule.enrichNote(file, trigger)
  |
  v
weight-engine: scan vault tags + links, compute proximity-weighted scores
  |
  v
enricher: send note content + top candidates to AI for relevance ranking
  |
  v
EnrichmentResult (tags, internalLinks, externalLinks, frontmatter)
  |
  v
proposal-store: persist as EnrichmentProposal with status='pending'
  |
  v
EnrichmentView sidebar: display proposals for user review
  |
  v
User accepts/partially-accepts/rejects
  |
  v
[accept] -> apply tags, links, frontmatter to note; record in undo-manager
[reject] -> update proposal status, no file changes
[undo]   -> undo-manager reverts applied changes
```

## Error States

| Error | Handling |
|-------|----------|
| AI client failure | `OperationHandle.error()`, proposal not created |
| No active file (manual command) | `notifications.info('No active file')`, no-op |
| File deleted before acceptance | `notifications.notifyError()`, proposal marked rejected |
| Frontmatter parse failure | Skip frontmatter enrichments, log warning |
| Invalid external URL from AI | `sanitizeUrl` throws, URL excluded from result |
| Vault metadata cache not ready | Wait for `metadataCache.on('resolved')` event |
