---
last-updated: 2026-07-03
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

  enrich(filePath: string, trigger: EnrichmentTrigger, options?: { postOp?: boolean }): Promise<void>  // postOp suppresses chained-auto-enrich Review toast (#366)
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  getPendingProposals(): Promise<EnrichmentProposal[]>
  acceptSelectedFromView(id: string, accepted: AcceptedItems, options?: { silent?: boolean }): Promise<void>
  rejectFromView(id: string): Promise<void>
}

function renderEnrichmentSettings(ctx: SettingsSectionContext): void  // re-exported (index.ts:695)
```

Types re-exported from the `index.ts` barrel (`index.ts:19-28`):

```ts
type EnrichmentTrigger = 'elaboration' | 'transcription' | 'summarization' | 'deep-dive' | 'manual'

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
  tag: string            // normalized, '#'-prefixed (metadata-classifier.ts:L54)
  category: string       // vocabulary category, e.g. "Status", "Type", "Source"
  confidence: number     // AI classification confidence (0–1)
  rawScore: number       // always 0 for classifier-produced candidates
  weightedScore: number  // equals confidence for classifier-produced candidates
  sources: string[]      // file paths that contributed this tag (empty for classifier)
}

interface InternalLinkCandidate { targetPath: string; displayText: string; relevanceScore: number; reason: string }
interface ExternalLinkCandidate { url: string; title: string; reason: string }
interface WeightConfig { sameFolder: number; siblingFolder: number; cousinFolder: number; distantFolder: number; decayPerLevel: number; minWeight: number }
```

Defined in `types.ts` but NOT re-exported via `index.ts` (import from `./types`):

```ts
type EnrichmentStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected'
interface FrontmatterEnrichment { key: string; value: string | string[]; action: 'add' | 'merge' }
interface TagIndex { tags: Map<string, { count: number; files: string[] }> }
interface LinkGraph { outgoing: Map<string, Set<string>>; incoming: Map<string, Set<string>> }
```

Note: `TagVocabularyEntry`, `EnrichmentSettings`, and `EnrichmentWeightSettings` are defined in `src/settings.ts`, not in `types.ts`.

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | All interfaces and types | `TagCandidate`, `InternalLinkCandidate`, `ExternalLinkCandidate`, `FrontmatterEnrichment`, `EnrichmentResult`, `EnrichmentProposal`, `EnrichmentTrigger`, `EnrichmentStatus`, `AcceptedItems`, `TagIndex`, `LinkGraph`, `WeightConfig` |
| `index.ts` | `EnrichmentModule`, type re-exports, `renderEnrichmentSettings` re-export | Orchestrator; registers commands; exclusion checks; vault scan; checkpoint resume; auto-accept |
| `vault-analyzer.ts` | `VaultAnalyzer` | Cached vault-wide `TagIndex` and `LinkGraph` from `MetadataCache`; invalidated on `'resolved'` event |
| `weight-calculator.ts` | `computeProximityWeight` | Pure function: folder-proximity scoring |
| `metadata-classifier.ts` | `MetadataClassifier` | AI tag classification against user-defined vocabulary; rejects hallucinated tags |
| `topic-extractor.ts` | `TopicExtractor` | AI topic extraction; matched topics → `InternalLinkCandidate`; unmatched topics accumulated for multi-note resolution |
| `link-resolver.ts` | `LinkResolver` | Graph-based internal link candidates (link hops, shared tags, folder proximity); merges with topic candidates |
| `prompt-builder.ts` | `PromptBuilder` | AI prompts for external link and frontmatter suggestions |
| `enrichment-store.ts` | `EnrichmentStore` | CRUD for enrichment proposal JSON files in the enrichment folder |
| `enrichment-applier.ts` | `EnrichmentApplier` | Applies/undoes accepted enrichments to note content non-destructively via `vault.process` |
| `enrichment-modal.ts` | `EnrichmentDetailModal` | Per-item toggle modal for reviewing a single proposal |
| `settings-section.ts` | `renderEnrichmentSettings` | Settings UI accordion for the enrichment feature (#243) |
| `*.test.ts` | Co-located Vitest suites | `vault-analyzer`, `weight-calculator`, `metadata-classifier`, `topic-extractor`, `link-resolver`, `prompt-builder`, `enrichment-store`, `enrichment-applier`, `settings-section`, `auto-accept` (#228), `review-toast` (#366) |

## Internal Class Signatures

```ts
// vault-analyzer.ts
class VaultAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  invalidate(): void
  buildTagIndex(): TagIndex
  buildLinkGraph(): LinkGraph
  getFileTags(file: TFile): string[]
  getOutgoingLinks(filePath: string): string[]
  getIncomingLinks(filePath: string): string[]
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
  suggestExternalLinks(noteContent: string, existingLinks: string[]): Promise<ExternalLinkCandidate[]>
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
// enrichment-modal.ts
class EnrichmentDetailModal extends Modal {
  constructor(app: App, proposal: EnrichmentProposal, callbacks: { onAccept: (accepted: AcceptedItems) => void; onReject: () => void })
}
// settings-section.ts
function renderEnrichmentSettings(ctx: SettingsSectionContext): void
```

## Registered Commands

Registered in `EnrichmentModule.onload` via `registrar.register(id, condition, callbacks)`; all gated on `settings.enrichment.enabled`.

| Command ID | Name | Callback type | Action |
|-----------|------|--------------|--------|
| `enrich-current-note` | Enrich current note | `editorCallback` | `enrich(ctx.file.path, 'manual')` |
| `scan-vault-enrichment` | Scan folder for enrichment | `callback` | `FolderPickerModal` → `scanVault(folder)` |
| `undo-enrichment` | Undo last enrichment on current note | `editorCallback` | `undoLastEnrichment(ctx.file.path)` (registry status: disabled) |

## Dependencies

In (consumed by this module):
- `src/shared`: `isPathExcluded`, `matchesExcludeTag`, `findMatchingRule`, `reviewAction`, `getIncludedMarkdownFiles`, `getMarkdownFiles`, `NotificationManager`, `CheckpointManager`, `FolderPickerModal`, `AIClient`, `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `asStringArray`, `buildCallout`, `CALLOUT_TYPES`, `ENRICHMENT_START`, `ENRICHMENT_END`, `sanitizeAIResponse`, `parseJson`, `isRecord`, `generateId`, `isTwitterUrl`, `fetchTweetContent`, `fireAndForget`, `ensureFolder`, `readJsonFile`, `addEnhancedSlider`; types `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `SettingsSectionContext`
- `src/commands`: `CommandRegistrar`
- `src/settings`: `SynapseSettings`, `TagVocabularyEntry`, `EnrichmentWeightSettings`

Out (consumed by other modules):
- `src/main.ts`: imports `EnrichmentModule`, wires `onViewRefreshNeeded`, `onOpenProposalView`, `shouldAutoAccept`; calls `enrich()`, `scanVault()`, `getPendingProposals()`, `acceptSelectedFromView()`, `rejectFromView()`, `resumeFromCheckpoint()`

No feature-module dependencies (enrichment does not import from elaboration, transcription, etc.).

## Data Flow

```
enrich(filePath, trigger, options?)
  └─ getAbstractFileByPath → TFile guard
  └─ isExcluded(file)  ← isPathExcluded('enrichment', settings) || matchesExcludeTag
  │    └─ if trigger === 'manual' && excluded → Notice naming findMatchingRule(); else silent (#307)
  └─ enrichFile(file, trigger) [private]  (fetchTwitterContext prepends tweet text to classifier body)
       ├─ MetadataClassifier.classify()             → TagCandidate[]
       ├─ LinkResolver.findInternalLinks()          → InternalLinkCandidate[] (graph)
       ├─ TopicExtractor.extractTopics()            → InternalLinkCandidate[] (topics)
       ├─ PromptBuilder.suggestExternalLinks()      → ExternalLinkCandidate[]
       ├─ PromptBuilder.suggestFrontmatter()        → FrontmatterEnrichment[]
       ├─ LinkResolver.mergeTopicCandidates(topicLinks, graphLinks)
       └─ EnrichmentStore.save(proposal)  [skipped when totalItems === 0 → returns null]
  └─ topicExtractor.clearPending(); op.finish(reviewAction(...)) [Review toast unless postOp/auto-accept #366]; maybeAutoAccept(id) [if shouldAutoAccept()]
  └─ refreshView() → onViewRefreshNeeded()
```

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: collect eligible (non-excluded) files; warm buildTagIndex()/buildLinkGraph() caches
  Phase 2: NotificationManager.confirm()  [skipped if skipConfirmation]
  Phase 3: CheckpointManager.create(); cancellable per-file enrichFile(); completeItem() per file
  Phase 4: TopicExtractor.resolveNewNoteCandidates()
           → topics cited by 2+ notes → new-note InternalLinkCandidates
           → merged into existing proposals via LinkResolver.mergeTopicCandidates()
  Auto-accept (#228): runs AFTER Phase 4 so merged candidates are included; batch mode (one summary Notice)
  On cancel/error: discard checkpoint, clearPending(), rejectProposalBatch()
```

```
User review (UnifiedProposalView / EnrichmentDetailModal):
  Accept Selected → acceptSelectedFromView(id, accepted)
                    → EnrichmentApplier.apply(proposal, accepted)
                    → EnrichmentStore.updateStatus(id, 'accepted' | 'partially-accepted')
  Reject          → rejectFromView(id)
                    → EnrichmentStore.updateStatus(id, 'rejected')
```

## Exclusion Handling (#307)

Exclusion uses the centralized `src/shared/exclusions.ts` API. Per-module `excludeFolders` was removed; path exclusions live in `settings.exclusions: ExclusionRule[]` at the top level, scoped by feature name.

```ts
// index.ts:647-653
private isExcluded(file: TFile): boolean {
  const settings = this.getSettings();
  return (
    isPathExcluded(file.path, 'enrichment', settings) ||
    matchesExcludeTag(file, settings.enrichment.excludeTags, this.plugin.app.metadataCache)
  );
}
```

`findMatchingRule(file.path, 'enrichment', settings)` is called only on the manual-trigger path to surface the matching rule pattern in the user-facing notice (`index.ts:398-408`).

## Settings Keys

All under `settings.enrichment` (interface `EnrichmentSettings`, `settings.ts:147-162`) unless noted. Defaults from `DEFAULT_SETTINGS.enrichment` (`settings.ts:434-460`).

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module activation; gates command registration |
| `autoEnrich` | `boolean` | `true` | Auto-trigger after elaboration/transcription/summarization |
| `maxTags` | `number` | `5` | Max metadata tags suggested per note |
| `maxInternalLinks` | `number` | `15` | Max related-note link suggestions |
| `maxExternalLinks` | `number` | `3` | Max external references (`0` = disable; `suggestExternalLinks` early-returns) |
| `maxTopicLinks` | `number` | `10` | Max topic-extracted link candidates per note |
| `suggestNewNotes` | `boolean` | `true` | Accumulate unmatched topics as new-note suggestions |
| `tagVocabulary` | `TagVocabularyEntry[]` | 3 entries: Status, Type, Source | Classification categories + valid tags for `MetadataClassifier` |
| `internalLinkThreshold` | `number` | `0.3` | Min relevance score to include a link candidate |
| `weights` | `EnrichmentWeightSettings` | see below | Proximity weight tiers for `computeProximityWeight` |
| `enrichmentFolderPath` | `string` | `'.synapse/enrichments'` | Path to proposal JSON storage |
| `excludeTags` | `string[]` | `['no-enrich']` | Tags that suppress enrichment for a note |
| `relatedNotesHeading` | `string` | `'Related Notes'` | Heading for the internal-links callout |
| `referencesHeading` | `string` | `'References'` | Heading for the external-links callout |
| `settings.exclusions` (top-level) | `ExclusionRule[]` | — | Path/glob exclusions scoped by feature `'enrichment'`; replaces removed `excludeFolders` |
| `settings.autoAccept.enrichment` (top-level) | `boolean` | — | Wired to the `shouldAutoAccept` constructor param (#228) |

`TagVocabularyEntry` = `{ category: string; tags: string[]; description: string }` (`settings.ts:141-145`). Default vocabulary: `Status` (draft, todo, reference, unfinished, needs-review, archived), `Type` (meeting, idea, project, log, guide, brainstorm), `Source` (source/video, source/audio, source/transcript, source/article, source/book). `EnrichmentWeightSettings` defaults (`settings.ts:449-454`): `sameFolder 1.0`, `siblingFolder 0.8`, `cousinFolder 0.5`, `distantFolder 0.2`, `decayPerLevel 0.15`, `minWeight 0.1`.

## Invariants

- Applied sections are Obsidian callouts `> [!synapse-enrichment]` (`CALLOUT_TYPES.enrichment`, `src/shared/callouts.ts:L15`), written via `buildCallout` (`enrichment-applier.ts:L180,L208`).
- Idempotent re-write / undo: `removeEnrichmentSections` strips both callout sections AND legacy comment markers `%% synapse-enrichment-start %%` / `%% synapse-enrichment-end %%` (`ENRICHMENT_START` / `ENRICHMENT_END`, `src/shared/callouts.ts:L46-47`) before re-writing (`enrichment-applier.ts:L215-240`).
- Writes are atomic: `apply` and `undo` re-derive content inside `vault.process` callbacks (`enrichment-applier.ts:L36,L129`).
- Frontmatter keys never overwritten: `action: 'add'` skips if key exists; `action: 'merge'` appends new array values (dedup via `asStringArray`).
- Frontmatter key allowlist `^[a-z][a-z0-9_-]{0,49}$` (`prompt-builder.ts:L6`); forbidden keys (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`) blocked (`prompt-builder.ts:L9-16`); `tags` key also rejected.
- Tag format `^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,49}$`; only vocabulary tags accepted, hallucinated tags dropped (`metadata-classifier.ts:L5,L48-51`).
- External URL validation: HTTP/HTTPS only, in both proposal generation (`prompt-builder.ts:L19-26`) and write-out (`enrichment-applier.ts:L196-205`).
- New-note topic threshold: a topic must be surfaced by 2+ notes during a vault scan to become a suggestion; new-note candidate `relevanceScore` = `0.5` (`topic-extractor.ts:L122,L127`).
- Double-acceptance guard: `acceptSelected` and `maybeAutoAccept` bail if `proposal.status !== 'pending'` (`index.ts:L581,L557`).
- Empty proposals skipped: `enrichFile` returns `null` when no items are produced (`index.ts:L508`).
- Review toast (#366): completion notices attach an optional Review action via `reviewAction({ generated, shouldAutoAccept, openProposalView, postOp })` (`src/shared`), surfaced only when proposals were generated AND enrichment auto-accept is off; `postOp` (chained auto-enrich) suppresses it. Used by `enrich` (`index.ts:L426`), `scanVault` (`index.ts:L360`), `resumeFromCheckpoint` (`index.ts:L178`).
- Proposal JSON filename: `<sanitized-path>-enrich-<8charId>.json`; null bytes and `..` stripped (`enrichment-store.ts:L113-122`).
- `VaultAnalyzer` caches invalidate on the `metadataCache 'resolved'` event (`index.ts:L75-79`).
