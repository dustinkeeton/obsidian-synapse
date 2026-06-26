---
last-updated: 2026-06-25
---

# Elaboration Module

Detects stub/placeholder notes, treats the note title as a topic signal, and generates AI-powered elaboration proposals for non-destructive review; includes image analysis and external-link context to enrich proposals.

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
  getPendingProposals(): Promise<Proposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>
  scanNote(file: TFile, userInvoked?: boolean): Promise<void>
  acceptProposal(id: string, editedContent?: string, options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
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

// settings-section.ts (also re-exported from index.ts)
function renderElaborationSettings(ctx: SettingsSectionContext): void
```

`DetectionReason`, `DetectionResult`, `Proposal` are re-exported from `index.ts` via `export type` (index.ts:L15). `ImageAnalysis` and `ImageAnalyzer` stay internal to `image-analyzer.ts` (not re-exported from `index.ts`). Proposals only ever set `insertionPoint: 'append'`; the other variants and `insertionTarget` exist on the type but are unused.

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `DetectionReason`, `DetectionResult`, `Proposal` | Type definitions |
| `index.ts` | `ElaborationModule`, type re-exports, `renderElaborationSettings` | Orchestrator: commands, scan flows, accept/reject, checkpoints, auto-accept |
| `detector.ts` | `PlaceholderDetector` | Local stub detection; path + tag exclusions |
| `proposer.ts` | `ProposalGenerator` | AI proposal generation; title/link/image/external context + anti-fabrication guards |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON in `elaboration.proposalFolderPath` (default `.synapse/proposals`) |
| `image-analyzer.ts` | `ImageAnalyzer`, `ImageAnalysis`, `MAX_IMAGES_PER_NOTE` | Multi-modal image analysis for proposal context |
| `settings-section.ts` | `renderElaborationSettings` | Settings accordion renderer |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Legacy sidebar view (not registered by `main.ts`) |
| `proposal-modal.ts` | `ProposalDetailModal` | Legacy proposal-edit modal |
| `auto-accept.test.ts` | Tests | Auto-accept behavior |
| `scan-note.test.ts` | Tests | `scanNote` integration |
| `startup-flow.test.ts` | Tests | Startup scan + interval timer |
| `proposer.test.ts` | Tests | `ProposalGenerator` (incl. title-guard) |
| `image-analyzer.test.ts` | Tests | `ImageAnalyzer` |
| `proposal-store.test.ts` | Tests | `ProposalStore` |
| `settings-section.test.ts` | Tests | Settings rendering |

## Data Flow

```
1. scanVault(folderPath?, skipConfirmation?, onlyFile?) / scanNote(file, userInvoked=true)
   |
2. PlaceholderDetector.detect(file)  (detector.ts:L12)
   |  Checks: TODO markers, empty sections, word count, sparse links
   |  Excludes: isPathExcluded(path,'elaboration',settings), matchesExcludeTag(...)
   |  Returns: DetectionResult | null
   |  scanNote(userInvoked) with no reasons -> synthetic { type:'user-requested' }
   |
3. Vault scan only -- two-phase confirm + checkpoint:
   |  Phase 1: lightweight detection (no API)
   |  Phase 2: notifications.confirm() snackbar (skipped when skipConfirmation)
   |  Phase 3: checkpointed, cancellable generation
   |
4. ProposalGenerator.generate(detection)  (proposer.ts:L27)
   |  Guard A: empty body + isGenericTitle(basename) -> notify + return null (proposer.ts:L45)
   |  Context: up to 5 linked notes (500 chars each) if proposal.includeSourceContext
   |  Context: ImageAnalyzer if settings.image.enabled
   |  Context: external URLs (<=3) -- tweet(500) / Reddit(2000) / article(2000); video hosts skipped
   |  Guard B: attempted>0 && externalContext='' && isLinkDominated -> return null (proposer.ts:L76)
   |  buildPrompt() always prepends `Note title: "<basename>"` (proposer.ts:L132)
   |  AIClient.complete(prompt, systemPrompt)
   |  proposedAdditions = stripCodeFences(sanitizeAIResponse(raw))
   |  Returns: Proposal (status:'pending', insertionPoint:'append') | null
   |
5. ProposalStore.save(proposal) -> JSON file in proposalFolderPath
   |
6. maybeAutoAccept(proposal) when shouldAutoAccept() === true
   |
7. onViewRefreshNeeded() -> main refreshes unified view
   |
8. User action (unified view / legacy modal):
   Accept -> stripCodeFences(sanitizeAIResponse(additions)),
             buildCallout(CALLOUT_TYPES.elaboration,'Elaboration',...),
             vault.process(file, d => d.trimEnd()+'\n'+callout)  (index.ts:L410)
   Reject -> status = 'rejected'
```

## Detection Rules

| Rule | Setting | Logic | Ref |
|------|---------|-------|-----|
| TODO markers | `detection.detectTodoMarkers` | Regex `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` (last case-insensitive) | detector.ts:L66 |
| Empty sections | `detection.detectEmptySections` | Heading with no body before next same/higher heading | detector.ts:L78 |
| Short note | `detection.minWordThreshold` | `wordCount(body) < threshold` | detector.ts:L36 |
| Sparse links | `detection.detectSparseLinks` | Inbound links exist AND `wordCount < threshold` | detector.ts:L41 |

Body is analyzed with frontmatter stripped (detector.ts:L61). Inbound links resolved via `getIncludedMarkdownFiles(app,'elaboration',settings)`, which already honors path exclusions (detector.ts:L104).

## Title Signal and Anti-Fabrication Guards (#380, #387)

The note title is surfaced as context in every prompt (`Note title: "<basename>"`, proposer.ts:L132); an empty body seeds the proposal from the title alone rather than an empty block (proposer.ts:L135).

Guard A (empty-body + generic title), proposer.ts:L45:

```ts
if (content.trim() === '' && isGenericTitle(noteFile.basename)) {
  this.notifications.info(/* "<title>" has no content ... not specific enough ... */);
  return null;
}
```

`isGenericTitle` is imported from the `../shared` barrel (shared/index.ts:L116), which re-exports it from `shared/title-detector.ts:L69` -- not a local copy, and not from the `title/` feature module (dependency rules forbid feature-to-feature imports; `title/` re-exports `isUntitled` from the same shared source). `isGenericTitle(t) === isUntitled(t) || isDateStyleTitle(t) || isBareUrlTitle(t)` (title-detector.ts:L69-71). It returns true for Obsidian "Untitled" defaults, date-style daily-note names (e.g. `2026-06-25`, `YYYYMMDD`, `DD-MM-YYYY`), and bare URLs. A real title like "Photosynthesis" is not generic, so the title-led prompt still runs.

Guard B (link-dominated note, all fetches failed), proposer.ts:L76: when the note is essentially just link(s) and every external fetch returned nothing, `generate()` returns null rather than fabricating from a URL slug. `isLinkDominated` strips URLs/markdown/wikilinks to visible text and checks `length < 10` (proposer.ts:L223). Both guards return `null`; callers skip the file without creating a proposal.

## Accept Behavior

On accept (index.ts:L389): no-op if `proposal.status !== 'pending'` (double-accept guard); additions sanitized via `stripCodeFences(sanitizeAIResponse(...))`, wrapped in a `synapse-elaboration` callout via `buildCallout(CALLOUT_TYPES.elaboration, 'Elaboration', ...)`, and appended with `vault.process(file, d => d.trimEnd() + '\n' + callout)`. Then `store.updateStatus(id,'accepted')` and `onProposalAccepted?.(sourceNotePath)`. `options.silent` suppresses the per-proposal Notice + refresh (used by batch auto-accept).

## Image Analysis

`ImageAnalyzer` (image-analyzer.ts) uses multi-modal `AIClient.chat()` with `ContentBlock[]`; internal, not exported from `index.ts`.

```ts
class ImageAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings)
  findImageReferences(content: string): Array<{ reference: string; path: string; isInternal: boolean }>
  analyzeImagesInNote(notePath: string, content: string): Promise<ImageAnalysis[]>
  parseAnalysisResponse(reference: string, response: string): ImageAnalysis
}

