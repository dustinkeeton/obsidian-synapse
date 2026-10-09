---
last-updated: 2026-10-09
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

  // Fired after a proposal's accepted items are written (acceptSelected, never on scan) with the note's external links as ctx.sourceUrls; main.ts wires buildPostOpHook(deps, 'enrichment') -> illustrate leg only (#213)
  onEnrichmentApplied: ((filePath: string, ctx?: SourceContext) => void) | null

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:65; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504); shouldAutoAccept defaults to () => false (#228)

  onload(): Promise<void>
  onunload(): void

  enrich(filePath: string, trigger: EnrichmentTrigger, options?: { postOp?: boolean }): Promise<void>  // index.ts:414; postOp suppresses chained-auto-enrich Review toast (#366); queue wrapper over private runEnrichment (#483)
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // index.ts:222
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>   // index.ts:129
  getPendingProposals(): Promise<EnrichmentProposal[]>   // index.ts:121
  acceptSelectedFromView(id: string, accepted: AcceptedItems, options?: { silent?: boolean }): Promise<void>  // index.ts:569; queue wrapper over private acceptSelected (#483)
  rejectFromView(id: string): Promise<void>   // index.ts:618; no note write; unqueued
}

function renderEnrichmentSettings(ctx: SettingsSectionContext): void  // re-exported (index.ts:750)
```

Types re-exported from the `index.ts` barrel (`index.ts:22-31`):

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
  tag: string            // normalized, '#'-prefixed (metadata-classifier.ts:74-76)
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
| `types.ts` | All interfaces and types | `TagCandidate`, `InternalLinkCandidate`, `ExternalLinkCandidate`, `FrontmatterEnrichment`, `EnrichmentResult`, `EnrichmentProposal`, `EnrichmentTrigger`, `EnrichmentStatus`, `AcceptedItems`, `TagIndex`, `LinkGraph`, `FrontmatterValueIndex` (#563), `WeightConfig` |
| `index.ts` | `EnrichmentModule`, type re-exports, `renderEnrichmentSettings` re-export | Orchestrator; registers commands; exclusion checks; vault scan; checkpoint resume; auto-accept; per-note queue serialization (private `runEnrichment`, `enrichFile`, `acceptSelected`, #483) |
| `vault-analyzer.ts` | `VaultAnalyzer` | Cached vault-wide `TagIndex`, `LinkGraph`, and per-key frontmatter value sets (#563) from `MetadataCache`; invalidated on `'resolved'` event |
| `weight-calculator.ts` | `computeProximityWeight` | Pure function: folder-proximity scoring |
| `metadata-classifier.ts` | `MetadataClassifier` | Tag classification against the user-defined vocabulary: System 1 `choice` per category when `ai.systemOne` is on, generative prompt for the rest (#558); rejects hallucinated tags |
| `topic-extractor.ts` | `TopicExtractor` | AI topic extraction; matched topics → `InternalLinkCandidate`; unmatched topics accumulated for multi-note resolution |
| `link-resolver.ts` | `LinkResolver` | Graph-based internal link candidates (link hops, shared tags, folder proximity); merges with topic candidates |
| `prompt-builder.ts` | `PromptBuilder` | AI prompts for external link suggestions; frontmatter suggestions with a System 1 `choice` per lane key first when `ai.systemOne` is on (#563) |
| `enrichment-store.ts` | `EnrichmentStore` | CRUD for enrichment proposal JSON files in the enrichment folder |
| `enrichment-applier.ts` | `EnrichmentApplier` | Applies/undoes accepted enrichments to note content non-destructively via `vault.process` |
| `enrichment-modal.ts` | `EnrichmentDetailModal` | Per-item toggle modal for reviewing a single proposal |
| `settings-section.ts` | `renderEnrichmentSettings` | Settings UI accordion for the enrichment feature (#243) |
| `*.test.ts` | Co-located Vitest suites | `vault-analyzer`, `weight-calculator`, `metadata-classifier`, `topic-extractor`, `link-resolver`, `prompt-builder`, `enrichment-store`, `enrichment-applier`, `settings-section`, `auto-accept` (#228), `review-toast` (#366), `cache-report` (#527: single-enrich hit/miss, no-enrichment hit, vault-scan aggregate hit/miss), `metadata-classifier.system-one` (#558: toggle off = zero lane calls + identical output, per-category choice shape, uncertain-only fallback, vocabulary guard, probabilities floor, transport/401 fallback), `prompt-builder.system-one` (#563: toggle off = zero lane calls + identical prompt/output, per-key choice shape + 254 cap, confident = no `complete()`, `<new-value>`/no-values keys restricted prompt, sub-floor, list-key merge, vault-value guard, transport fallback) |

## Internal Class Signatures

```ts
// vault-analyzer.ts
class VaultAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  invalidate(): void
  buildTagIndex(): TagIndex
  buildFrontmatterValueIndex(keys: readonly string[]): FrontmatterValueIndex   // :29; per-key values over getIncludedMarkdownFiles(app, 'enrichment'), scalar|array -> trimmed string set, most frequent first; cached per key until invalidate() (#563)
  buildLinkGraph(): LinkGraph
  getFileTags(file: TFile): string[]
  getOutgoingLinks(filePath: string): string[]
  getIncomingLinks(filePath: string): string[]
}
// weight-calculator.ts
function computeProximityWeight(sourcePath: string, targetPath: string, config: WeightConfig): number
// metadata-classifier.ts
class MetadataClassifier {
  constructor(getSettings: () => SynapseSettings)                 // owns an AIClient and a DecisionClient (#558)
  classify(noteContent: string, existingTags: string[], aiOpts?: DecisionRequestOptions): Promise<TagCandidate[]>   // :47; lane on (:59) -> classifyWithSystemOne (:115): one choice per TagVocabularyEntry over its tags + '<none>' (:18), state = body[0:3000] + existing tags; partitionByConfidence at ai.systemOne.confidenceFloor; confident non-none choice -> candidate, other options with probability >= floor also surface; uncertain categories (and any lane error) -> getClassificationsFromAI restricted to those categories; aiOpts.onSystemOne() when any category was decided by the lane; vocabulary guard + TAG_PATTERN + maxTags unchanged
}
// topic-extractor.ts
class TopicExtractor {
  constructor(app: App, analyzer: VaultAnalyzer, getSettings: () => SynapseSettings)
  extractTopics(noteContent: string, notePath: string, existingLinkPaths: string[], aiOpts?: AIRequestOptions): Promise<InternalLinkCandidate[]>   // aiOpts reaches complete() (#527)
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
  suggestExternalLinks(noteContent: string, existingLinks: string[], aiOpts?: AIRequestOptions): Promise<ExternalLinkCandidate[]>   // aiOpts reaches complete() (#527)
  suggestFrontmatter(noteContent: string, existingFrontmatter: Record<string, unknown>, aiOpts?: DecisionRequestOptions, vaultValues?: (keys: readonly string[]) => FrontmatterValueIndex): Promise<FrontmatterEnrichment[]>   // :131; lane off or no vaultValues -> unchanged prompt (#527). Lane on -> one choice per LANE_FM_KEYS (:30: category/type/status scalar 'add', topics/related-projects list 'merge') key the note lacks, over its vault values (<= 254, most frequent first) + '<new-value>'; state = body[0:3000] + current frontmatter JSON; partitionByConfidence at ai.systemOne.confidenceFloor; confident existing value -> suggestion (list keys also take other options with probability >= floor); '<new-value>', sub-floor, and no-values keys -> generative prompt restricted to those keys; lane error or no question asked -> full prompt; aiOpts.onSystemOne() when any key was lane-decided; SAFE_FM_KEY + FORBIDDEN_FM_KEYS + existing-key skip apply to both lanes (#563)
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
// index.ts — private queue cores (#483): callers hold the note's NoteOperationQueue slot; these must not re-enter it
private runEnrichment(file: TFile, trigger: EnrichmentTrigger, op: OperationHandle, options?: { postOp?: boolean }): Promise<void>  // index.ts:447; core of enrich(); owns one CacheUse (index.ts:453) and the withCacheReport finish lines (index.ts:464, index.ts:476, #527)
private enrichFile(file: TFile, trigger: EnrichmentTrigger, cacheUse?: CacheUse): Promise<string | null>   // index.ts:490; per-note core, also queued directly by scanVault + resumeFromCheckpoint; aiOpts = trackAiCache(cacheUse) (index.ts:507)
private acceptSelected(id: string, accepted: AcceptedItems, options?: { silent?: boolean }): Promise<void>   // index.ts:624; core of acceptSelectedFromView
private maybeAutoAccept(proposalId: string, batch?: boolean): Promise<boolean>   // index.ts:603; calls the lock-free acceptSelected directly (callers already hold the slot)
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
- `src/shared`: `NoteOperationQueue` (#483), `isPathExcluded`, `matchesExcludeTag`, `findMatchingRule`, `reviewAction`, `getIncludedMarkdownFiles`, `getMarkdownFiles`, `NotificationManager`, `CheckpointManager`, `FolderPickerModal`, `AIClient`, `parseFrontmatter`, `serializeFrontmatter`, `mergeTags`, `asStringArray`, `buildCallout`, `CALLOUT_TYPES`, `ENRICHMENT_START`, `ENRICHMENT_END`, `sanitizeAIResponse`, `parseJson`, `isRecord`, `generateId`, `isTwitterUrl`, `fetchTweetContent`, `fireAndForget`, `ensureFolder`, `readJsonFile`, `addEnhancedSlider`, `trackAiCache`, `withCacheReport`, `DecisionClient`, `choice`, `partitionByConfidence`, `MAX_CHOICE_OPTIONS`, `redactError` (#558); types `AIRequestOptions`, `DecisionRequestOptions`, `ChoiceQuestion`, `ChoiceAnswer` (#563), `CacheUse`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `SettingsSectionContext`
- `src/commands`: `CommandRegistrar`
- `src/settings`: `SynapseSettings`, `TagVocabularyEntry`, `EnrichmentWeightSettings`
- `src/shared` types `ModuleDeps`, `FeatureModule`, `OperationHandle` (constructor bundle + lifecycle contract, #504)

Out (consumed by other modules):
- `src/modules/registry.ts`: constructs `new EnrichmentModule(deps, autoAccept(deps, 'enrichment'))` (`modules/registry.ts:92`)
- `src/main.ts`: wires `onViewRefreshNeeded`, `onOpenProposalView`; calls `scanVault()` (`main.ts:95`), `getPendingProposals()` (`main.ts:112`), `resumeFromCheckpoint()` (`main.ts:126`), `acceptSelectedFromView()` / `rejectFromView()` (`main.ts:149-150`), `enrich(path, trigger, { postOp: true })` via `PostOpHookDeps.enrich` (`main.ts:188`); assigns `onEnrichmentApplied = buildPostOpHook(postOpDeps, 'enrichment')` (`main.ts:198`; illustrate leg only, fired from `enrichment/index.ts:646-649` with `sourceUrls` + `producedRegion: { kind: 'whole-note' }`)

No feature-module dependencies (enrichment does not import from elaboration, transcription, etc.).

## Data Flow

```
enrich(filePath, trigger, options?)
  └─ getAbstractFileByPath → TFile guard
  └─ isExcluded(file)  ← isPathExcluded('enrichment', settings) || matchesExcludeTag
  │    └─ if trigger === 'manual' && excluded → Notice naming findMatchingRule(); else silent (#307)
  └─ noteQueue.run(file.path, runEnrichment) [#483; silent, no onWait — enrichment is an automatic
  │    post-op side effect, so it queues behind the primary operation and reads what it wrote]
  └─ enrichFile(file, trigger, cacheUse?) [private]  (fetchTwitterContext prepends tweet text to classifier body)
       ├─ aiOpts = trackAiCache(cacheUse)           [one CacheUse per enriched note, #527]
       ├─ MetadataClassifier.classify(.., aiOpts)   → TagCandidate[]   (System 1 choice per category first when ai.systemOne is on, #558)
       ├─ LinkResolver.findInternalLinks()          → InternalLinkCandidate[] (graph)
       ├─ TopicExtractor.extractTopics(.., aiOpts)  → InternalLinkCandidate[] (topics)
       ├─ PromptBuilder.suggestExternalLinks(.., aiOpts)  → ExternalLinkCandidate[]
       ├─ PromptBuilder.suggestFrontmatter(.., aiOpts, keys => analyzer.buildFrontmatterValueIndex(keys))    → FrontmatterEnrichment[]   (System 1 choice per key over existing vault values first when ai.systemOne is on, #563)
       ├─ LinkResolver.mergeTopicCandidates(topicLinks, graphLinks)
       └─ EnrichmentStore.save(proposal)  [skipped when totalItems === 0 → returns null]
  └─ topicExtractor.clearPending(); op.finish(withCacheReport('Enrichment proposal created' | 'No enrichments needed', [cacheUse]), reviewAction(...)) [#527; Review toast unless postOp/auto-accept #366]; maybeAutoAccept(id) [if shouldAutoAccept()]
  └─ refreshView() → onViewRefreshNeeded()
```

```
scanVault(folderPath?, skipConfirmation?, onlyFile?)
  Phase 1: collect eligible (non-excluded) files; warm buildTagIndex()/buildLinkGraph() caches
  Phase 2: NotificationManager.confirm()  [skipped if skipConfirmation]
  Phase 3: CheckpointManager.create(); cancellable per-file enrichFile() wrapped in
           noteQueue.run(path, ...) per note (#483, silent); completeItem() per file
  Phase 4: TopicExtractor.resolveNewNoteCandidates()
           → topics cited by 2+ notes → new-note InternalLinkCandidates
           → merged into existing proposals via LinkResolver.mergeTopicCandidates()
  Auto-accept (#228): runs AFTER Phase 4 so merged candidates are included; batch mode (one summary Notice);
           each apply takes its own note's queue slot: noteQueue.run(notePath, () => maybeAutoAccept(id, true)) (#483)
  Finish: withCacheReport('Generated N proposals' | 'Resumed -- generated N proposals', cacheUses, 'note') — one aggregated cache line, one CacheUse per note processed incl. notes that needed no enrichment (#527)
  On cancel/error: discard checkpoint, clearPending(), rejectProposalBatch()
```

```
User review (UnifiedProposalView / EnrichmentDetailModal):
  Accept Selected → acceptSelectedFromView(id, accepted)
                    → noteQueue.run(proposal.sourceNotePath, acceptSelected) (#483, silent)
                    → EnrichmentApplier.apply(proposal, accepted)
                    → EnrichmentStore.updateStatus(id, 'accepted' | 'partially-accepted')
  Reject          → rejectFromView(id)
                    → EnrichmentStore.updateStatus(id, 'rejected')
```

## Exclusion Handling (#307)

Exclusion uses the centralized `src/shared/exclusions.ts` API. Per-module `excludeFolders` was removed; path exclusions live in `settings.exclusions: ExclusionRule[]` at the top level, scoped by feature name.

```ts
// index.ts:703-709
private isExcluded(file: TFile): boolean {
  const settings = this.getSettings();
  return (
    isPathExcluded(file.path, 'enrichment', settings) ||
    matchesExcludeTag(file, settings.enrichment.excludeTags, this.plugin.app.metadataCache)
  );
}
```

`findMatchingRule(file.path, 'enrichment', settings)` is called only on the manual-trigger path to surface the matching rule pattern in the user-facing notice (`index.ts:426-436`).

## Settings Keys

All under `settings.enrichment` (interface `EnrichmentSettings`, `settings.ts:239-254`) unless noted. Defaults from `DEFAULT_SETTINGS.enrichment` (`settings.ts:548-574`).

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module activation; gates command registration |
| `autoEnrich` | `boolean` | `true` | Auto-trigger after elaboration/transcription/summarization |
| `maxTags` | `number` | `5` | Max metadata tags suggested per note |
| `maxInternalLinks` | `number` | `15` | Max related-note link suggestions |
| `maxExternalLinks` | `number` | `3` | Max external references (`0` = disable; `suggestExternalLinks` early-returns) |
| `maxTopicLinks` | `number` | `10` | Max topic-extracted link candidates per note |
| `suggestNewNotes` | `boolean` | `true` | Accumulate unmatched topics as new-note suggestions |
| `tagVocabulary` | `TagVocabularyEntry[]` | 3 entries: Status, Type, Source | Classification categories + valid tags for `MetadataClassifier`; each entry becomes one System 1 `choice` when `settings.ai.systemOne.enabled` (#558; floor `ai.systemOne.confidenceFloor`, default 0.6; a category with >= 255 tags stays on the generative path) |
| `internalLinkThreshold` | `number` | `0.3` | Min relevance score to include a link candidate |
| `weights` | `EnrichmentWeightSettings` | see below | Proximity weight tiers for `computeProximityWeight` |
| `enrichmentFolderPath` | `string` | `'.synapse/enrichments'` | Path to proposal JSON storage |
| `excludeTags` | `string[]` | `['no-enrich']` | Tags that suppress enrichment for a note |
| `relatedNotesHeading` | `string` | `'Related Notes'` | Heading for the internal-links callout |
| `referencesHeading` | `string` | `'References'` | Heading for the external-links callout |
| `settings.exclusions` (top-level) | `ExclusionRule[]` | — | Path/glob exclusions scoped by feature `'enrichment'`; replaces removed `excludeFolders` |
| `settings.autoAccept.enrichment` (top-level) | `boolean` | — | Wired to the `shouldAutoAccept` constructor param (#228) |

`TagVocabularyEntry` = `{ category: string; tags: string[]; description: string }` (`settings.ts:233-237`). Default vocabulary: `Status` (draft, todo, reference, unfinished, needs-review, archived), `Type` (meeting, idea, project, log, guide, brainstorm), `Source` (source/video, source/audio, source/transcript, source/article, source/book). `EnrichmentWeightSettings` defaults (`settings.ts:562-569`): `sameFolder 1.0`, `siblingFolder 0.8`, `cousinFolder 0.5`, `distantFolder 0.2`, `decayPerLevel 0.15`, `minWeight 0.1`.

## Invariants

- Related Notes entries whose link text does not resolve (`linkResolves`) are dropped at apply time; unresolved `[[links]]` in suggested frontmatter strings become plain text (#581).
- Applied sections are Obsidian callouts `> [!info|synapse-enrichment]` (`CALLOUT_TYPES.enrichment`, `src/shared/callouts.ts:L16`; base from `CALLOUT_BASES`, #554), written via `buildCallout` (`enrichment-applier.ts:L180,L208`); `removeEnrichmentSections` (`:L215`) strips both that form and the legacy bare `> [!synapse-enrichment]` via `calloutHeaderSource`.
- Idempotent re-write / undo: `removeEnrichmentSections` strips both callout sections AND legacy comment markers `%% synapse-enrichment-start %%` / `%% synapse-enrichment-end %%` (`ENRICHMENT_START` / `ENRICHMENT_END`, `src/shared/callouts.ts:L66-67`) before re-writing (`enrichment-applier.ts:L215-240`).
- Writes are atomic: `apply` and `undo` re-derive content inside `vault.process` callbacks (`enrichment-applier.ts:L36,L129`).
- Frontmatter keys never overwritten: `action: 'add'` skips if key exists; `action: 'merge'` appends new array values (dedup via `asStringArray`).
- Frontmatter key allowlist `^[a-z][a-z0-9_-]{0,49}$` (`prompt-builder.ts:17`); forbidden keys (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`) blocked (`prompt-builder.ts:20-27`); `tags` key also rejected.
- Tag format `^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,49}$`; only vocabulary tags accepted, hallucinated tags dropped (`metadata-classifier.ts:16,69-84`).
- External URL validation: HTTP/HTTPS only, in both proposal generation (`prompt-builder.ts:42-49`) and write-out (`enrichment-applier.ts:196-205`).
- New-note topic threshold: a topic must be surfaced by 2+ notes during a vault scan to become a suggestion; new-note candidate `relevanceScore` = `0.5` (`topic-extractor.ts:124,129`).
- Double-acceptance guard: `acceptSelected` and `maybeAutoAccept` bail if `proposal.status !== 'pending'` (`index.ts:632`, `index.ts:607`); both re-load the proposal inside the queue slot, so a wait cannot leave the decision on stale state (#483).
- Empty proposals skipped: `enrichFile` returns `null` when no items are produced (`index.ts:553`).
- Per-note serialization (#483): every note-mutating path acquires the note's `NoteOperationQueue` slot exactly ONCE — `enrich` (`index.ts:443`), the `scanVault` per-file loop (`index.ts:314`), `resumeFromCheckpoint` (`index.ts:154`), the batch auto-accept loops (`index.ts:188`, `index.ts:375`), and `acceptSelectedFromView` (`index.ts:576`). All queue SILENTLY (no `onWait`): enrichment is an automatic post-op side effect and review-panel accepts are perceived as immediate. The private cores (`runEnrichment`, `enrichFile`, `acceptSelected`) never re-enter the queue; `maybeAutoAccept` therefore calls `acceptSelected` directly, never `acceptSelectedFromView`.
- Review toast (#366): completion notices attach an optional Review action via `reviewAction({ generated, shouldAutoAccept, openProposalView, postOp })` (`src/shared`), surfaced only when proposals were generated AND enrichment auto-accept is off; `postOp` (chained auto-enrich) suppresses it. Used by `enrich` (`index.ts:465`), `scanVault` (`index.ts:388`), `resumeFromCheckpoint` (`index.ts:198`).
- Cache report (#527): every finish line goes through `withCacheReport` — single-note (`index.ts:464`, `index.ts:476`), `scanVault` aggregate with unit `'note'` (`index.ts:387`), resume aggregate (`index.ts:197`); one `CacheUse` per note processed, filled via `trackAiCache` on every analyzer call (`index.ts:507`).
- Proposal JSON filename: `<sanitized-path>-enrich-<8charId>.json`; null bytes and `..` stripped (`enrichment-store.ts:113-121`).
- `VaultAnalyzer` caches invalidate on the `metadataCache 'resolved'` event (`index.ts:87-91`).
