---
last-updated: 2026-06-19
---

# Elaboration Module

Detects stub/placeholder notes in the vault and generates AI-powered elaboration proposals for non-destructive review. Includes image analysis to enrich proposals with context from embedded images.

## Public API

Exported from `index.ts`:

```ts
class ElaborationModule {
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
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  scanNote(file: TFile, userInvoked?: boolean): Promise<void>
  acceptProposal(id: string, editedContent?: string, options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
  getPendingProposals(): Promise<Proposal[]>
  onProposalAccepted: ((filePath: string) => void) | null
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null
}

type DetectionReason =
  | { type: 'short-note'; wordCount: number }
  | { type: 'todo-marker'; markers: string[] }
  | { type: 'empty-section'; heading: string }
  | { type: 'sparse-link'; linkedFrom: string[] }
  | { type: 'user-requested' }

interface DetectionResult {
  notePath: string
  reasons: DetectionReason[]
}

interface Proposal {
  id: string
  sourceNotePath: string
  createdAt: string
  detectionReasons: DetectionReason[]
  originalContent: string
  proposedAdditions: string
  insertionPoint: 'append' | 'after-heading' | 'replace-section'
  insertionTarget?: string
  status: 'pending' | 'accepted' | 'rejected'
  imageAnalysis?: ImageAnalysis[]
}

// settings-section.ts (also exported from index.ts)
function renderElaborationSettings(ctx: SettingsSectionContext): void
```

`ImageAnalysis` and `ImageAnalyzer` are internal to `image-analyzer.ts` (not re-exported from `index.ts`).

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `DetectionReason`, `DetectionResult`, `Proposal` | Type definitions |
| `detector.ts` | `PlaceholderDetector` | Scans notes for stub signals; applies centralized path exclusions + per-module tag exclusion |
| `proposer.ts` | `ProposalGenerator` | AI proposal generation; gathers linked-note context, image context, and external URL context |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON files in `.synapse/` storage |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Legacy sidebar view (not registered by `main.ts`) |
| `proposal-modal.ts` | `ProposalDetailModal` | Legacy modal for editing proposals |
| `image-analyzer.ts` | `ImageAnalyzer`, `ImageAnalysis`, `MAX_IMAGES_PER_NOTE` | Multi-modal AI image analysis for enriching elaboration proposals |
| `settings-section.ts` | `renderElaborationSettings` | Settings accordion renderer |
| `auto-accept.test.ts` | Tests | Auto-accept elaboration proposal tests |
| `scan-note.test.ts` | Tests | `scanNote` integration tests |
| `startup-flow.test.ts` | Tests | Startup scan + interval timer tests |
| `proposer.test.ts` | Tests | `ProposalGenerator` tests |
| `proposal-store.test.ts` | Tests | `ProposalStore` tests |
| `settings-section.test.ts` | Tests | Settings section rendering tests |
| `index.ts` | `ElaborationModule`, re-exports | Orchestrator, commands, scan intervals |

## Data Flow

```
1. scanVault() / scanNote()
   |
2. PlaceholderDetector.detect(file)
   |  Checks: word count, TODO markers, empty sections, sparse links
   |  Filters: isPathExcluded('elaboration', settings), matchesExcludeTag(excludeTags)
   |  Returns: DetectionResult | null
   |
3. Two-phase confirmation (vault scan only):
   |  Phase 1: lightweight detection (no API calls)
   |  Phase 2: NotificationManager.confirm() snackbar
   |  Phase 3: cancellable proposal generation
   |
4. ProposalGenerator.generate(detection)
   |  Gathers context from up to 5 linked notes (500 chars each)
   |  Gathers image context via ImageAnalyzer (if image.enabled)
   |  Gathers external URL context (Twitter/article fetching, up to 3 URLs)
   |  AIClient.complete() with system prompt
   |  stripCodeFences(sanitizeAIResponse()) on output
   |  Returns: Proposal (status: 'pending')
   |
5. ProposalStore.save(proposal)
   |
6. maybeAutoAccept(proposal) if shouldAutoAccept() === true
   |
7. onViewRefreshNeeded() --> main.refreshUnifiedView()
   |
8. User action via UnifiedProposalView:
   Accept --> sanitizeAIResponse(additions), buildCallout(CALLOUT_TYPES.elaboration), append
   Reject --> status = 'rejected'
```

## Detection Rules

| Rule | Setting | Logic |
|------|---------|-------|
| Short note | `elaboration.detection.minWordThreshold` | `wordCount(body) < threshold` |
| TODO markers | `elaboration.detection.detectTodoMarkers` | Regex: `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` |
| Empty sections | `elaboration.detection.detectEmptySections` | Heading with no content before next same-or-higher heading |
| Sparse links | `elaboration.detection.detectSparseLinks` | Inbound links AND word count below threshold |

