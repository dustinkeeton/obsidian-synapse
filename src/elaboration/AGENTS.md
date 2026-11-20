---
last-updated: 2026-11-09
---

# Elaboration Module

Detects stub/placeholder notes, treats the note title as a topic signal, and generates AI-powered full-body rewrite proposals that are stored separately for review; accepting one replaces the note body under its preserved frontmatter. Includes image analysis and external-link context to enrich proposals.

## Public API

Exported from `index.ts`:

```ts
class ElaborationModule {
  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:62; #504 bundle (plugin, getSettings, notifications, checkpointManager, registrar, noteQueue)
  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<Proposal[]>
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  scanVault(target?: ScanTarget, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>   // per-note queue slot around each generateForBatch (#483)
  scanNote(file: TFile, userInvoked?: boolean, job?: ElaborationJobOptions): Promise<ElaborationOutcome>   // queue wrapper over private generateForNote (#483); outcome mirrors the toast (#623); job (#626): op id jobOpId(`scan-<path>`, job), job.ai joined into the proposer's calls
  acceptProposal(id: string, editedContent?: string, options?: { silent?: boolean; onStale?: 'confirm' | 'skip' | 'replace' }): Promise<AcceptResult>   // shared/accept-result (#633); queue wrapper over private applyProposal (#483); rewrites the note body (#552); applied with [sourceNotePath] only when rewritten
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
  generation?: AIResponseInfo   // provider, wire model, stopReason, usage, cached of the rewrite call (#625; proposer.ts captures it via onResponse and forwards to the caller's own onResponse); absent on older proposals
}

// index.ts private queue cores (#483): every public entry point above acquires the note's
// NoteOperationQueue slot ONCE and delegates to one of these, which must never re-enter the queue.
interface ElaborationJobOptions { jobId?: string; ai?: AIRequestOptions }   // #626; a public-API job running scanNote (call cap, usage meter, external generator); never persisted
private generateForNote(file: TFile, userInvoked: boolean, op: OperationHandle, ai?: AIRequestOptions): Promise<ElaborationOutcome>   // index.ts:427; core of scanNote; proposer.generate(result, key, combineAIOptions(trackAiCache(cacheUse), ai))
// types.ts: ElaborationOutcome = shared OperationOutcome { status: completed | failed | cancelled; message; proposalIds (the generated proposal); writtenPaths (the note when auto-accept rewrote it); cacheUse } (barrel-exported, #624)
private generateForBatch(detection: DetectionResult): Promise<{ proposal: Proposal | null; autoAccepted: boolean; cacheUse: CacheUse }>   // index.ts:179; per-note core for scanVault + resumeFromCheckpoint; cacheUse filled via trackAiCache (#527)
private applyProposal(id: string, editedContent?: string, options?: AcceptOptions): Promise<AcceptResult>   // core of acceptProposal, re-loads the proposal under the slot
private maybeAutoAccept(proposal: Proposal, batch?: boolean): Promise<boolean>   // true only when applyProposal's result wrote (`acceptWrote`), so a stale-body skip is not counted as accepted

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

`DetectionReason`, `DetectionResult`, `Proposal` are re-exported from `index.ts` via `export type` (index.ts:20). `ImageAnalysis` and `ImageAnalyzer` stay internal to `image-analyzer.ts` (not re-exported from `index.ts`). New proposals always set `insertionPoint: 'replace'` (proposer.ts:151); `'append' | 'after-heading' | 'replace-section'` and `insertionTarget` stay on the type only so proposal files written before #552 still pass `isProposal` (proposal-store.ts:12), and accepting such a file rewrites the body like any other.

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
| `rewrite-accept.test.ts` | Tests | #552 accept path: body rewrite with/without frontmatter (byte-identical block, no spurious `---`), no callout/marker in output, echoed-frontmatter drop, stale-body guard (confirm / cancel / silent skip / onStale skip + replace / batch count), `scanNote` outcome (proposal id; written path under auto-accept), new key after a rewrite, legacy `insertionPoint: 'append'` files still load |
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
1. scanVault(target?, skipConfirmation?, onlyFile?) / scanNote(file, userInvoked=true)
   |  #483: each note's detect -> generate -> save -> auto-accept cycle runs inside that note's
   |  NoteOperationQueue slot -- scanNote via noteQueue.run(file.path, generateForNote, { onWait })
   |  (index.ts:419, wait surfaced on the toast), the batch loops via
   |  noteQueue.run(notePath, generateForBatch) per item (index.ts:223, index.ts:355, silent)
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
4. guardProposal(detection)  (index.ts:149) -- idempotency/dedup, before any AI call
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
   |  Context: ImageAnalyzer if settings.image.enabled; wrapped via wrapUntrusted (proposer.ts:415)
   |  Context: external URLs (<=3) -- tweet(500) / Reddit(2000) / article(2000); video hosts skipped
   |           each fetched body wrapped via wrapUntrusted(text,url) (proposer.ts:257)
   |  Guard B: attempted>0 && externalContext='' && isLinkDominated -> return null (proposer.ts:126)
   |  buildPrompt(basename, BODY, ...) always prepends `Note title: "<basename>"` (proposer.ts:189); the prompt never carries YAML
   |  System prompt REWRITE_SYSTEM_PROMPT (proposer.ts:37) + voiceInstruction(settings.ai) (proposer.ts:131, #540) + REWRITE_INSTRUCTIONS (proposer.ts:41):
   |  output the COMPLETE rewritten body, preserve the original intent, keep every sentence/embed/wikilink/URL, no frontmatter, no code fence
   |  AIClient.complete(prompt, systemPrompt, aiOpts)  (proposer.ts:140; aiOpts = trackAiCache(cacheUse), #527)
   |  proposedAdditions = stripCodeFences(sanitizeAIResponse(raw))  -- the rewritten body
   |  Returns: Proposal (id===contentKey===key, originalContent=full content, status:'pending', insertionPoint:'replace') | null
   |
6. ProposalStore.save(proposal) -> JSON file in proposalFolderPath
   |
7. maybeAutoAccept(proposal) when shouldAutoAccept() === true
   |
8. Finish line (#527): one CacheUse per note (index.ts:182 batch, index.ts:462 single)
   |  scanVault:            withCacheReport(`Generated N proposal(s)`, cacheUses, 'proposal')  (index.ts:396)
   |  resumeFromCheckpoint: withCacheReport(`Resumed -- generated N proposal(s)`, cacheUses, 'proposal')  (index.ts:254)
   |  scanNote:             withCacheReport('Proposal generated', [cacheUse])  (index.ts:472)
   |  cacheUses collects only notes that produced a proposal (index.ts:228, index.ts:360)
   |
9. onViewRefreshNeeded() -> main refreshes unified view
   |
10. User action (unified view / legacy modal):
   Accept -> acceptProposal takes the source note's queue slot (silently, index.ts:512)
             -> applyProposal (index.ts:523): status guard; stale-body guard
             (vault.read(file) !== proposal.originalContent, index.ts:540) -> onStale replace: write / skip (silent default) /
             interactive: ConfirmModal (index.ts:542), cancel = skip;
             then vault.process(file, d => splitRawFrontmatter(d).raw + stripUnresolvedLinks(sanitizeRewrittenBody(additions), ..., { keep }))  (index.ts:557; #581)
   Reject -> status = 'rejected'
```

