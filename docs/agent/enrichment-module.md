---
last-updated: 2026-09-17
status: implemented
module-path: src/enrichment/
---

# Enrichment Module

Adds tags, internal links, external references, and frontmatter attributes to notes using vocabulary-based metadata classification, AI topic extraction, vault graph analysis (proximity-weighted), and AI suggestions. Proposals are reviewed in the unified proposal sidebar. Detailed per-file reference: `src/enrichment/AGENTS.md`.

## Status

Implemented. This file mirrors the shipped layout; the original planned spec (`weight-engine.ts`, `enricher.ts`, `proposal-store.ts`, `undo-manager.ts`, `views/enrichment-view.ts`) was superseded by the files below.

## File Structure

```
src/enrichment/
  index.ts                 # EnrichmentModule (public API), command registration, scan/resume, queue wrappers
  types.ts                 # WeightConfig, TagCandidate, InternalLinkCandidate, ExternalLinkCandidate,
                           # FrontmatterEnrichment, EnrichmentResult, EnrichmentTrigger, EnrichmentStatus,
                           # AcceptedItems, EnrichmentProposal, TagIndex, LinkGraph
  vault-analyzer.ts        # VaultAnalyzer — cached TagIndex + LinkGraph from MetadataCache
  weight-calculator.ts     # computeProximityWeight — folder-proximity scoring
  metadata-classifier.ts   # MetadataClassifier — AI tag classification against user vocabulary
  topic-extractor.ts       # TopicExtractor — AI topic extraction -> link candidates
  link-resolver.ts         # LinkResolver — graph-based internal link candidates
  prompt-builder.ts        # PromptBuilder — external link + frontmatter prompts
  enrichment-store.ts      # EnrichmentStore — proposal JSON persistence
  enrichment-applier.ts    # EnrichmentApplier — apply/undo via vault.process
  enrichment-modal.ts      # EnrichmentDetailModal — per-item toggle modal
  settings-section.ts      # renderEnrichmentSettings — settings accordion (#243)
  *.test.ts                # co-located Vitest suites
```

## Public API (index.ts)

```ts
// index.ts:32
class EnrichmentModule implements FeatureModule {
  onViewRefreshNeeded: (() => Promise<void>) | null      // wired by main.ts
  onOpenProposalView: (() => void) | null                // wired by main.ts (#340)

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:60; ModuleDeps = { plugin, getSettings, notifications, checkpointManager, registrar, noteQueue } (#504); shouldAutoAccept default () => false (#228)

  onload(): Promise<void>                                 // index.ts:78; store.init, metadataCache 'resolved' invalidation, 3 command registrations
  onunload(): void                                        // index.ts:113; no-op
  getPendingProposals(): Promise<EnrichmentProposal[]>    // index.ts:116
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>   // index.ts:124
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // index.ts:217
  enrich(filePath: string, trigger: EnrichmentTrigger, options?: { postOp?: boolean }): Promise<void>   // index.ts:409; queued per note
  acceptSelectedFromView(id: string, accepted: AcceptedItems, options?: { silent?: boolean }): Promise<void>   // index.ts:563; queued per note
  rejectFromView(id: string): Promise<void>               // index.ts:612; no note write
}

function renderEnrichmentSettings(ctx: SettingsSectionContext): void   // re-exported, index.ts:740

// re-exported types (index.ts:20-29): AcceptedItems, EnrichmentProposal, EnrichmentResult, EnrichmentTrigger,
//   TagCandidate, InternalLinkCandidate, ExternalLinkCandidate, WeightConfig
```

## Types (types.ts)

```ts
interface WeightConfig { sameFolder: number; siblingFolder: number; cousinFolder: number; distantFolder: number; decayPerLevel: number; minWeight: number }   // :2
interface TagCandidate { tag: string; category: string; confidence: number; rawScore: number; weightedScore: number; sources: string[] }   // :17
interface InternalLinkCandidate { targetPath: string; displayText: string; relevanceScore: number; reason: string }   // :31
interface ExternalLinkCandidate { url: string; title: string; reason: string }   // :39
interface FrontmatterEnrichment { key: string; value: string | string[]; action: 'add' | 'merge' }   // :45
interface EnrichmentResult { tags: TagCandidate[]; internalLinks: InternalLinkCandidate[]; externalLinks: ExternalLinkCandidate[]; frontmatter: FrontmatterEnrichment[] }   // :51
type EnrichmentTrigger = 'elaboration' | 'transcription' | 'summarization' | 'deep-dive' | 'manual'   // :58
type EnrichmentStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected'   // :60
interface AcceptedItems { tags: string[]; internalLinks: string[]; externalLinks: string[]; frontmatter: string[] }   // :66
interface EnrichmentProposal { id: string; sourceNotePath: string; createdAt: string; triggerSource: EnrichmentTrigger; result: EnrichmentResult; status: EnrichmentStatus; acceptedItems?: AcceptedItems }   // :73
interface TagIndex { tags: Map<string, { count: number; files: string[] }> }   // :84
interface LinkGraph { outgoing: Map<string, Set<string>>; incoming: Map<string, Set<string>> }   // :90
```