## Accept Behavior

On accept, additions are sanitized via `stripCodeFences(sanitizeAIResponse())`, then wrapped in a `synapse-elaboration` callout via `buildCallout(CALLOUT_TYPES.elaboration, 'Elaboration', additions)` and appended to the note.

## Image Analysis

`ImageAnalyzer` (`image-analyzer.ts`) uses multi-modal `AIClient.chat()` with `ContentBlock[]` to analyze images embedded in notes during proposal generation. Internal; not exported from `index.ts`.

```ts
class ImageAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  findImageReferences(content: string): Array<{ reference: string; path: string; isInternal: boolean }>
  analyzeImagesInNote(notePath: string, content: string): Promise<ImageAnalysis[]>
  parseAnalysisResponse(reference: string, response: string): ImageAnalysis
}

interface ImageAnalysis {
  reference: string       // Original embed reference
  description: string     // AI-generated image description
  locationHints: string   // Location clues from visual content
  metadata: string        // Observable metadata clues
}

const MAX_IMAGES_PER_NOTE = 5
```

- Finds both wiki-link (`![[image.png]]`) and markdown (`![alt](path)`) image references
- Skips external URLs (vault images only)
- Caps at 5 images per note (`MAX_IMAGES_PER_NOTE`)
- Applies `settings.image.visionModel` override (same pattern as `ImageExtractor`)
- Graceful degradation: logs warning, skips individual image failures
- Imports `AIClient`, `arrayBufferToBase64` from the `shared` barrel; reuses `image/preprocessImage` (via the `image` barrel) for downscaling — no duplicate encoding logic
- Uses `settings.image.maxImageSizeMb` (default 5) as the downscale threshold

## Settings Keys

All under `settings.elaboration`:

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | false | Module activation |
| `scanOnStartup` | boolean | false | Trigger vault scan 5 s after load |
| `autoScanInterval` | number | 0 | Periodic scan interval (minutes; 0 = off) |
| `detection.minWordThreshold` | number | 50 | Notes below this word count are stubs |
| `detection.detectTodoMarkers` | boolean | true | Flag TODO/TBD/FIXME/PLACEHOLDER markers |
| `detection.detectEmptySections` | boolean | true | Flag headings with no body content |
| `detection.detectSparseLinks` | boolean | true | Flag notes with inbound links but sparse content |
| `detection.excludeTags` | string[] | `['no-elaborate']` | Per-note opt-out via frontmatter tags |
| `proposal.includeSourceContext` | boolean | true | Gather up to 5 linked notes as context |

Path-based exclusions use centralized `settings.exclusions: ExclusionRule[]` (#307) via `isPathExcluded('elaboration', settings)` from the `shared` barrel. There is no per-module `excludeFolders` field.

Auto-accept is controlled by `settings.autoAccept.elaboration: boolean` (default `false`), wired into the module at construction via `shouldAutoAccept: () => boolean`.

## Commands Registered

All registered via `CommandRegistrar` in `onload()`:

| Command suffix | Name | Condition |
|---------------|------|-----------|
| `scan-vault` | Scan folder for stub notes | `elaboration.enabled` |
| `scan-current-note` | Elaborate current note | `elaboration.enabled` |
| `clear-proposals` | Clear all pending proposals | `elaboration.enabled` |

## Dependencies

| Import | From |
|--------|------|
| `buildCallout`, `CALLOUT_TYPES`, `NotificationManager`, `sanitizeAIResponse`, `stripCodeFences`, `CheckpointManager`, `generateId`, `fireAndForget`, `FolderPickerModal`, `getMarkdownFiles`, `isPathExcluded`, `matchesExcludeTag`, `getIncludedMarkdownFiles`, `wordCount`, `AIClient`, `arrayBufferToBase64`, `isTwitterUrl`, `fetchTweetContent`, `fetchArticleContent` | `../shared` |
| `CommandRegistrar`, `isInFlow` | `../commands` |
| `preprocessImage` | `../image` (barrel) |

## Invariants / Gotchas

- `scanVault` creates a checkpoint before the generation phase; cancellation or error auto-rejects all proposals created in that run and discards the checkpoint.
- `acceptProposal` guards against double-acceptance: no-ops if `proposal.status !== 'pending'`.
- `scanNote` with `userInvoked=true` bypasses the stub gate — always generates a proposal even if detection finds no reasons.
- `ProposalGenerator` imports `preprocessImage` from the `image` barrel (`../image`), not directly from `image/preprocess.ts` — respects the "import from module index" architecture rule.
- `detector.ts` uses `getIncludedMarkdownFiles` (which already respects path exclusions) for inbound link resolution.
- `onOpenProposalView` callback (#340) was added after the original AGENTS.md; it is a third wired callback alongside `onProposalAccepted` and `onViewRefreshNeeded`.