## Detection Rules

| Rule | Setting | Logic | Ref |
|------|---------|-------|-----|
| TODO markers | `detection.detectTodoMarkers` | Regex `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` (last case-insensitive) | detector.ts:66 |
| Empty sections | `detection.detectEmptySections` | Heading with no body before next same/higher heading | detector.ts:78 |
| Short note | `detection.minWordThreshold` | `wordCount(body) < threshold` | detector.ts:36 |
| Sparse links | `detection.detectSparseLinks` | Inbound links exist AND `wordCount < threshold` | detector.ts:41 |

Body is analyzed with frontmatter stripped (`stripFrontmatter`, detector.ts:61-64). Inbound links resolved via `getIncludedMarkdownFiles(app,'elaboration',settings)`, which already honors path exclusions (detector.ts:104).

## Title Signal and Anti-Fabrication Guards (#380, #387)

The note title is surfaced as context in every prompt (`Note title: "<basename>"`, proposer.ts:189); an empty body seeds the proposal from the title alone rather than an empty block (proposer.ts:195). "Body" here is the frontmatter-stripped content (proposer.ts:81), so a frontmatter-only note counts as empty.

Guard A (empty-body + generic title), proposer.ts:95-100:

```ts
if (body.trim() === '' && isGenericTitle(noteFile.basename)) {
  this.notifications.info(/* "<title>" has no content ... not specific enough ... */);
  return null;
}
```

`isGenericTitle` is imported from the `../shared` barrel (shared/index.ts:202), which re-exports it from `shared/title-detector.ts:69` -- not a local copy, and not from the `title/` feature module (dependency rules forbid feature-to-feature imports; `title/` re-exports `isUntitled` from the same shared source). `isGenericTitle(t) === isUntitled(t) || isDateStyleTitle(t) || isBareUrlTitle(t)` (shared/title-detector.ts:69-71). It returns true for Obsidian "Untitled" defaults, date-style daily-note names (e.g. `2026-06-25`, `YYYYMMDD`, `DD-MM-YYYY`), and bare URLs. A real title like "Photosynthesis" is not generic, so the title-led prompt still runs.

