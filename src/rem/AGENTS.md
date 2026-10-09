---
last-updated: 2026-10-09
---

# REM Module

REM (Re-link & Enrich Mappings): discovers linkable references in note text (literal title/alias matches plus always-on AI semantic matches) and proposes in-place `[[wikilink]]` insertions. Accepting a proposal rewrites the note body. Participates in the Fire Synapse pipeline (`pipelineKey: rem`) and the unified proposal view.

## Public API (`index.ts`)

```ts
class RemModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:51; #504 bundle (plugin, getSettings, notifications, checkpointManager, registrar); #228 getter default () => false
  onload(): Promise<void>
  onunload(): void
  remScanNote(filePath: string): Promise<RemProposal | null>
  remScanDirectory(folderPath?: string, _skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>  // _skipConfirmation currently unused
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  acceptProposal(id: string, acceptedMatchTexts: string[], options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
  undoProposal(id: string): Promise<void>
  getPendingProposals(): Promise<RemProposal[]>
}
```

Exported types: `RemProposal`, `RemLinkCandidate`, `RemOccurrence`, `RemSettings`

Note: `RemMatchType` and `RemProposalStatus` are defined in `types.ts` but not re-exported from `index.ts`. Import them directly from `./types` if needed.

Exported functions: `renderRemSettings(ctx: SettingsSectionContext): void`

## Types (`types.ts`)

