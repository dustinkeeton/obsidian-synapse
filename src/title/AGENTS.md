---
last-updated: 2026-06-29
---

# title module

Detects notes with "Untitled" filenames or content-mismatched titles and proposes AI-generated alternatives. No commands — triggered via cross-module callbacks wired in `main.ts` (invoked as `checkTitle(path, { postOp: true })`).

## Public API (`index.ts`)

```ts
class TitleModule {
  onViewRefreshNeeded: (() => Promise<void>) | null = null
  onOpenProposalView: (() => void) | null = null  // wired by main.ts (#340)

  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    shouldAutoAccept?: () => boolean
  )

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<TitleProposal[]>
  checkTitle(filePath: string, options?: { postOp?: boolean }): Promise<void>
  checkUntitled(filePath: string, options?: { postOp?: boolean }): Promise<void>
  checkMismatch(filePath: string, options?: { postOp?: boolean }): Promise<void>
  acceptProposal(
    id: string,
    options?: { silent?: boolean; resolution?: TitleDuplicateStrategy }
  ): Promise<TitleAcceptOutcome>
  rejectProposal(id: string): Promise<void>
}

function isUntitled(title: string): boolean              // re-exported from shared/title-detector
function renderTitleSettings(ctx: SettingsSectionContext): void  // re-exported from settings-section
```

Note: `TitleModule` does NOT take a `CheckpointManager`. Title proposals are single-note operations; no checkpoint support.

Exported types: `TitleProposal`, `TitleProposalTrigger`, `TitleProposalStatus`, `TitleDuplicateStrategy`, `TitleAcceptOutcome`