Guard B (link-dominated note, all fetches failed), proposer.ts:126: when the note is essentially just link(s) and every external fetch returned nothing, `generate()` returns null rather than fabricating from a URL slug. `isLinkDominated` delegates to the shared `isEffectivelyEmptyProse` (`shared/prose-reduction.ts`: URLs and `![[embeds]]` removed, links reduced to their label, fewer than `MIN_PROSE_CHARS` = 10 letters/digits left), the same rule summarize uses to drop empty note content (#544). Both guards return `null`; callers skip the file without creating a proposal.

## Idempotency and Dedup (content key)

Idempotency is content-key only: accepting writes no callout, no HTML-comment marker and no frontmatter field, so nothing in the note says "already elaborated". Re-scanning an unchanged note must not spend an AI call or create a duplicate proposal; a rewritten note has a new body, hence a new key, and may be proposed on again. `guardProposal(detection)` (index.ts:149) runs before every generate+save site (scanVault, resumeFromCheckpoint, scanNote):

```ts
guardProposal(detection: DetectionResult): Promise<
  | { skip: false; key?: string }
  | { skip: true; reason: 'duplicate' | 'cap' }
>
```

- key: `proposalContentKey(notePath, cachedRead(full content), reasons, settings)` (proposer.ts:20) -- `contentKey([...])` hash over `normalizePath(notePath)`, `hashString(content)`, the type-sorted detection reasons, and the resolved elaboration provider/model (not effort). Keyed on inputs (not the model output) so model sampling stays deterministic across runs.
- `duplicate`: a pending OR accepted proposal already shares the key -> skip. A `rejected` proposal with the same key does NOT block (the user may retry a declined suggestion).
- `cap`: pending proposals for the note already >= `proposal.maxProposalsPerNote` -> skip.
- On skip the caller completes the checkpoint item (or finishes the scanNote op honestly) without saving; on pass the key is forwarded to `generate(detection, key)` so the proposal's `id` and `contentKey` both equal it.

## Accept Behavior

Accept is a rewrite (#552): the note body is replaced by the proposal's body; summaries and every other feature keep their callouts.

`acceptProposal(id, editedContent?, options?)` (index.ts:505) is a thin queue wrapper (#483): it loads the proposal for its `sourceNotePath`, takes that note's `NoteOperationQueue` slot silently (index.ts:512), and runs `applyProposal` (index.ts:523), which RE-loads the proposal so the status guard is evaluated under the slot rather than against a pre-wait snapshot. In `applyProposal`, in order:

1. `skipped` if the proposal is missing or `proposal.status !== 'pending'` (double-accept guard); `failed` ("Source note no longer exists") if the note is missing.
2. Stale-body guard (index.ts:540): `vault.read(file)` is compared byte-for-byte with `proposal.originalContent` (the full file as `cachedRead` at generation). On mismatch the action is `options.onStale ?? (options.silent ? 'skip' : 'confirm')` (index.ts:539, #623): `replace` writes without asking (`api.proposals.accept(..., { force: true })`), `skip` -> `conflict` ("The note changed since the proposal was generated"), proposal stays `pending`, nothing written; `confirm` -> `ConfirmModal` (index.ts:542; title "Note changed since this proposal was generated", confirm label "Replace", dismissal = cancel) and only an explicit confirm continues (dismissal -> `skipped`). The modal is awaited outside `vault.process` while holding the note's queue slot.
3. `vault.process(file, d => raw + body)` (index.ts:557): `raw` is `splitRawFrontmatter(d).raw` (the leading `---` block byte-for-byte, `''` when absent -- never re-serialised, never added); `body` is `sanitizeRewrittenBody(editedContent ?? proposedAdditions)` (index.ts:640) = `stripCodeFences(sanitizeAIResponse(...))`, a model-echoed leading frontmatter block dropped, `trimEnd()` + exactly one `\n`; then `stripUnresolvedLinks(body, metadataCache, file.path, { keep })` with `keep` = `wikilinkTargets(d)` (links already in the note) + links in `editedContent` that are not in `proposedAdditions` (user-typed, index.ts:552-555) (#581).
4. `store.updateStatus(id,'accepted')`, Notice + refresh unless `options.silent`, then `onProposalAccepted?.(sourceNotePath, { sourceUrls: extractUrls(previousContent), producedRegion: { kind: 'whole-note' } })`; return `applied` with `[sourceNotePath]`.

`maybeAutoAccept` returns `acceptWrote(applyProposal(...))`: batch auto-accept passes `silent: true`, so a stale note is skipped and left pending and the "Auto-accepted N" summary counts only real rewrites; single-note auto-accept passes `silent: false` and therefore gets the modal on a stale note.

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
- Resolves via `metadataCache.getFirstLinkpathDest`; reads binary; downscales over `settings.image.maxImageSizeMb` (default 5) MB via `preprocessImage` from the `../shared` barrel (image-analyzer.ts:118; downscale surfaced via `notifications.info`, 3s dedup #396).
- Passes the vision model per call: `aiClient.chat(..., { ...aiOpts, model: visionModelOverride(settings) })` (image-analyzer.ts:151); `settings.ai.model` is never mutated.
- Graceful degradation: warns (through `redactError`) and skips individual image failures; `gatherImageContext` swallows analyzer errors, also logging through `redactError` (proposer.ts:417).

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
| `proposal.maxProposalsPerNote` | number | 3 | Per-note pending-proposal cap; `guardProposal` skips with reason `cap` once reached (index.ts:170) |
| `proposal.preserveFrontmatter` | boolean | true | Defined in settings; not referenced by module code |
| `agentBilling` | `'plugin-key' \| 'external'` | `'plugin-key'` | Default billing of agent-run elaboration (#626; toggle "Agents generate the text", settings-section.ts:70); read only by `api/` (`defaultBilling`), overridden per call; commands always use the key |

Path exclusions use centralized `settings.exclusions: ExclusionRule[]` via `isPathExcluded(path,'elaboration',settings)`; there is no per-module `excludeFolders`. Auto-accept is `settings.autoAccept.elaboration` (default false), passed in via `shouldAutoAccept: () => boolean`; module code never mutates settings. Image analysis reads `settings.image.enabled`, `settings.image.visionModel`, `settings.image.maxImageSizeMb`, and resolves its model through the `image` feature client. The rewrite system prompt reads `settings.ai.voice`/`settings.ai.voiceCustom` per call via `voiceInstruction` (#540); voice is NOT part of the dedup key. The dedup content key additionally folds in the resolved elaboration provider + model + effort (`resolveAIConfig(settings, 'elaboration')`) (`proposalContentKey`, proposer.ts:20).

## Commands Registered

Via `CommandRegistrar.register(...)` in `onload()`; all gated on `elaboration.enabled` at registration time.

| Command suffix | Name | Callback type | Action |
|---------------|------|---------------|--------|
| `scan-vault` | Scan folder for stub notes | `callback` | `openScanFolderPicker` (index.ts:80) -> `scanVault(scope)` |
| `scan-current-note` | Elaborate current note | `editorCallback` | `scanNote(ctx.file)` |
| `clear-proposals` | Clear all pending proposals | `callback` | delete all pending proposals |

## In-Progress Rows (#577)

`startOperation(label, id, { kind: 'elaboration', target? })` registers a cancellable unified-sidebar row (`NotificationManager.inProgress`). Target = `folderLabel ?? 'Whole vault'` for scans, note path for single notes.

| Op id | Site | Target |
|-------|------|--------|
| `vault-generate-resume` | `index.ts:198` | none |
| `vault-scan` | `index.ts:280` | folder label |
| `vault-generate` | `index.ts:320` | folder label |
| `scan-<path>` | `index.ts:415` | note path |

## Dependencies

| Symbols | From | Used in |
|---------|------|---------|
| `extractUrls`, `openScanFolderPicker`, `getMarkdownFiles`, `NotificationManager`, `NoteOperationQueue`, `sanitizeAIResponse`, `stripCodeFences`, `CheckpointManager`, `generateId`, `ConfirmModal`, `splitRawFrontmatter`, `fireAndForget`, `reviewAction`, `trackAiCache`, `withCacheReport`, `stripUnresolvedLinks`, `wikilinkTargets`, `scanScopeLabel` (+ types `ScanTarget`, `SourceContext`, `CacheUse`, `Checkpoint`, `CheckpointWorkItem`, `DeferredTask`, `OperationHandle`, `ModuleDeps`, `FeatureModule`) | `../shared` | index.ts:2-13 |
| `wordCount`, `isPathExcluded`, `matchesExcludeTag`, `getIncludedMarkdownFiles` | `../shared` | detector.ts |
| `AIClient`, `sanitizeAIResponse`, `stripCodeFences`, `isTwitterUrl`, `fetchTweetContent`, `isRedditUrl`, `fetchRedditContent`, `fetchArticleContent`, `linkLoadError`, `NotificationManager`, `isGenericTitle`, `hashString`, `contentKey`, `wrapUntrusted`, `redactError`, `isPathExcluded`, `findUrls`, `isEffectivelyEmptyProse`, `splitRawFrontmatter` | `../shared` | proposer.ts |
| `AIClient`, `arrayBufferToBase64`, `NotificationManager`, `preprocessImage`, `redactError` (+ types `AIRequestOptions`, `ContentBlock`) | `../shared` | image-analyzer.ts:2-3 |
| `ensureFolder`, `isRecord`, `readJsonFile` | `../shared` | proposal-store.ts |
| type `SettingsSectionContext` | `../shared` | settings-section.ts |
| `CommandRegistrar`, `isInFlow` | `../commands` | index.ts |

No feature-to-feature imports (architecture rule); `proposer.ts` keeps a tiny local `VIDEO_HOST_PATTERN` instead of importing `video/url-detector` (proposer.ts:431). `index.ts` no longer imports `buildCallout` / `CALLOUT_TYPES`; `CALLOUT_TYPES.elaboration` and its CSS remain in `shared/callouts.ts` + `styles.css` only to render notes elaborated before #552.

## Invariants / Gotchas

- Accept unlinks model-written `[[links]]` to missing notes via `stripUnresolvedLinks`, keeping links already in the note and links the user typed into the review edit (#581).
- `scanVault` and `resumeFromCheckpoint` create/advance a checkpoint; cancellation or error auto-rejects all proposals created in the run (`rejectProposalBatch`) and discards the checkpoint.
- `generate()` returning `null` (either anti-fabrication guard) is not an error: callers complete the checkpoint item and skip without saving a proposal (index.ts:186 batch, index.ts:462 single note).
- Proposal `id` is deterministic: `id === contentKey`. Re-scanning an unchanged note recomputes the same key, so `guardProposal` returns `duplicate` and no second AI call fires; a `rejected` proposal with that key does not block a fresh attempt (#395).
- `acceptProposal` no-ops when `proposal.status !== 'pending'` (cascade-safe double-accept guard); the guard lives in the queued `applyProposal` core, which re-loads the proposal so a wait cannot make the decision on stale state (#483).
- Accept overwrites the body, so `applyProposal` never writes when `vault.read(file) !== proposal.originalContent` without an explicit modal confirm; silent/batch accepts skip and leave the proposal `pending` (#552). `originalContent` comes from `cachedRead`, so a lagging metadata cache trips the guard rather than clobbering the note.
- Frontmatter survives accept byte-for-byte via `splitRawFrontmatter`, never `parseFrontmatter` + `serializeFrontmatter` (which re-serialises YAML); a note without frontmatter gets no `---` block. The written file ends in exactly one newline.
- `maybeAutoAccept` must return whether `applyProposal` wrote, never an unconditional `true`: the batch "Auto-accepted N" count derives from it.
- Per-note serialization (#483): public `scanNote` / `scanVault` / `resumeFromCheckpoint` / `acceptProposal` acquire the note's `NoteOperationQueue` slot exactly ONCE; the private cores (`generateForNote`, `generateForBatch`, `applyProposal`) must never re-enter it (self-deadlock). `maybeAutoAccept` is called from inside a core and therefore calls `applyProposal` directly, never `acceptProposal`. Only `scanNote` passes `onWait` (user-invoked); batch and accept paths queue silently.
- `scanNote(userInvoked=true)` bypasses the stub gate: a synthetic `user-requested` reason is created so the proposer always runs, except where the dedup guard (`duplicate`/`cap`) or the anti-fabrication guards apply.
- `ImageAnalyzer` imports `preprocessImage` from the `../shared` barrel (image-analyzer.ts:2); this module has no `../image` import.
- `onOpenProposalView` is the third wired callback (#340) alongside `onProposalAccepted` and `onViewRefreshNeeded`; the operation toast's "Review" action is centralized in `reviewAction(...)` (#366) and only appears when a proposal stays pending after any auto-accept.
- The unified sidebar view (`src/views/unified-proposal-view.ts`) is the only review surface; the legacy `proposal-view.ts` / `proposal-modal.ts` were removed.
- `ImageAnalyzer.analyzeImage` selects the vision model via `AIRequestOptions.model` on the single `chat()` call (image-analyzer.ts:151); no settings mutation, so concurrent callers cannot observe it.
- `onunload` (index.ts:124-127) clears `scanInterval` and nulls the field, so a later `onload` cannot double-clear a stale handle.
