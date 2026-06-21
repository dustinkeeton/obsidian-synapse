---
last-updated: 2026-06-19
---

# Enrichment Module

Adds tags, internal links, external references, and frontmatter attributes to notes using vocabulary-based metadata classification, AI topic extraction, vault graph analysis, and AI suggestions.

## Public API

Exported from `index.ts`:

```ts
class EnrichmentModule {
  // Wired by main.ts to refresh the unified proposal view
  onViewRefreshNeeded: (() => Promise<void>) | null

  // Wired by main.ts to open the unified proposal view (#340)
  onOpenProposalView: (() => void) | null

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

  enrich(filePath: string, trigger: EnrichmentTrigger): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  getPendingProposals(): Promise<EnrichmentProposal[]>
  acceptSelectedFromView(id: string, accepted: AcceptedItems, options?: { silent?: boolean }): Promise<void>
  rejectFromView(id: string): Promise<void>
}
```

Re-exported types from `types.ts`:

```ts
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

interface TagCandidate {
  tag: string
  category: string       // vocabulary category, e.g. "Status", "Type"
  confidence: number     // AI classification confidence (0–1)
  rawScore: number       // always 0 for classifier-produced candidates
  weightedScore: number  // equals confidence for classifier-produced candidates
  sources: string[]      // file paths that contributed this tag (empty for classifier)
}

interface InternalLinkCandidate { targetPath: string; displayText: string; relevanceScore: number; reason: string }
interface ExternalLinkCandidate { url: string; title: string; reason: string }
interface FrontmatterEnrichment { key: string; value: string | string[]; action: 'add' | 'merge' }
interface WeightConfig { sameFolder: number; siblingFolder: number; cousinFolder: number; distantFolder: number; decayPerLevel: number; minWeight: number }

// Vault topology snapshots (types.ts)
interface TagIndex { tags: Map<string, { count: number; files: string[] }> }
interface LinkGraph { outgoing: Map<string, Set<string>>; incoming: Map<string, Set<string>> }
```

