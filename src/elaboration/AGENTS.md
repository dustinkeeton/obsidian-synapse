---
last-updated: 2026-10-06
---

# Elaboration Module

Detects stub/placeholder notes, treats the note title as a topic signal, and generates AI-powered full-body rewrite proposals that are stored separately for review; accepting one replaces the note body under its preserved frontmatter. Includes image analysis and external-link context to enrich proposals.

## Public API

Exported from `index.ts`:

```ts
class ElaborationModule {
  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:49; #504 bundle (plugin, getSettings, notifications, checkpointManager, registrar, noteQueue)
  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<Proposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // per-note queue slot around each generateForBatch (#483)
  scanNote(file: TFile, userInvoked?: boolean): Promise<void>   // queue wrapper over private generateForNote (#483)
  acceptProposal(id: string, editedContent?: string, options?: { silent?: boolean }): Promise<void>   // queue wrapper over private applyProposal (#483); rewrites the note body (#552)
  rejectProposal(id: string): Promise<void>
  onProposalAccepted: ((filePath: string, ctx?: SourceContext) => void) | null
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
  id: string                // === contentKey (deterministic, not random)
  contentKey?: string       // hash of generation inputs; dedup key. Optional for legacy files
  sourceNotePath: string
  createdAt: string
  detectionReasons: DetectionReason[]
  originalContent: string   // full file content as read at generation time; stale-body guard input
  proposedAdditions: string // the full rewritten note body (name kept for persisted-file compatibility)
  insertionPoint: 'replace' | 'append' | 'after-heading' | 'replace-section'   // new proposals: 'replace'; the rest are legacy-file values
  insertionTarget?: string
  status: 'pending' | 'accepted' | 'rejected'
  imageAnalysis?: ImageAnalysis[]
}

// index.ts private queue cores (#483): every public entry point above acquires the note's
// NoteOperationQueue slot ONCE and delegates to one of these, which must never re-enter the queue.
private generateForNote(file: TFile, userInvoked: boolean, op: OperationHandle): Promise<void>   // index.ts:407; core of scanNote
private generateForBatch(detection: DetectionResult): Promise<{ proposal: Proposal | null; autoAccepted: boolean; cacheUse: CacheUse }>   // index.ts:165; per-note core for scanVault + resumeFromCheckpoint; cacheUse filled via trackAiCache (#527)
private applyProposal(id: string, editedContent?: string, options?: { silent?: boolean }): Promise<boolean>   // index.ts:498; core of acceptProposal, re-loads the proposal under the slot; true only when the note was rewritten
private maybeAutoAccept(proposal: Proposal, batch?: boolean): Promise<boolean>   // index.ts:550; returns applyProposal's result, so a stale-body skip is not counted as accepted

// proposer.ts (NOT re-exported from index.ts; consumed internally by index.ts)
class ProposalGenerator {
  constructor(app: App, getSettings: () => SynapseSettings, notifications: NotificationManager, contextBudgetChars?: number)   // default DEFAULT_CONTEXT_BUDGET_CHARS (6000); test seam
  generate(detection: DetectionResult, precomputedKey?: string, aiOpts?: AIRequestOptions): Promise<Proposal | null>   // aiOpts reaches the proposal call AND image analysis (#527)
}
const DEFAULT_CONTEXT_BUDGET_CHARS = 6000
function proposalContentKey(
  notePath: string,
  content: string,
  reasons: DetectionReason[],
  settings: SynapseSettings
): string

// settings-section.ts (also re-exported from index.ts)
function renderElaborationSettings(ctx: SettingsSectionContext): void
```

