---
last-updated: 2026-06-08
---

# REM Module

REM (Re-link & Enrich Mappings): discovers linkable references in note text (literal title/alias matches plus optional AI semantic matches) and proposes in-place `[[wikilink]]` insertions. Accepting a proposal rewrites the note body. Participates in the Fire Synapse pipeline (phase 4) and the unified proposal view.

## Public API

Exported from `index.ts`:

```ts
class RemModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    checkpointManager: CheckpointManager,
    registrar: CommandRegistrar,
    shouldAutoAccept?: () => boolean,        // #228; default () => false
  )
  onload(): Promise<void>                    // inits store/scanner/matcher/applier, registers commands
  onunload(): void
  remScanNote(filePath: string): Promise<RemProposal | null>
  remScanDirectory(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>  // PipelineScanFn
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  acceptProposal(id: string, acceptedMatchTexts: string[], options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
  undoProposal(id: string): Promise<void>    // restore originalContent snapshot
  getPendingProposals(): Promise<RemProposal[]>
  onViewRefreshNeeded: (() => Promise<void>) | null
}

// types.ts
type RemMatchType = 'title' | 'alias' | 'semantic'
type RemProposalStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected'

interface RemOccurrence { lineNumber: number; lineText: string; startOffset: number; endOffset: number }
interface RemLinkCandidate {
  targetPath: string
  targetDisplayName: string
  matchedText: string
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
  acceptedLinks?: string[]    // accepted matchedTexts (set on accept)
  originalContent?: string    // pre-apply snapshot (set on accept, for undo)
}
interface RemSettings {
  enabled: boolean
  semanticMatching: boolean
  confidenceThreshold: number
  maxLinksPerNote: number
  remFolderPath: string
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `index.ts` | `RemModule`, type re-exports | Orchestrator, commands, scan + accept/reject/undo |
| `types.ts` | `RemProposal`, `RemLinkCandidate`, `RemOccurrence`, `RemMatchType`, `RemProposalStatus`, `RemSettings` | Type model |
| `mention-scanner.ts` | `MentionScanner` | Phase 1: literal title/alias mention scanning |
| `semantic-matcher.ts` | `SemanticMatcher` | Phase 2: optional AI semantic matching |
| `rem-applier.ts` | `RemApplier` | Inserts `[[wikilinks]]` into note body for accepted candidates |
| `rem-store.ts` | `RemStore` | Proposal persistence under `rem.remFolderPath` |
| `mention-scanner.test.ts`, `auto-accept.test.ts` | Tests | |

## Data Flow

```
remScanNote(path) / remScanDirectory(folder?, skip?, onlyFile?)
  --> isExcluded? (reuses enrichment.excludeFolders / excludeTags)
  --> MentionScanner.scan(file, content, maxLinksPerNote)            // literal candidates
  --> if semanticMatching: SemanticMatcher.match(...) filtered by confidenceThreshold
  --> RemProposal { candidates, status: 'pending' } --> RemStore.save
  --> maybeAutoAccept(proposal)  (#228, when shouldAutoAccept())
  --> refreshView()
  (directory scan: CheckpointManager-backed, per-file completeItem, reverse-rollback on error/cancel)

acceptProposal(id, acceptedMatchTexts)
  --> guard: only 'pending' proposals (cascade safety — never rewrite body twice)
  --> RemApplier.apply(originalContent, accepted) --> vault.modify
  --> status: 'accepted' | 'partially-accepted'; stores acceptedLinks + originalContent (undo)
```

## Commands

Registered in `onload()` (both gated by `rem.enabled`):

| ID | Name | Type | Flows |
|----|------|------|-------|
| `synapse:rem-current-note` | REM: Discover links in current note | editorCallback | palette |
| `synapse:rem-directory` | REM: Discover links in directory | callback (FolderPickerModal) | palette, fire-synapse (`pipelineKey: rem`) |

## Auto-Accept (#228)

`shouldAutoAccept` is wired by `main.ts` to `() => settings.autoAccept.rem` (default false). When true, a freshly
generated proposal is accepted in full as generated. NOTE: REM auto-accept REWRITES note body text (inserts
`[[wikilinks]]`), unlike proposal kinds that only add separate sections.

## Checkpoint Behavior

`remScanDirectory` and `resumeFromCheckpoint` use `CheckpointManager` with module `'rem'`. Items tracked per file
(`rem-{index}-{path}`). On error/cancel, proposals created in the run are batch-rejected.

## Dependencies

| Import | From |
|--------|------|
| `NotificationManager`, `CheckpointManager`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `generateId`, `getMarkdownFiles`, `FolderPickerModal` | `../shared` |
| `CommandRegistrar` | `../commands` |
| `enrichment.excludeFolders` / `excludeTags` (settings) | reused for exclusion |

Exclusion rules reuse the enrichment settings rather than defining REM-specific ones.