interface ImageAnalysis {
  reference: string     // original embed reference
  description: string   // AI-generated description
  locationHints: string // location clues from visual content
  metadata: string      // observable metadata clues
}

const MAX_IMAGES_PER_NOTE = 5
```

- Finds wiki-link (`![[image.png]]`) and markdown (`![alt](path)`) refs; skips external `http(s)` markdown URLs (vault images only).
- Caps at `MAX_IMAGES_PER_NOTE` (5).
- Resolves via `metadataCache.getFirstLinkpathDest`; reads binary; downscales over `settings.image.maxImageSizeMb` (default 5) MB via `preprocessImage` from the `../image` barrel (Notice on downscale).
- Applies `settings.image.visionModel` override (falls back to `settings.ai.model`), restored in `finally`.
- Graceful degradation: warns and skips individual image failures; `gatherImageContext` swallows analyzer errors (proposer.ts:L259).

## Configuration

All under `settings.elaboration` unless noted.

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `enabled` | boolean | true | Module activation / command gating |
| `proposalFolderPath` | string | `.synapse/proposals` | Proposal JSON storage (ProposalStore) |
| `scanOnStartup` | boolean | false | Vault scan 5 s after load (if in startup flow) |
| `autoScanInterval` | number | 0 | Periodic scan interval (minutes; 0 = off) |
| `detection.minWordThreshold` | number | 50 | Notes below this word count are stubs |
| `detection.detectTodoMarkers` | boolean | true | Flag TODO/TBD/FIXME/PLACEHOLDER |
| `detection.detectEmptySections` | boolean | true | Flag headings with no body |
| `detection.detectSparseLinks` | boolean | true | Flag inbound-linked but sparse notes |
| `detection.excludeTags` | string[] | `['no-elaborate']` | Per-note opt-out via frontmatter tags |
| `proposal.includeSourceContext` | boolean | true | Gather up to 5 linked notes as context |
| `proposal.maxProposalsPerNote` | number | 3 | Defined in settings; not referenced by module code |
| `proposal.preserveFrontmatter` | boolean | true | Defined in settings; not referenced by module code |

Path exclusions use centralized `settings.exclusions: ExclusionRule[]` via `isPathExcluded(path,'elaboration',settings)`; there is no per-module `excludeFolders`. Auto-accept is `settings.autoAccept.elaboration` (default false), passed in via `shouldAutoAccept: () => boolean`; module code never mutates settings. Image analysis reads `settings.image.enabled`, `settings.image.visionModel`, `settings.image.maxImageSizeMb`, `settings.ai.model`.

## Commands Registered

Via `CommandRegistrar.register(...)` in `onload()`; all gated on `elaboration.enabled` at registration time.

| Command suffix | Name | Callback type | Action |
|---------------|------|---------------|--------|
| `scan-vault` | Scan folder for stub notes | `callback` | `FolderPickerModal` -> `scanVault(folder?)` |
| `scan-current-note` | Elaborate current note | `editorCallback` | `scanNote(ctx.file)` |
| `clear-proposals` | Clear all pending proposals | `callback` | delete all pending proposals |

## Dependencies

| Symbols | From | Used in |
|---------|------|---------|
| `buildCallout`, `CALLOUT_TYPES`, `FolderPickerModal`, `getMarkdownFiles`, `NotificationManager`, `sanitizeAIResponse`, `stripCodeFences`, `CheckpointManager`, `generateId`, `fireAndForget` (+ types `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`) | `../shared` | index.ts |
| `wordCount`, `isPathExcluded`, `matchesExcludeTag`, `getIncludedMarkdownFiles` | `../shared` | detector.ts |
| `AIClient`, `sanitizeAIResponse`, `stripCodeFences`, `isTwitterUrl`, `fetchTweetContent`, `isRedditUrl`, `fetchRedditContent`, `fetchArticleContent`, `linkLoadError`, `NotificationManager`, `isGenericTitle` | `../shared` | proposer.ts |
| `AIClient`, `arrayBufferToBase64` (+ type `ContentBlock`) | `../shared` | image-analyzer.ts |
| `ensureFolder`, `isRecord`, `readJsonFile` | `../shared` | proposal-store.ts |
| `fireAndForget` | `../shared` | proposal-view.ts |
| type `SettingsSectionContext` | `../shared` | settings-section.ts |
| `preprocessImage` | `../image` (barrel) | image-analyzer.ts |
| `CommandRegistrar`, `isInFlow` | `../commands` | index.ts |

No feature-to-feature imports (architecture rule); `proposer.ts` keeps a tiny local `VIDEO_HOST_PATTERN` instead of importing `video/url-detector` (proposer.ts:L302).

## Invariants / Gotchas

- `scanVault` and `resumeFromCheckpoint` create/advance a checkpoint; cancellation or error auto-rejects all proposals created in the run (`rejectProposalBatch`) and discards the checkpoint.
- `generate()` returning `null` (either anti-fabrication guard) is not an error: callers complete the checkpoint item and skip without saving a proposal (index.ts:L150, index.ts:L277, index.ts:L355).
- `acceptProposal` no-ops when `proposal.status !== 'pending'` (cascade-safe double-accept guard).
- `scanNote(userInvoked=true)` bypasses the stub gate: a synthetic `user-requested` reason is created so the proposer always runs, except where the anti-fabrication guards apply.
- `ProposalGenerator` imports `preprocessImage` from the `../image` barrel, never `image/preprocess.ts` directly (import-from-index rule).
- `onOpenProposalView` is the third wired callback (#340) alongside `onProposalAccepted` and `onViewRefreshNeeded`; the operation toast's "Review" action only appears when a proposal stays pending after any auto-accept.
- `ImageAnalyzer.analyzeImage` temporarily reassigns `settings.ai.model` to the vision model and restores it in `finally`; concurrent callers could observe the override.