`DetectionReason`, `DetectionResult`, `Proposal` are re-exported from `index.ts` via `export type` (index.ts:18). `ImageAnalysis` and `ImageAnalyzer` stay internal to `image-analyzer.ts` (not re-exported from `index.ts`). New proposals always set `insertionPoint: 'replace'` (proposer.ts:146); `'append' | 'after-heading' | 'replace-section'` and `insertionTarget` stay on the type only so proposal files written before #552 still pass `isProposal` (proposal-store.ts:12), and accepting such a file rewrites the body like any other.

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `DetectionReason`, `DetectionResult`, `Proposal` | Type definitions |
| `index.ts` | `ElaborationModule`, type re-exports, `renderElaborationSettings` | Orchestrator: commands, scan flows, accept (body rewrite + stale-body guard, #552)/reject, checkpoints, auto-accept, per-note queue serialization (private `generateForNote`, `generateForBatch`, `applyProposal`, #483) |
| `detector.ts` | `PlaceholderDetector` | Local stub detection; path + tag exclusions |
| `proposer.ts` | `ProposalGenerator`, `proposalContentKey`, `DEFAULT_CONTEXT_BUDGET_CHARS` | AI full-body rewrite generation (prompt gets the body with frontmatter stripped); deterministic content-key dedup; title/backlink/link/tag/image/external context under a char budget + anti-fabrication guards |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON in `elaboration.proposalFolderPath` (default `.synapse/proposals`); `loadByNote` for dedup lookups |
| `image-analyzer.ts` | `ImageAnalyzer`, `ImageAnalysis`, `MAX_IMAGES_PER_NOTE` | Multi-modal image analysis for proposal context |
| `settings-section.ts` | `renderElaborationSettings` | Settings accordion renderer |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Legacy sidebar view (not registered by `main.ts`); copy says accept replaces the note |
| `proposal-modal.ts` | `ProposalDetailModal` | Legacy proposal-edit modal; copy says accept replaces the note |
| `rewrite-accept.test.ts` | Tests | #552 accept path: body rewrite with/without frontmatter (byte-identical block, no spurious `---`), no callout/marker in output, echoed-frontmatter drop, stale-body guard (confirm / cancel / silent skip / batch count), new key after a rewrite, legacy `insertionPoint: 'append'` files still load |
| `auto-accept.test.ts` | Tests | Auto-accept behavior |
| `scan-note.test.ts` | Tests | `scanNote` integration |
| `startup-flow.test.ts` | Tests | Startup scan + interval timer |
| `proposer.test.ts` | Tests | `ProposalGenerator` (incl. title-guard) + full-body rewrite prompt (#552; frontmatter-stripped body, `insertionPoint: 'replace'`) |
| `image-analyzer.test.ts` | Tests | `ImageAnalyzer` |
| `proposal-store.test.ts` | Tests | `ProposalStore` |
| `settings-section.test.ts` | Tests | Settings rendering |
| `dedup.test.ts` | Tests | Proposal idempotency / content-key dedup (#395) |
| `review-toast.test.ts` | Tests | "Review" toast action gating (#366) |
| `detector.test.ts` | Tests | `PlaceholderDetector.detect`: exclusions (path rules, frontmatter/inline tags), short-note threshold edges, frontmatter stripping |
| `cache-report.test.ts` | Tests | #527 finish wording: single-proposal hit/miss, vault-scan aggregate hit/miss |
| `transcribe-elaborate-race.test.ts` | Tests | Cross-module regression (#483): transcription → elaboration interleaving on one note — elaboration serializes behind the in-flight transcript insert, sees the post-insert content (the body-echoing AI mock keeps the transcript callout through the rewrite), and post-op hooks run against it; includes a CONTROL case wiring the two modules to SEPARATE queues to prove the assertions fail without serialization |

## Data Flow

```
1. scanVault(folderPath?, skipConfirmation?, onlyFile?) / scanNote(file, userInvoked=true)
   |  #483: each note's detect -> generate -> save -> auto-accept cycle runs inside that note's
   |  NoteOperationQueue slot -- scanNote via noteQueue.run(file.path, generateForNote, { onWait })
   |  (index.ts:399, wait surfaced on the toast), the batch loops via
   |  noteQueue.run(notePath, generateForBatch) per item (index.ts:208, index.ts:337, silent)
   |
2. PlaceholderDetector.detect(file)  (detector.ts:12)
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
4. guardProposal(detection)  (index.ts:135) -- idempotency/dedup, before any AI call
   |  key = proposalContentKey(path, cachedRead FULL content, reasons, settings)  (proposer.ts:20)
   |  skip 'duplicate' if a pending/accepted proposal shares key (rejected does NOT block)
   |  skip 'cap' if pending proposals for note >= proposal.maxProposalsPerNote
   |  on skip: completeItem + continue (no generate, no AI call); else hand key to generate
   |
5. ProposalGenerator.generate(detection, key?)  (proposer.ts:71)
   |  content = cachedRead (full file); body = splitRawFrontmatter(content).body (proposer.ts:81)
   |  Guard A: empty body + isGenericTitle(basename) -> notify + return null (proposer.ts:95)
   |  Context (if proposal.includeSourceContext), one char budget (6000), whole entries taken in priority order:
   |    1. backlinks (<=5, 300-char excerpt around the linking line; `sparse-link.linkedFrom` first, then
   |       metadataCache.resolvedLinks sources sorted by path) -- only if proposal.includeBacklinkContext
   |    2. outbound links (<=5, first 500 chars each)
   |    3. note tags (frontmatter + inline, folded) + <=10 tag-sibling titles -- only if includeBacklinkContext
   |  the first entry that does not fit ends gathering; whole block wrapped via wrapUntrusted(_, 'related notes')
   |  Context: ImageAnalyzer if settings.image.enabled; wrapped via wrapUntrusted (proposer.ts:409)
   |  Context: external URLs (<=3) -- tweet(500) / Reddit(2000) / article(2000); video hosts skipped
   |           each fetched body wrapped via wrapUntrusted(text,url) (proposer.ts:251)
   |  Guard B: attempted>0 && externalContext='' && isLinkDominated -> return null (proposer.ts:126)
   |  buildPrompt(basename, BODY, ...) always prepends `Note title: "<basename>"` (proposer.ts:183); the prompt never carries YAML
   |  System prompt REWRITE_SYSTEM_PROMPT (proposer.ts:37) + REWRITE_INSTRUCTIONS (proposer.ts:41): output the COMPLETE rewritten
   |  body, keep every sentence/embed/wikilink/URL, no frontmatter, no code fence
   |  AIClient.complete(prompt, systemPrompt, aiOpts)  (proposer.ts:135; aiOpts = trackAiCache(cacheUse), #527)
   |  proposedAdditions = stripCodeFences(sanitizeAIResponse(raw))  -- the rewritten body
   |  Returns: Proposal (id===contentKey===key, originalContent=full content, status:'pending', insertionPoint:'replace') | null
   |
6. ProposalStore.save(proposal) -> JSON file in proposalFolderPath
   |
7. maybeAutoAccept(proposal) when shouldAutoAccept() === true
   |
8. Finish line (#527): one CacheUse per note (index.ts:168 batch, index.ts:439 single)
   |  scanVault:            withCacheReport(`Generated N proposal(s)`, cacheUses, 'proposal')  (index.ts:378)
   |  resumeFromCheckpoint: withCacheReport(`Resumed -- generated N proposal(s)`, cacheUses, 'proposal')  (index.ts:239)
   |  scanNote:             withCacheReport('Proposal generated', [cacheUse])  (index.ts:453)
   |  cacheUses collects only notes that produced a proposal (index.ts:214, index.ts:343)
   |
9. onViewRefreshNeeded() -> main refreshes unified view
   |
10. User action (unified view / legacy modal):
   Accept -> acceptProposal takes the source note's queue slot (silently, index.ts:487)
             -> applyProposal (index.ts:498): status guard; stale-body guard
             (vault.read(file) !== proposal.originalContent, index.ts:513) -> silent: skip /
             interactive: ConfirmModal (index.ts:516), cancel = skip;
             then vault.process(file, d => splitRawFrontmatter(d).raw + sanitizeRewrittenBody(additions))  (index.ts:526)
   Reject -> status = 'rejected'
```

## Detection Rules

| Rule | Setting | Logic | Ref |
|------|---------|-------|-----|
| TODO markers | `detection.detectTodoMarkers` | Regex `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` (last case-insensitive) | detector.ts:66 |
| Empty sections | `detection.detectEmptySections` | Heading with no body before next same/higher heading | detector.ts:78 |
| Short note | `detection.minWordThreshold` | `wordCount(body) < threshold` | detector.ts:36 |
| Sparse links | `detection.detectSparseLinks` | Inbound links exist AND `wordCount < threshold` | detector.ts:41 |

Body is analyzed with frontmatter stripped (detector.ts:61). Inbound links resolved via `getIncludedMarkdownFiles(app,'elaboration',settings)`, which already honors path exclusions (detector.ts:104).

## Title Signal and Anti-Fabrication Guards (#380, #387)

The note title is surfaced as context in every prompt (`Note title: "<basename>"`, proposer.ts:183); an empty body seeds the proposal from the title alone rather than an empty block (proposer.ts:189). "Body" here is the frontmatter-stripped content (proposer.ts:81), so a frontmatter-only note counts as empty.

Guard A (empty-body + generic title), proposer.ts:95:

```ts
if (body.trim() === '' && isGenericTitle(noteFile.basename)) {
  this.notifications.info(/* "<title>" has no content ... not specific enough ... */);
  return null;
}
```

`isGenericTitle` is imported from the `../shared` barrel (shared/index.ts:152), which re-exports it from `shared/title-detector.ts:69` -- not a local copy, and not from the `title/` feature module (dependency rules forbid feature-to-feature imports; `title/` re-exports `isUntitled` from the same shared source). `isGenericTitle(t) === isUntitled(t) || isDateStyleTitle(t) || isBareUrlTitle(t)` (shared/title-detector.ts:69-71). It returns true for Obsidian "Untitled" defaults, date-style daily-note names (e.g. `2026-06-25`, `YYYYMMDD`, `DD-MM-YYYY`), and bare URLs. A real title like "Photosynthesis" is not generic, so the title-led prompt still runs.

Guard B (link-dominated note, all fetches failed), proposer.ts:126: when the note is essentially just link(s) and every external fetch returned nothing, `generate()` returns null rather than fabricating from a URL slug. `isLinkDominated` delegates to the shared `isEffectivelyEmptyProse` (`shared/prose-reduction.ts`: URLs and `![[embeds]]` removed, links reduced to their label, fewer than `MIN_PROSE_CHARS` = 10 letters/digits left), the same rule summarize uses to drop empty note content (#544). Both guards return `null`; callers skip the file without creating a proposal.

## Idempotency and Dedup (content key)

Idempotency is content-key only: accepting writes no callout, no HTML-comment marker and no frontmatter field, so nothing in the note says "already elaborated". Re-scanning an unchanged note must not spend an AI call or create a duplicate proposal; a rewritten note has a new body, hence a new key, and may be proposed on again. `guardProposal(detection)` (index.ts:135) runs before every generate+save site (scanVault, resumeFromCheckpoint, scanNote):

```ts
guardProposal(detection: DetectionResult): Promise<
  | { skip: false; key?: string }
  | { skip: true; reason: 'duplicate' | 'cap' }
>
```

- key: `proposalContentKey(notePath, cachedRead(full content), reasons, settings)` (proposer.ts:20) -- `contentKey([...])` hash over `normalizePath(notePath)`, `hashString(content)`, the type-sorted detection reasons, and `ai.provider/model/temperature/maxTokens`. Keyed on inputs (not the model output) so temperature>0 sampling stays deterministic across runs.
- `duplicate`: a pending OR accepted proposal already shares the key -> skip. A `rejected` proposal with the same key does NOT block (the user may retry a declined suggestion).
- `cap`: pending proposals for the note already >= `proposal.maxProposalsPerNote` -> skip.
- On skip the caller completes the checkpoint item (or finishes the scanNote op honestly) without saving; on pass the key is forwarded to `generate(detection, key)` so the proposal's `id` and `contentKey` both equal it.

## Accept Behavior

Accept is a rewrite (#552): the note body is replaced by the proposal's body; summaries and every other feature keep their callouts.

`acceptProposal(id, editedContent?, options?)` (index.ts:480) is a thin queue wrapper (#483): it loads the proposal for its `sourceNotePath`, takes that note's `NoteOperationQueue` slot silently (index.ts:487), and runs `applyProposal` (index.ts:498), which RE-loads the proposal so the status guard is evaluated under the slot rather than against a pre-wait snapshot. In `applyProposal`, in order:

1. No-op (`false`) if `proposal.status !== 'pending'` (double-accept guard) or the note is missing.
2. Stale-body guard (index.ts:513): `vault.read(file)` is compared byte-for-byte with `proposal.originalContent` (the full file as `cachedRead` at generation). On mismatch, `options.silent` -> return `false`, proposal stays `pending`, nothing written; otherwise `ConfirmModal` (index.ts:516; title "Note changed since this proposal was generated", confirm label "Replace", dismissal = cancel) and only an explicit confirm continues. The modal is awaited outside `vault.process` while holding the note's queue slot.
3. `vault.process(file, d => raw + body)` (index.ts:526): `raw` is `splitRawFrontmatter(d).raw` (the leading `---` block byte-for-byte, `''` when absent -- never re-serialised, never added); `body` is `sanitizeRewrittenBody(editedContent ?? proposedAdditions)` (index.ts:608) = `stripCodeFences(sanitizeAIResponse(...))`, a model-echoed leading frontmatter block dropped, `trimEnd()` + exactly one `\n`.
4. `store.updateStatus(id,'accepted')`, Notice + refresh unless `options.silent`, then `onProposalAccepted?.(sourceNotePath, { sourceUrls: extractUrls(previousContent), producedRegion: { kind: 'whole-note' } })`; return `true`.

`maybeAutoAccept` (index.ts:550) forwards `applyProposal`'s boolean: batch auto-accept passes `silent: true`, so a stale note is skipped and left pending and the "Auto-accepted N" summary counts only real rewrites; single-note auto-accept passes `silent: false` and therefore gets the modal on a stale note.

## Image Analysis

`ImageAnalyzer` (image-analyzer.ts) uses multi-modal `AIClient.chat()` with `ContentBlock[]`; internal, not exported from `index.ts`.

```ts
class ImageAnalyzer {
  constructor(app: App, getSettings: () => SynapseSettings, notifications: NotificationManager)
  findImageReferences(content: string): Array<{ reference: string; path: string; isInternal: boolean }>
  analyzeImagesInNote(notePath: string, content: string, aiOpts?: AIRequestOptions): Promise<ImageAnalysis[]>
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
- Resolves via `metadataCache.getFirstLinkpathDest`; reads binary; downscales over `settings.image.maxImageSizeMb` (default 5) MB via `preprocessImage` from the `../shared` barrel (image-analyzer.ts:117; downscale surfaced via `notifications.info`, 3s dedup #396).
- Passes the vision model per call: `aiClient.chat(..., { ...aiOpts, model: settings.image.visionModel || settings.ai.model })` (image-analyzer.ts:150); `settings.ai.model` is never mutated.
- Graceful degradation: warns (through `redactError`) and skips individual image failures; `gatherImageContext` swallows analyzer errors, also logging through `redactError` (proposer.ts:411).

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
| `proposal.includeSourceContext` | boolean | true | Gather related-notes context (backlinks, outbound links, tags) under a 6000-char budget |
| `proposal.includeBacklinkContext` | boolean | true | Include backlink excerpts and tag/tag-sibling context (#500); off = outbound links only |
| `proposal.maxProposalsPerNote` | number | 3 | Per-note pending-proposal cap; `guardProposal` skips with reason `cap` once reached (index.ts:157) |
| `proposal.preserveFrontmatter` | boolean | true | Defined in settings; not referenced by module code |

Path exclusions use centralized `settings.exclusions: ExclusionRule[]` via `isPathExcluded(path,'elaboration',settings)`; there is no per-module `excludeFolders`. Auto-accept is `settings.autoAccept.elaboration` (default false), passed in via `shouldAutoAccept: () => boolean`; module code never mutates settings. Image analysis reads `settings.image.enabled`, `settings.image.visionModel`, `settings.image.maxImageSizeMb`, `settings.ai.model`. The dedup content key additionally folds in `settings.ai.provider`, `settings.ai.model`, `settings.ai.temperature`, `settings.ai.maxTokens` (`proposalContentKey`, proposer.ts:20).

## Commands Registered

Via `CommandRegistrar.register(...)` in `onload()`; all gated on `elaboration.enabled` at registration time.

| Command suffix | Name | Callback type | Action |
|---------------|------|---------------|--------|
| `scan-vault` | Scan folder for stub notes | `callback` | `openScanFolderPicker` (index.ts:67) -> `scanVault(path)` |
| `scan-current-note` | Elaborate current note | `editorCallback` | `scanNote(ctx.file)` |
| `clear-proposals` | Clear all pending proposals | `callback` | delete all pending proposals |

## Dependencies

| Symbols | From | Used in |
|---------|------|---------|
| `extractUrls`, `openScanFolderPicker`, `getMarkdownFiles`, `NotificationManager`, `NoteOperationQueue`, `sanitizeAIResponse`, `stripCodeFences`, `CheckpointManager`, `generateId`, `ConfirmModal`, `splitRawFrontmatter`, `fireAndForget`, `reviewAction`, `trackAiCache`, `withCacheReport` (+ types `SourceContext`, `CacheUse`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `OperationHandle`, `ModuleDeps`, `FeatureModule`) | `../shared` | index.ts:2-11 |
| `wordCount`, `isPathExcluded`, `matchesExcludeTag`, `getIncludedMarkdownFiles` | `../shared` | detector.ts |
| `AIClient`, `sanitizeAIResponse`, `stripCodeFences`, `isTwitterUrl`, `fetchTweetContent`, `isRedditUrl`, `fetchRedditContent`, `fetchArticleContent`, `linkLoadError`, `NotificationManager`, `isGenericTitle`, `hashString`, `contentKey`, `wrapUntrusted`, `redactError`, `isPathExcluded`, `findUrls`, `isEffectivelyEmptyProse`, `splitRawFrontmatter` | `../shared` | proposer.ts |
| `AIClient`, `arrayBufferToBase64`, `NotificationManager`, `preprocessImage`, `redactError` (+ types `AIRequestOptions`, `ContentBlock`) | `../shared` | image-analyzer.ts:2-3 |
| `ensureFolder`, `isRecord`, `readJsonFile` | `../shared` | proposal-store.ts |
| `fireAndForget` | `../shared` | proposal-view.ts |
| type `SettingsSectionContext` | `../shared` | settings-section.ts |
| `CommandRegistrar`, `isInFlow` | `../commands` | index.ts |

No feature-to-feature imports (architecture rule); `proposer.ts` keeps a tiny local `VIDEO_HOST_PATTERN` instead of importing `video/url-detector` (proposer.ts:424). `index.ts` no longer imports `buildCallout` / `CALLOUT_TYPES`; `CALLOUT_TYPES.elaboration` and its CSS remain in `shared/callouts.ts` + `styles.css` only to render notes elaborated before #552.

## Invariants / Gotchas

- `scanVault` and `resumeFromCheckpoint` create/advance a checkpoint; cancellation or error auto-rejects all proposals created in the run (`rejectProposalBatch`) and discards the checkpoint.
- `generate()` returning `null` (either anti-fabrication guard) is not an error: callers complete the checkpoint item and skip without saving a proposal (index.ts:173 batch, index.ts:441 single note).
- Proposal `id` is deterministic: `id === contentKey`. Re-scanning an unchanged note recomputes the same key, so `guardProposal` returns `duplicate` and no second AI call fires; a `rejected` proposal with that key does not block a fresh attempt (#395).
- `acceptProposal` no-ops when `proposal.status !== 'pending'` (cascade-safe double-accept guard); the guard lives in the queued `applyProposal` core, which re-loads the proposal so a wait cannot make the decision on stale state (#483).
- Accept overwrites the body, so `applyProposal` never writes when `vault.read(file) !== proposal.originalContent` without an explicit modal confirm; silent/batch accepts skip and leave the proposal `pending` (#552). `originalContent` comes from `cachedRead`, so a lagging metadata cache trips the guard rather than clobbering the note.
- Frontmatter survives accept byte-for-byte via `splitRawFrontmatter`, never `parseFrontmatter` + `serializeFrontmatter` (which re-serialises YAML); a note without frontmatter gets no `---` block. The written file ends in exactly one newline.
- `maybeAutoAccept` must return `applyProposal`'s boolean, never an unconditional `true`: the batch "Auto-accepted N" count derives from it.
- Per-note serialization (#483): public `scanNote` / `scanVault` / `resumeFromCheckpoint` / `acceptProposal` acquire the note's `NoteOperationQueue` slot exactly ONCE; the private cores (`generateForNote`, `generateForBatch`, `applyProposal`) must never re-enter it (self-deadlock). `maybeAutoAccept` is called from inside a core and therefore calls `applyProposal` directly, never `acceptProposal`. Only `scanNote` passes `onWait` (user-invoked); batch and accept paths queue silently.
- `scanNote(userInvoked=true)` bypasses the stub gate: a synthetic `user-requested` reason is created so the proposer always runs, except where the dedup guard (`duplicate`/`cap`) or the anti-fabrication guards apply.
- `ImageAnalyzer` imports `preprocessImage` from the `../shared` barrel (image-analyzer.ts:2); this module has no `../image` import.
- `onOpenProposalView` is the third wired callback (#340) alongside `onProposalAccepted` and `onViewRefreshNeeded`; the operation toast's "Review" action is centralized in `reviewAction(...)` (#366) and only appears when a proposal stays pending after any auto-accept.
- The unified sidebar view (`src/views/unified-proposal-view.ts`) is the registered review surface; only the legacy `proposal-view.ts` / `proposal-modal.ts` copy was changed for #552.
- `ImageAnalyzer.analyzeImage` selects the vision model via `AIRequestOptions.model` on the single `chat()` call (image-analyzer.ts:150); no settings mutation, so concurrent callers cannot observe it.
- `onunload` (index.ts:111-114) clears `scanInterval` and nulls the field, so a later `onload` cannot double-clear a stale handle.