Note: `TagVocabularyEntry` and `EnrichmentWeightSettings` are defined in `src/settings.ts`, not in `types.ts`.

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | All interfaces and types | `TagCandidate`, `InternalLinkCandidate`, `ExternalLinkCandidate`, `FrontmatterEnrichment`, `EnrichmentResult`, `EnrichmentProposal`, `AcceptedItems`, `TagIndex`, `LinkGraph`, `WeightConfig` |
| `index.ts` | `EnrichmentModule`, re-exports | Orchestrator; registers commands; exclusion checks; vault scan; checkpoint resume |
| `vault-analyzer.ts` | `VaultAnalyzer` | Cached vault-wide `TagIndex` and `LinkGraph` from `MetadataCache`; invalidated on `'resolved'` event |
| `weight-calculator.ts` | `computeProximityWeight` | Pure function: folder-proximity scoring |
| `metadata-classifier.ts` | `MetadataClassifier` | AI-powered tag classification against user-defined vocabulary; replaces former `TagScorer` |
| `topic-extractor.ts` | `TopicExtractor` | AI topic extraction; matched topics → `InternalLinkCandidate`; unmatched topics accumulated for multi-note resolution |
| `link-resolver.ts` | `LinkResolver` | Graph-based internal link candidates (link hops, shared tags, folder proximity); merges with topic candidates |
| `prompt-builder.ts` | `PromptBuilder` | AI prompts for external link and frontmatter suggestions |
| `enrichment-store.ts` | `EnrichmentStore` | CRUD for enrichment proposal JSON files in `.synapse/enrichments/` |
| `enrichment-applier.ts` | `EnrichmentApplier` | Applies/undoes accepted enrichments to note content non-destructively |
| `enrichment-modal.ts` | `EnrichmentDetailModal` | Per-item toggle modal for reviewing a single proposal |
| `settings-section.ts` | `renderEnrichmentSettings` | Settings UI accordion for the enrichment feature (#243) |
| `vault-analyzer.test.ts` | Tests | `VaultAnalyzer` |
| `weight-calculator.test.ts` | Tests | `computeProximityWeight` |
| `metadata-classifier.test.ts` | Tests | `MetadataClassifier` |
| `topic-extractor.test.ts` | Tests | `TopicExtractor` |
| `link-resolver.test.ts` | Tests | `LinkResolver` |
| `enrichment-store.test.ts` | Tests | `EnrichmentStore` |
| `enrichment-applier.test.ts` | Tests | `EnrichmentApplier` |
| `settings-section.test.ts` | Tests | `renderEnrichmentSettings` |
| `auto-accept.test.ts` | Tests | Auto-accept behavior (#228) |

## Internal Class Signatures

```ts
// vault-analyzer.ts
class VaultAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  invalidate(): void
  buildTagIndex(): TagIndex
  buildLinkGraph(): LinkGraph
  getFileTags(file: TFile): string[]
  getOutgoingLinks(filePath: string): Set<string>
  getIncomingLinks(filePath: string): Set<string>
}

// weight-calculator.ts
function computeProximityWeight(sourcePath: string, targetPath: string, config: WeightConfig): number

// metadata-classifier.ts
class MetadataClassifier {
  constructor(getSettings: () => SynapseSettings)
  classify(noteContent: string, existingTags: string[]): Promise<TagCandidate[]>
}

// topic-extractor.ts
class TopicExtractor {
  constructor(app: App, analyzer: VaultAnalyzer, getSettings: () => SynapseSettings)
  extractTopics(noteContent: string, notePath: string, existingLinkPaths: string[]): Promise<InternalLinkCandidate[]>
  resolveNewNoteCandidates(): Map<string, InternalLinkCandidate[]>  // notePath → candidates
  clearPending(): void
}

// link-resolver.ts
class LinkResolver {
  constructor(app: App, analyzer: VaultAnalyzer, getSettings: () => SynapseSettings)
  findInternalLinks(file: TFile, existingLinkPaths: string[]): InternalLinkCandidate[]
  mergeTopicCandidates(topicCandidates: InternalLinkCandidate[], graphCandidates: InternalLinkCandidate[]): InternalLinkCandidate[]
}

// prompt-builder.ts
class PromptBuilder {
  constructor(getSettings: () => SynapseSettings)
  suggestExternalLinks(noteContent: string, existingUrls: string[]): Promise<ExternalLinkCandidate[]>
  suggestFrontmatter(noteContent: string, existingFrontmatter: Record<string, unknown>): Promise<FrontmatterEnrichment[]>
}

// enrichment-store.ts
class EnrichmentStore {
  constructor(app: App, getSettings: () => SynapseSettings)
  init(): Promise<void>
  save(proposal: EnrichmentProposal): Promise<void>
  load(id: string): Promise<EnrichmentProposal | null>
  loadAll(): Promise<EnrichmentProposal[]>
  loadPending(): Promise<EnrichmentProposal[]>
  loadForNote(notePath: string): Promise<EnrichmentProposal[]>
  updateStatus(id: string, status: EnrichmentStatus, acceptedItems?: AcceptedItems): Promise<void>
  delete(id: string): Promise<void>
}

// enrichment-applier.ts
class EnrichmentApplier {
  constructor(app: App, getSettings: () => SynapseSettings)
  apply(proposal: EnrichmentProposal, accepted: AcceptedItems): Promise<void>
  undo(proposal: EnrichmentProposal): Promise<void>
}

// settings-section.ts
function renderEnrichmentSettings(ctx: SettingsSectionContext): void
```

## Registered Commands

| Command ID | Name | Condition |
|-----------|------|-----------|
| `enrich-current-note` | Enrich current note | `settings.enrichment.enabled` |
| `scan-vault-enrichment` | Scan folder for enrichment | `settings.enrichment.enabled` |
| `undo-enrichment` | Undo last enrichment on current note | `settings.enrichment.enabled` |

## Dependencies

In (consumed by this module):
- `src/shared`: `isPathExcluded`, `matchesExcludeTag`, `findMatchingRule`, `getIncludedMarkdownFiles`, `NotificationManager`, `CheckpointManager`, `CommandRegistrar`, `AIClient`, `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `buildCallout`, `ENRICHMENT_START`, `ENRICHMENT_END`, `sanitizeAIResponse`, `parseJson`, `generateId`, `isTwitterUrl`, `fetchTweetContent`, `fireAndForget`, `getMarkdownFiles`, `ensureFolder`, `readJsonFile`, `isRecord`
- `src/settings`: `SynapseSettings`, `TagVocabularyEntry`, `EnrichmentWeightSettings`

Out (consumed by other modules):
- `src/main.ts`: imports `EnrichmentModule`, wires `onViewRefreshNeeded`, `onOpenProposalView`, `shouldAutoAccept`; calls `enrich()`, `scanVault()`, `getPendingProposals()`, `acceptSelectedFromView()`, `rejectFromView()`, `resumeFromCheckpoint()`

No feature module dependencies (enrichment does not import from elaboration, transcription, etc.).

## Data Flow

```
enrich(filePath, trigger)
  └─ isExcluded(file)  ← isPathExcluded('enrichment', settings) + matchesExcludeTag
  └─ enrichFile(file, trigger) [private]
       ├─ MetadataClassifier.classify()        → TagCandidate[]
       ├─ LinkResolver.findInternalLinks()      → InternalLinkCandidate[] (graph)
       ├─ TopicExtractor.extractTopics()        → InternalLinkCandidate[] (topics)
       ├─ PromptBuilder.suggestExternalLinks()  → ExternalLinkCandidate[]
       └─ PromptBuilder.suggestFrontmatter()    → FrontmatterEnrichment[]
       └─ LinkResolver.mergeTopicCandidates(topicLinks, graphLinks)
       └─ EnrichmentStore.save(proposal)
  └─ maybeAutoAccept(id)  [if shouldAutoAccept()]
  └─ onViewRefreshNeeded()
```

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: collect eligible files; warm VaultAnalyzer caches
  Phase 2: user confirmation via NotificationManager.confirm() [skipped if skipConfirmation]
  Phase 3: cancellable per-file enrichFile(); CheckpointManager tracks progress
  Phase 4: TopicExtractor.resolveNewNoteCandidates()
           → topics cited by 2+ notes → new-note InternalLinkCandidates
           → injected into existing proposals via LinkResolver.mergeTopicCandidates()
  On cancel/error: discard checkpoint, rejectProposalBatch(), clearPending()
```

```
User review (UnifiedProposalView):
  Accept Selected → acceptSelectedFromView(id, accepted)
                    → EnrichmentApplier.apply(proposal, accepted)
                    → EnrichmentStore.updateStatus(id, 'accepted'|'partially-accepted')
  Reject          → rejectFromView(id)
                    → EnrichmentStore.updateStatus(id, 'rejected')
```

## Exclusion Handling (#307)

Exclusion uses the centralized `src/shared/exclusions.ts` API. `excludeFolders` per module was removed; path exclusions are stored in `settings.exclusions: ExclusionRule[]` at the top level and scoped by feature name.

```ts
// index.ts:639-644
private isExcluded(file: TFile): boolean {
  const settings = this.getSettings();
  return (
    isPathExcluded(file.path, 'enrichment', settings) ||
    matchesExcludeTag(file, settings.enrichment.excludeTags, this.plugin.app.metadataCache)
  );
}
```

`findMatchingRule(file.path, 'enrichment', settings)` is called on the manual-trigger path to surface the matching rule name in the user-facing notice.

## Settings Keys

All under `settings.enrichment` unless noted:

| Key | Type | Controls |
|-----|------|----------|
| `enabled` | `boolean` | Module activation; gates command registration |
| `autoEnrich` | `boolean` | Auto-trigger after elaboration/transcription/summarization |
| `maxTags` | `number` | Max tags to suggest (default: 5) |
| `maxInternalLinks` | `number` | Max related-note link suggestions |
| `maxExternalLinks` | `number` | Max external references (0 = disable) |
| `maxTopicLinks` | `number` | Max topic-extracted link candidates per note (default: 10) |
| `suggestNewNotes` | `boolean` | Enable new-note suggestions for unmatched topics (default: true) |
| `tagVocabulary` | `TagVocabularyEntry[]` | Classification categories and valid tags for `MetadataClassifier` |
| `internalLinkThreshold` | `number` | Min relevance score to include a link candidate |
| `weights` | `EnrichmentWeightSettings` | Proximity weight tiers for `computeProximityWeight` |
| `enrichmentFolderPath` | `string` | Path to proposal JSON storage (default: `.synapse/enrichments`) |
| `excludeTags` | `string[]` | Tags that suppress enrichment for a note |
| `relatedNotesHeading` | `string` | Heading for the internal-links section |
| `referencesHeading` | `string` | Heading for the external-links section |
| `settings.exclusions` (top-level) | `ExclusionRule[]` | Path/glob exclusions scoped by feature `'enrichment'`; replaces removed per-module `excludeFolders` |
| `settings.autoAccept.enrichment` (top-level) | `boolean` | Wired to `shouldAutoAccept` constructor param (#228) |

## Invariants

- Idempotency markers: `%% synapse-enrichment-start %%` / `%% synapse-enrichment-end %%` (constants `ENRICHMENT_START` / `ENRICHMENT_END` from `src/shared`). Applier strips existing marker sections before re-writing; undo deletes them. `enrichment-applier.ts:L36`
- Frontmatter keys: never overwritten; `action: 'add'` skips if key exists; `action: 'merge'` appends to arrays
- Frontmatter key allowlist: `^[a-z][a-z0-9_-]{0,49}$`; forbidden keys (`__proto__`, `constructor`, `prototype`, etc.) blocked (`prompt-builder.ts:L9-16`)
- Tag format: `^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,49}$` (`metadata-classifier.ts:L5`)
- External URL validation: HTTP/HTTPS only (`prompt-builder.ts:L19-24`)
- New-note topic threshold: topic must appear in 2+ notes during a vault scan to become a suggestion (`topic-extractor.ts:L118`)
- Double-acceptance guard: `acceptSelected` and `maybeAutoAccept` bail immediately if `proposal.status !== 'pending'`
- Auto-accept (#228) runs after Phase 4 in `scanVault` so merged cross-note candidates are included before acceptance