```ts
type TitleAcceptOutcome =
  | { status: 'renamed'; path: string }
  | { status: 'merged'; into: string }
  | { status: 'conflict'; target: string }
  | { status: 'skipped' }
```

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `TitleModule`, re-exports | Module entry point and public API |
| `title-suggester.ts` | `TitleSuggester` | AI title suggestion and mismatch detection |
| `title-store.ts` | `TitleProposalStore` | JSON persistence in `settings.title.proposalFolderPath` |
| `content-key.ts` | `titleContentKey` | Deterministic input-keyed dedup hash for proposals (#408) |
| `settings-section.ts` | `renderTitleSettings` | Title settings accordion (enabled toggle + duplicate-handling dropdown) (#408) |
| `title-detector.ts` | re-exports `isUntitled` | Thin re-export of `isUntitled` from `shared/title-detector` (its canonical home) |
| `types.ts` | -- | All title types |

## TitleSuggester (`title-suggester.ts`)

```ts
class TitleSuggester {
  constructor(aiClient: AIClient)
  suggestTitle(content: string, currentTitle: string): Promise<{ title: string; reasoning: string }>
  checkTitleMismatch(content: string, currentTitle: string): Promise<{ isMismatch: boolean; suggestedTitle?: string; reasoning?: string }>
}
```

Content truncated to 4000 chars before AI call. Both methods run `sanitizeAIResponse` + `stripCodeFences` on output; titles are stripped of file-name-invalid chars (`: \ | ? * " < > /`).

## titleContentKey (`content-key.ts`)

```ts
function titleContentKey(
  notePath: string,
  content: string,
  currentTitle: string,
  trigger: TitleProposalTrigger,
  settings: SynapseSettings,
): string
```

Keys over INPUTS: `normalizePath(notePath)`, `hashString(content)`, `currentTitle`, `trigger`, `ai.provider`, `ai.model`, `ai.temperature`, `ai.maxTokens`. Mirrors `proposalContentKey` in `elaboration/proposer.ts`. Keying on inputs (not the model's output) makes re-scanning an unchanged note idempotent so the reject-loop dedup guard holds despite temperature>0 sampling.

## renderTitleSettings (`settings-section.ts`)

```ts
function renderTitleSettings(ctx: SettingsSectionContext): void
```

Renders the feature accordion: header toggle binds `settings.title.enabled`; the "Duplicate handling" dropdown sets `settings.title.duplicateHandling` (`iterate` / `merge`) — the DEFAULT resolution used by auto-accept on a collision. Consumed by `settings-tab.ts`.

## isUntitled (`shared/title-detector.ts`, re-exported by `title-detector.ts`)

```ts
function isUntitled(title: string): boolean
// Matches "Untitled", "Untitled 1", "Untitled 2", etc. (case-insensitive)
// Pattern: /^untitled(\s+\d+)?$/i (on title.trim())
```

Canonical definition lives in `shared/title-detector.ts` (alongside `isGenericTitle`, used by elaboration's anti-fabrication guard) so non-`title/` features can reuse it without importing from this module. `title/title-detector.ts` re-exports it.

## Data Flow

```
checkTitle(filePath, options?)  [main.ts wires it as { postOp: true } after enrichment/elaboration/transcription/summarize/deep-dive accept]
  --> return if not a TFile
  --> isPathExcluded(file.path, 'title', settings)  [silent skip if excluded]
  --> if isUntitled(basename): checkUntitled(filePath, options)
  --> else: checkMismatch(filePath, options)

checkUntitled(filePath, options?)
  --> return if not a TFile, or if !isUntitled(basename)
  --> readNote(); return if content empty/whitespace
  --> key = titleContentKey(filePath, content, basename, 'untitled', settings)
  --> loadForNote(filePath); skip if any pending proposal exists
  --> skip if existing proposal has same contentKey and status !== 'accepted'  [reject-loop dedup #408]
  --> TitleSuggester.suggestTitle(content, basename)  [AI]
  --> return if suggested title empty or itself isUntitled()
  --> build proposal {trigger:'untitled', contentKey:key}
  --> computeTargetPath(file, title); if a different file occupies it, set proposal.conflictsWith  [UI hint]
  --> store.save(proposal)
  --> maybeAutoAccept(proposal)  [if shouldAutoAccept(): acceptProposal(id,{silent:true}); announces REAL outcome]
  --> action = reviewAction({ generated:true, shouldAutoAccept, openProposalView, postOp: options?.postOp })
  --> if action: notifications.success('Title proposal ready', undefined, action)
  --> refreshView() --> onViewRefreshNeeded?()

checkMismatch(filePath, options?)
  --> return if not a TFile, or if isUntitled (handled by checkUntitled)
  --> readNote(); return if content empty/whitespace
  --> key = titleContentKey(..., 'content-mismatch', settings)
  --> loadForNote; skip if pending; skip if same contentKey and status !== 'accepted'
  --> TitleSuggester.checkTitleMismatch(content, basename)  [AI]
  --> return unless result.isMismatch && result.suggestedTitle
  --> build proposal {trigger:'content-mismatch', contentKey:key}; flag conflictsWith
  --> store.save; maybeAutoAccept; reviewAction toast; refreshView

acceptProposal(id, options?)  -> TitleAcceptOutcome
  --> store.load(id); { status:'skipped' } if not found
  --> guard: { status:'skipped' } if proposal.status !== 'pending'
  --> if source note no longer a TFile: info notice, updateStatus 'rejected', refreshView, { status:'skipped' }
  --> targetPath = computeTargetPath(file, proposedTitle); collision = a different file occupies targetPath  [live recheck #408]
  --> no collision: vault.rename(file, targetPath), accepted, announce --> { status:'renamed', path }
  --> collision: resolution = options.resolution ?? (shouldAutoAccept() ? settings.title.duplicateHandling : undefined)
        --> no resolution (plain manual accept): persist conflictsWith, info 'choose Add suffix or Merge', stay pending --> { status:'conflict', target }
        --> 'merge' & target is TFile: mergeNotes(file, existing), accepted, announce --> { status:'merged', into }
        --> 'merge' & target not a TFile: info 'Nothing to merge into — renamed instead', rename, accepted --> { status:'renamed', path }
        --> 'iterate': findAvailableVaultPath(targetPath), rename to free suffixed path, accepted --> { status:'renamed', path }
  --> on rename/process throw: notifyError, rethrow Error('Rename failed: ...')

mergeNotes(source, target)  [private]
  --> read source; vault.process(target): union frontmatter (target wins scalar conflicts; tags+aliases unioned),
      bodies joined target-first by `\n\n---\n\n`
  --> fileManager.trashFile(source)  [recoverable]

rejectProposal(id)
  --> store.updateStatus(id, 'rejected')
  --> notifications.info('Title proposal rejected')
  --> refreshView() --> onViewRefreshNeeded?()
```

## Key Types

```ts
type TitleProposalTrigger = 'untitled' | 'content-mismatch'
type TitleProposalStatus = 'pending' | 'accepted' | 'rejected'
type TitleDuplicateStrategy = 'iterate' | 'merge'

interface TitleProposal {
  id: string
  sourceNotePath: string
  currentTitle: string
  proposedTitle: string
  trigger: TitleProposalTrigger
  reasoning: string
  createdAt: string
  status: TitleProposalStatus
  contentKey?: string      // input-keyed dedup hash; optional for pre-#408 proposals
  conflictsWith?: string   // same-folder collision target captured at proposal time (UI hint; re-validated live)
}

type TitleAcceptOutcome =
  | { status: 'renamed'; path: string }
  | { status: 'merged'; into: string }
  | { status: 'conflict'; target: string }
  | { status: 'skipped' }
```

## Commands

None. Title checks are triggered via cross-module callbacks in `main.ts` (post-elaboration, post-enrichment, post-transcription, post-summarize, post-deep-dive accept). `checkTitle` is the single entry point and is invoked with `{ postOp: true }`, which suppresses the secondary "Title proposal ready" Review toast (#366).

## Settings Keys

Path exclusion is centralized (#307): `settings.exclusions: ExclusionRule[]` consulted via `isPathExcluded(path, 'title', settings)`. There is no per-module `excludeFolders` key. Title module has no `excludeTags` field.

| Key | Type | Default |
|-----|------|---------|
| `settings.title.enabled` | `boolean` | `true` |
| `settings.title.proposalFolderPath` | `string` | `.synapse/title-proposals` |
| `settings.title.checkAfterOperations` | `boolean` | `true` |
| `settings.title.duplicateHandling` | `TitleDuplicateStrategy` (`'iterate' \| 'merge'`) | `iterate` |
| `settings.autoAccept.title` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | see `settings.ts` defaults |

## Dependencies

In: `shared/` (AIClient, NotificationManager, generateId, readNote, isPathExcluded, reviewAction, findAvailableVaultPath, parseFrontmatter, serializeFrontmatter, mergeTags, normalizeFrontmatterTags, contentKey, hashString, ensureFolder, isRecord, readJsonFile, sanitizeAIResponse, stripCodeFences, isUntitled, SettingsSectionContext), `settings.ts` (SynapseSettings, TitleDuplicateStrategy), `obsidian` (Plugin, TFile, normalizePath, Setting, App)

Out: consumed by `main.ts` (TitleModule, checkTitle), `views/` (TitleProposal, TitleDuplicateStrategy types), `settings-tab.ts` (renderTitleSettings). No feature module imports from `title/`.

## Invariants / Gotchas

- No `CheckpointManager` — title proposals are always single-note, never batched.
- `acceptProposal` guards against double-acceptance: returns `{ status: 'skipped' }` if `proposal.status !== 'pending'`.
- Collision is rechecked LIVE at accept time (#408): `computeTargetPath` is recomputed and a stale `conflictsWith` never drives a rename. A plain manual Accept on a live collision NEVER overwrites — it surfaces "Add suffix or Merge" and leaves the proposal pending (`{ status: 'conflict' }`). Auto-accept derives the resolution from `settings.title.duplicateHandling`.
- `iterate` renames to the next free `-1`/`-2` path via `findAvailableVaultPath`; `merge` folds the note into the existing one (frontmatter union — target wins scalars, tags+aliases unioned — bodies joined by a horizontal rule) and trashes the source (recoverable). `merge` falls back to a plain rename when the target is not a TFile.
- Reject-loop dedup (#408): both check methods skip when an existing proposal has the same `contentKey` and `status !== 'accepted'`. Editing the note changes the content hash → key → a new proposal is allowed; an `accepted` proposal never blocks.
- `contentKey` is computed from inputs BEFORE the AI call (temperature>0 output would otherwise vary every run).
- Auto-accept for title RENAMES (or MERGES) the file; the notice reflects the REAL outcome (suffixed name / merge target), not the originally proposed title (#408).
- `checkTitle` is silent: no notifications until a proposal is confirmed or auto-accepted. The Review toast is gated through `reviewAction()` and suppressed for `postOp` invocations (#366) and when auto-accept is on.
- `checkMismatch` skips notes that are already untitled (let `checkUntitled` handle those).
- Both check methods skip if any pending proposal already exists for the note.

## Error States

| Condition | Handling |
|-----------|----------|
| AI call fails in `checkUntitled`/`checkMismatch` | Caught; `console.warn('[Synapse] Title suggestion failed ...' / 'Title mismatch check failed ...')`; no user notice (flow is silent) |
| Note content empty/whitespace | Silent return; no proposal generated |
| Suggested title empty or itself `isUntitled()` | Silent return; no proposal saved (`checkUntitled`) |
| `acceptProposal`: source note missing | `notifications.info('Source note no longer exists')`; proposal marked `rejected`; returns `{ status: 'skipped' }` |
| `acceptProposal`: live collision, no resolution (plain manual accept) | `notifications.info('"<title>" already exists — choose Add suffix or Merge')`; proposal stays pending; returns `{ status: 'conflict' }` |
| `acceptProposal`: merge target is not a TFile | `notifications.info('Nothing to merge into — renamed instead')`; plain rename; returns `{ status: 'renamed' }` |
| `acceptProposal`: `vault.rename`/`vault.process` throws | `notifications.notifyError('Failed to rename note', error)`; rethrows `Error('Rename failed: <msg>')` |
| Persisted proposal JSON fails `isTitleProposal` guard | File skipped during load (`title-store.ts:L7`) |

## Tests

| File | Covers |
|------|--------|
| `title-detector.test.ts` | isUntitled pattern matching |
| `title-suggester.test.ts` | TitleSuggester.suggestTitle, checkTitleMismatch |
| `title-store.test.ts` | TitleProposalStore persistence |
| `content-key.test.ts` | titleContentKey determinism + input sensitivity (#408) |
| `settings-section.test.ts` | renderTitleSettings accordion + duplicateHandling default (#408) |
| `duplicate-handling.test.ts` | collision resolution: conflict flag, iterate, merge, live recheck, reject-loop dedup (#408) |
| `auto-accept.test.ts` | Auto-accept flow (#228) |
| `review-toast.test.ts` | Review toast notification behavior |