```ts
type RemMatchType = 'title' | 'alias' | 'semantic'
type RemProposalStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected'

interface RemOccurrence {
  lineNumber: number      // zero-based line number in source note
  lineText: string        // full text of the matched line
  startOffset: number     // start offset within line
  endOffset: number       // end offset within line (exclusive)
}

interface RemLinkCandidate {
  targetPath: string          // vault path of target note
  targetDisplayName: string   // basename without extension
  matchedText: string         // text in source note that was matched
  matchType: RemMatchType
  occurrences: RemOccurrence[]
  confidence: number          // title/alias raw 1.0 down-weighted by titleMatchWeight; semantic: lane = P(strongly related), System 2 = model rating
  lane?: DecisionLane         // semantic only: 'system-one' | 'system-two' (#566)
}

interface RemProposal {
  id: string
  sourceNotePath: string
  createdAt: string
  candidates: RemLinkCandidate[]
  status: RemProposalStatus
  lane?: DecisionLane           // lane of the semantic candidates, absent when only literal (#566)
  acceptedLinks?: string[]      // accepted matchedTexts (set on accept)
  originalContent?: string      // pre-apply snapshot (set on accept, for undo)
}

interface RemSettings {
  enabled: boolean
  titleMatchWeight: number      // weight for literal title/alias matches (0-1)
  confidenceThreshold: number   // minimum relevance for a semantic link in either lane (0-1)
  maxLinksPerNote: number
  remFolderPath: string
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `index.ts` | `RemModule`, type + fn re-exports | Orchestrator, commands, scan + accept/reject/undo |
| `types.ts` | `RemProposal`, `RemLinkCandidate`, `RemOccurrence`, `RemMatchType`, `RemProposalStatus`, `RemSettings` | Type model |
| `mention-scanner.ts` | `MentionScanner` | Phase 1: literal title/alias mention scanning |
| `semantic-matcher.ts` | `SemanticMatcher`, `RELEVANCE_LEVELS`, `relevanceFromScore`, `anchorSentences`, `RemLaneError`, `NO_ANCHOR` | Phase 2: semantic matching; lane-only (`score` + anchor `choice`) when `ai.systemOne` is on, one generative prompt otherwise (#558, #566) |
| `overlaps.ts` | `withoutOverlaps` | Drops occurrences overlapping a higher-ranked candidate's, then candidates left with none |
| `rem-applier.ts` | `RemApplier`, `RemApplyResult` | Inserts `[[wikilinks]]` for accepted candidates after validating each occurrence against the fresh content (re-locate nearest whole-word non-skipped match, else drop; #575) |
| `skip-regions.ts` | `buildSkipRegions`, `isInSkipRegion`, `isWordBoundary`, `lineStartOffsets`, `withoutSkipRegions` | Unlinkable ranges (frontmatter, code, wikilinks/embeds, md links, `synapse-summary` callouts) shared by scanner, applier, and the semantic filter |
| `rem-store.ts` | `RemStore` | Proposal persistence under `rem.remFolderPath` |
| `settings-section.ts` | `renderRemSettings` | REM settings UI section |
| `mention-scanner.test.ts` | Tests | MentionScanner tests |
| `auto-accept.test.ts` | Tests | Auto-accept behavior tests (#228) |
| `rem-applier.test.ts` | Tests | RemApplier tests incl. stale-offset re-locate/drop/dedupe (#575) |
| `skip-regions.test.ts` | Tests | Skip regions incl. summary callouts, `withoutSkipRegions` |
| `semantic-matcher.test.ts` | Tests | SemanticMatcher generative-path tests |
| `semantic-matcher.system-one.test.ts` | Tests | #558/#566: strongly-related mapping, `anchorSentences`, lane off = zero lane calls + anchor required, lane on = score with folder + anchor choice + zero `complete()`, `<none>` drop, related-only mass rejected, 529 -> `RemLaneError`, already-linked targets excluded |
| `overlaps.test.ts` | Tests | `withoutOverlaps` |
| `index.test.ts` | Tests | RemModule integration tests; lane skip, proposal `lane`, overlap drop, directory skip count (#566) |
| `settings-section.test.ts` | Tests | Settings section tests |
| `review-toast.test.ts` | Tests | Review-toast action: forwarded when auto-accept off, omitted when on (#366) |
| `cache-report.test.ts` | Tests | #527 finish wording: single-note hit/miss, no-candidate hit, directory-scan aggregate hit/miss |

## Data Flow

```
remScanNote(filePath)
  --> isExcluded? (isPathExcluded 'rem' + enrichment.excludeTags)
  --> gatherCandidates(file, content, cacheUse):
        MentionScanner.scan(...) literal candidates, down-weighted by titleMatchWeight
        SemanticMatcher.match(..., trackAiCache(cacheUse)) always-on, filtered by confidenceThreshold   (#527)
          titles = included notes minus self, literal matches, and every [[wikilink]] target already in the note (linkedTargets, semantic-matcher.ts:318; getFirstLinkpathDest + link text)
          lane on (matchOnLane, :147) — zero complete() calls (#566):
            anchorSentences(content[0:4000]) (:54; frontmatter/code fences/list markers skipped, sentences with [ ] | ` dropped, deduped, <= MAX_CHOICE_OPTIONS-1); none -> []
            one score per title over RELEVANCE_LEVELS (:26) with its folder in the question; relevance = P(strongly related) only (relevanceFromScore, :41)
            titles >= confidenceThreshold, top maxLinks by relevance -> one choice per survivor over s0..sN + '<none>' (locateAnchors, :291); '<none>' -> dropped
            candidate.matchedText = chosen sentence, one occurrence at its span, confidence = relevance, lane 'system-one'; aiOpts.onSystemOne() after the lane answered
            any lane error -> RemLaneError (no generative fallback)
          lane off (matchGenerative): one complete() over the title list; concept with zero occurrences -> dropped; lane 'system-two'
        RemLaneError -> console.warn via redactError, gatherCandidates returns null -> note skipped (single note: info Notice; scans: ", N skipped after a System 1 lane failure" in the finish line)
        merge (semantic filtered by withoutSkipRegions) + re-rank by confidence desc + withoutOverlaps + cap at maxLinksPerNote
  --> buildProposal: RemProposal { candidates, status: 'pending', lane? } --> RemStore.save
  --> withCacheReport('Found N linkable mentions' | 'No linkable mentions found', [cacheUse]) Notice (#527) + reviewAction({ generated, shouldAutoAccept, openProposalView }): "Review" shown only when NOT auto-accepting (#366)
  --> maybeAutoAccept(proposal)   (#228, when shouldAutoAccept())
  --> refreshView()

remScanDirectory(folderPath?, skipConfirmation?, onlyFile?)
  --> getMarkdownFiles filtered by isExcluded
  --> CheckpointManager.create(module: 'rem', items)
  --> addDeferredTask('refresh-sidebar-view')
  --> for each file: gatherCandidates(file, content, cacheUse) (literal down-weighted + always-on semantic, merged/re-ranked), push cacheUse, save proposal, maybeAutoAccept(batch=true)
  --> completeItem() per file
  --> on error: rejectProposalBatch(createdIds) + return 0
  --> on cancel: discard() + rejectProposalBatch()
  --> on success: complete() + dispatchDeferredTasks
  --> withCacheReport('REM scan complete -- N notes with linkable mentions' | 'Resumed -- generated N proposals', cacheUses, 'note') finish Notice — one aggregated cache line, one CacheUse per note scanned (#527) + reviewAction({ generated: created>0, shouldAutoAccept, openProposalView }): "Review" shown only when NOT auto-accepting (#366); separate "Auto-accepted ..." info Notice when autoAcceptedCount > 0

acceptProposal(id, acceptedMatchTexts, options?)
  --> guard: only 'pending' proposals (cascade safety)
  --> vault.process(file, (data) => { originalContent = data; outcome = applier.apply(data, accepted); applied > 0 ? outcome.content : data })
  --> applied === 0: info Notice "No links inserted ...", proposal stays pending (#575)
  --> store.updateStatus(id, 'accepted'|'partially-accepted', applied candidates' matchedTexts, originalContent)
  --> dropped > 0: info Notice "Skipped N link(s) whose text changed since the REM scan" (#575)

undoProposal(id)
  --> load proposal.originalContent snapshot
  --> vault.process(file, () => originalContent)
  --> store.updateStatus(id, 'pending', undefined, undefined)   // resets to pending
```

Lane attribution (#566): `views/unified-proposal-view.ts` REM card shows "Semantic links decided by the System 1 lane" when `proposal.lane === 'system-one'`; review rows tag each lane candidate "System 1 lane"; finish notices carry "decided by the System 1 lane" via `CacheUse.systemOne`.

## Commands

Registered in `onload()` (both gated by `rem.enabled`):

| ID | Name | Type | Pipeline |
|----|------|------|---------|
| `synapse:rem-current-note` | REM: discover links in current note | editorCallback | palette |
| `synapse:rem-directory` | Scan folder for links | callback (FolderPickerModal) | palette, fire-synapse (`pipelineKey: rem`) |

## Auto-Accept (#228)

`shouldAutoAccept` is wired by `main.ts` to `() => settings.autoAccept.rem` (default false).

When true, a freshly generated proposal is accepted in full immediately after creation. Batch directory scans use `silent=true` per proposal and emit one summary Notice.

WARNING: REM auto-accept REWRITES note body text (inserts `[[wikilinks]]`). This is unlike proposal kinds that only add separate sections.

## Checkpoint Behavior

`remScanDirectory` and `resumeFromCheckpoint` use `CheckpointManager` with module `'rem'`. Items tracked as `rem-{index}-{path}`. On error or cancel, all proposals created in the run are batch-rejected via `rejectProposalBatch()`.

Resume re-checks exclusion rules silently (a path may have been excluded after checkpoint creation). Resume runs the same `gatherCandidates` pipeline as a fresh scan (literal + always-on semantic), so resumed items also get content-relevant links (#380).

## Exclusion Rules

```ts
// index.ts:L503-509
private isExcluded(file: TFile): boolean {
  const settings = this.getSettings();
  return (
    isPathExcluded(file.path, 'rem', settings) ||
    matchesExcludeTag(file, settings.enrichment.excludeTags, this.plugin.app.metadataCache)
  );
}
```

Path exclusion: centralized `settings.exclusions: ExclusionRule[]` (#307). No per-module `excludeFolders` field.
Tag exclusion: reuses `settings.enrichment.excludeTags` (REM has no separate `excludeTags` field).

Single-note command (`rem-current-note`) names the matched rule in the Notice. Directory scan silently skips.

## Settings Keys

All under `settings.rem` (`RemSettings`):

Interface `settings.ts:301`; defaults `settings.ts:615-621`.

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | `true` | Module + command activation |
| `titleMatchWeight` | `number` | `0.6` | Weight for literal title/alias matches when ranking (0-1) |
| `confidenceThreshold` | `number` | `0.5` | Min relevance for a semantic candidate in either lane (0-1): lane = P(strongly related), System 2 = model rating; literal matches not gated (#566) |
| `settings.ai.systemOne` (top-level) | `SystemOneSettings` | `enabled: false` | On = lane-only semantic matching in `SemanticMatcher` (#566) |
| `maxLinksPerNote` | `number` | `20` | Max link candidates per scanned note |
| `remFolderPath` | `string` | `.synapse/rem` | Storage folder for proposal JSON files |

Settings UI (`settings-section.ts`) renders only the `enabled` toggle, `confidenceThreshold` slider, and `maxLinksPerNote` text input. `titleMatchWeight` has no UI control (#380) — edit `data.json` directly to change it.

## Dependencies

| Import | From |
|--------|------|
| `generateId`, `getMarkdownFiles`, `FolderPickerModal`, `fireAndForget`, `isPathExcluded`, `matchesExcludeTag`, `findMatchingRule`, `redactError`, `reviewAction`, `trackAiCache`, `withCacheReport`, `CacheUse` | `../shared` |
| `NotificationManager`, `CheckpointManager`, `DeferredTask`, `CheckpointWorkItem`, `Checkpoint` | `../shared` (type-only) |
| `CommandRegistrar` | `../commands` (type-only) |
| `SynapseSettings`, `RemSettings` | `../settings` (type-only) |
| `MentionScanner` | `./mention-scanner` |
| `withoutSkipRegions` | `./skip-regions` |
| `SemanticMatcher`, `RemLaneError` | `./semantic-matcher` |
| `withoutOverlaps` | `./overlaps` |
| `RemApplier`, `RemApplyResult` | `./rem-applier` |
| `RemStore` | `./rem-store` |

Internal-file shared imports: `semantic-matcher.ts` imports `AIClient`, `DecisionClient`, `score`, `choice`, `MAX_CHOICE_OPTIONS` (#558, #566), `ChoiceQuestion`/`DecisionRequestOptions`/`ScoreAnswer`/`ScoreQuestion` (types; `match(..., aiOpts?)` forwards `aiOpts` to `decide()` and `complete()`, #527), `isRecord`, `parseJson`, `getIncludedMarkdownFiles`, `redactError` from `../shared`. `RemLaneError` renders its cause through `redactError`, and `index.ts` logs the skip through it. Its AI-call failure sink routes `console.warn` through `redactError` (redaction single-source-of-truth); the JSON-parse failure path logs a static message with no error payload. `rem-store.ts` imports `ensureFolder`, `isRecord`, `readJsonFile`; `settings-section.ts` imports `addEnhancedSlider`, `SettingsSectionContext`; `skip-regions.ts` imports `scanBlocks`, `parseCalloutHeader`, `CALLOUT_TYPES`.
