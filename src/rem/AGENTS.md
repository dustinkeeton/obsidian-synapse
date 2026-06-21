---
last-updated: 2026-06-19
---

# REM Module

REM (Re-link & Enrich Mappings): discovers linkable references in note text (literal title/alias matches plus optional AI semantic matches) and proposes in-place `[[wikilink]]` insertions. Accepting a proposal rewrites the note body. Participates in the Fire Synapse pipeline (phase 4) and the unified proposal view.

## Public API (`index.ts`)

```ts
class RemModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null

  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar,
    shouldAutoAccept?: () => boolean    // #228; default () => false
  )
  onload(): Promise<void>
  onunload(): void
  remScanNote(filePath: string): Promise<RemProposal | null>
  remScanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
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
  confidence: number          // 1.0 for title/alias; AI-assigned for semantic
}

interface RemProposal {
  id: string
  sourceNotePath: string
  createdAt: string
  candidates: RemLinkCandidate[]
  status: RemProposalStatus
  acceptedLinks?: string[]      // accepted matchedTexts (set on accept)
  originalContent?: string      // pre-apply snapshot (set on accept, for undo)
}

interface RemSettings {
  enabled: boolean
  semanticMatching: boolean
  confidenceThreshold: number   // minimum confidence for semantic matches (0-1)
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
| `semantic-matcher.ts` | `SemanticMatcher` | Phase 2: optional AI semantic matching |
| `rem-applier.ts` | `RemApplier` | Inserts `[[wikilinks]]` into note body for accepted candidates |
| `rem-store.ts` | `RemStore` | Proposal persistence under `rem.remFolderPath` |
| `settings-section.ts` | `renderRemSettings` | REM settings UI section |
| `mention-scanner.test.ts` | Tests | MentionScanner tests |
| `auto-accept.test.ts` | Tests | Auto-accept behavior tests (#228) |
| `rem-applier.test.ts` | Tests | RemApplier tests |
| `semantic-matcher.test.ts` | Tests | SemanticMatcher tests |
| `index.test.ts` | Tests | RemModule integration tests |
| `settings-section.test.ts` | Tests | Settings section tests |

## Data Flow

```
remScanNote(filePath)
  --> isExcluded? (isPathExcluded 'rem' + enrichment.excludeTags)
  --> MentionScanner.scan(file, content, maxLinksPerNote)   // literal candidates
  --> if semanticMatching:
        SemanticMatcher.match(file, content, alreadyMatched, remaining)
        filter by confidenceThreshold
  --> RemProposal { candidates, status: 'pending' } --> RemStore.save
  --> maybeAutoAccept(proposal)   (#228, when shouldAutoAccept())
  --> onOpenProposalView callback offered in Notice (when NOT auto-accepting)
  --> refreshView()

remScanDirectory(folderPath?, skipConfirmation?, onlyFile?)
  --> getMarkdownFiles filtered by isExcluded
  --> CheckpointManager.create(module: 'rem', items)
  --> addDeferredTask('refresh-sidebar-view')
  --> for each file: scan literals + semantic, save proposal, maybeAutoAccept(batch=true)
  --> completeItem() per file
  --> on error: rejectProposalBatch(createdIds) + return 0
  --> on cancel: discard() + rejectProposalBatch()
  --> on success: complete() + dispatchDeferredTasks
  --> Review action shown in finish Notice only when pending proposals remain

acceptProposal(id, acceptedMatchTexts, options?)
  --> guard: only 'pending' proposals (cascade safety)
  --> vault.process(file, (data) => { originalContent = data; applier.apply(data, accepted) })
  --> store.updateStatus(id, 'accepted'|'partially-accepted', acceptedLinks, originalContent)

undoProposal(id)
  --> load proposal.originalContent snapshot
  --> vault.process(file, () => originalContent)
  --> store.updateStatus(id, 'pending', undefined, undefined)   // resets to pending
```

## Commands

Registered in `onload()` (both gated by `rem.enabled`):

| ID | Name | Type | Pipeline |
|----|------|------|---------|
| `synapse:rem-current-note` | REM: Discover links in current note | editorCallback | palette |
| `synapse:rem-directory` | Scan folder for links | callback (FolderPickerModal) | palette, fire-synapse (`pipelineKey: rem`) |

## Auto-Accept (#228)

`shouldAutoAccept` is wired by `main.ts` to `() => settings.autoAccept.rem` (default false).

When true, a freshly generated proposal is accepted in full immediately after creation. Batch directory scans use `silent=true` per proposal and emit one summary Notice.

WARNING: REM auto-accept REWRITES note body text (inserts `[[wikilinks]]`). This is unlike proposal kinds that only add separate sections.

## Checkpoint Behavior

`remScanDirectory` and `resumeFromCheckpoint` use `CheckpointManager` with module `'rem'`. Items tracked as `rem-{index}-{path}`. On error or cancel, all proposals created in the run are batch-rejected via `rejectProposalBatch()`.

Resume re-checks exclusion rules silently (a path may have been excluded after checkpoint creation).

## Exclusion Rules

```ts
// index.ts:L495-500
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

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | `boolean` | — | Module + command activation |
| `semanticMatching` | `boolean` | — | Enable AI-based conceptual matching |
| `confidenceThreshold` | `number` | — | Min confidence for semantic candidates (0-1) |
| `maxLinksPerNote` | `number` | — | Max link candidates per scanned note |
| `remFolderPath` | `string` | `.synapse/rem` | Storage folder for proposal JSON files |

## Dependencies

| Import | From |
|--------|------|
| `generateId`, `getMarkdownFiles`, `FolderPickerModal`, `fireAndForget`, `isPathExcluded`, `matchesExcludeTag`, `findMatchingRule`, `NotificationManager`, `CheckpointManager` | `../shared` |
| `DeferredTask`, `CheckpointWorkItem`, `Checkpoint` | `../shared` (type-only) |
| `CommandRegistrar` | `../commands` (type-only) |
| `SynapseSettings`, `RemSettings` | `../settings` (type-only) |
| `MentionScanner` | `./mention-scanner` |
| `SemanticMatcher` | `./semantic-matcher` |
| `RemApplier` | `./rem-applier` |
| `RemStore` | `./rem-store` |