## Settings (`settings.enrichment`, `EnrichmentSettings` settings.ts:213; defaults settings.ts:513)

| Key | Type | Default |
|-----|------|---------|
| `enabled` | boolean | `true` |
| `autoEnrich` | boolean | `true` |
| `maxTags` | number | `5` |
| `maxInternalLinks` | number | `15` |
| `maxExternalLinks` | number | `3` |
| `maxTopicLinks` | number | `10` |
| `suggestNewNotes` | boolean | `true` |
| `tagVocabulary` | `TagVocabularyEntry[]` (`{ category, tags, description }`) | 3 entries: Status, Type, Source |
| `internalLinkThreshold` | number | `0.3` |
| `weights` | `EnrichmentWeightSettings` | sameFolder 1.0, siblingFolder 0.8, cousinFolder 0.5, distantFolder 0.2, decayPerLevel 0.15, minWeight 0.1 |
| `enrichmentFolderPath` | string | `'.synapse/enrichments'` |
| `excludeTags` | string[] | `['no-enrich']` |
| `relatedNotesHeading` | string | `'Related Notes'` |
| `referencesHeading` | string | `'References'` |

Path exclusion uses the top-level `settings.exclusions` with feature id `'enrichment'` (#307). Auto-accept: `settings.autoAccept.enrichment` (#228).

## Commands (`src/commands/registry.ts`)

| Command ID | Name | Status | Handler (index.ts) |
|-----------|------|--------|--------------------|
| `synapse:enrich-current-note` | Enrich current note | active | `enrich(ctx.file.path, 'manual')` (index.ts:88) |
| `synapse:scan-vault-enrichment` | Scan folder for enrichment | active; Fire Synapse phase `enrichment` | `openScanFolderPicker` → `scanVault(path)` (index.ts:96) |
| `synapse:undo-enrichment` | Undo last enrichment on current note | disabled (registry master switch) | private `undoLastEnrichment(path)` (index.ts:104, index.ts:668) |

## Integration (modules/registry.ts, main.ts, pipeline/post-op-hooks.ts)

```
Constructed by modules/registry.ts:90: new EnrichmentModule(deps, autoAccept(deps, 'enrichment'))

Post-op hooks (pipeline/post-op-hooks.ts, built from main.ts:180-194; PostOpHookDeps.enrich = main.ts:183),
gated on enrichment.enabled && enrichment.autoEnrich:
  elaboration.onProposalAccepted(path) --> enrich(path, 'elaboration', { postOp: true })
  audio/video.onTranscriptionComplete   --> enrich(path, 'transcription', { postOp: true })
  image.onExtractionComplete            --> enrich(path, 'transcription', { postOp: true })
  summarize.onSummaryComplete           --> enrich(path, 'summarization', { postOp: true })
  deepDive.onNoteAccepted (autoEnrichOnAccept) --> enrich(path, 'deep-dive', { postOp: true })
All dispatched via fireAndForget (post-op-hooks.ts:43) from inside the primary operation's NoteOperationQueue slot (#483).

Proposals surface in UnifiedProposalView ('synapse-proposals'); accept/reject wired at main.ts:146-147
  onEnrichmentAcceptSelected(id, accepted) --> acceptSelectedFromView(id, accepted)
  onEnrichmentReject(id)                   --> rejectFromView(id)
Pipeline phase: main.ts:95 (scanVault); sidebar source: main.ts:111 (getPendingProposals); checkpoint resume: main.ts:124
```

No dedicated enrichment view exists; the sidebar is shared (`src/views/unified-proposal-view.ts`).

## Data Flow

```
command / post-op hook / scanVault
  --> enrich(path, trigger)  [NoteOperationQueue slot for path]
  --> VaultAnalyzer: TagIndex + LinkGraph (cached; invalidated on metadataCache 'resolved')
  --> MetadataClassifier (tags vs vocabulary) + TopicExtractor (topics -> links) + LinkResolver (graph links)
      + PromptBuilder (external links, frontmatter) via AIClient
      every AI call takes aiOpts = trackAiCache(cacheUse) (index.ts:502): one CacheUse per note (#527)
  --> EnrichmentResult -> EnrichmentStore (.synapse/enrichments/<id>.json, status 'pending')
  --> finish line = withCacheReport(message, cacheUses[, 'note']) (index.ts:459, :471 single; :382 scan, :192 resume aggregate)
  --> auto-accept (settings.autoAccept.enrichment) or Review toast (reviewAction, suppressed when postOp)
  --> UnifiedProposalView accept/reject -> EnrichmentApplier (vault.process, %% synapse-enrichment-start/end %% markers)
```

## Storage

| Purpose | Path | Format |
|---------|------|--------|
| Proposals | `.synapse/enrichments/*.json` | `EnrichmentProposal` |
| Checkpoints (vault scan) | `.synapse/checkpoints/*.json` | `Checkpoint` (module `enrichment`) |
