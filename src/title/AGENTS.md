---
last-updated: 2026-06-19
---

# title module

Detects notes with "Untitled" filenames or content-mismatched titles and proposes AI-generated alternatives. No commands — triggered via cross-module callbacks wired in `main.ts`.

## Public API (`index.ts`)

```ts
class TitleModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null  // wired by main.ts (#340)

  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager,
    shouldAutoAccept?: () => boolean
  )

  onload(): Promise<void>
  onunload(): void
  getPendingProposals(): Promise<TitleProposal[]>
  checkTitle(filePath: string): Promise<void>
  checkUntitled(filePath: string): Promise<void>
  checkMismatch(filePath: string): Promise<void>
  acceptProposal(id: string, options?: { silent?: boolean }): Promise<void>
  rejectProposal(id: string): Promise<void>
}

function isUntitled(basename: string): boolean
```

Note: `TitleModule` does NOT take a `CheckpointManager`. Title proposals are single-note operations; no checkpoint support.

Exported types: `TitleProposal`, `TitleProposalTrigger`, `TitleProposalStatus`

## Internal File Map

| File | Class/Function | Role |
|------|---------------|------|
| `index.ts` | `TitleModule`, re-exports | Module entry point and public API |
| `title-suggester.ts` | `TitleSuggester` | AI title suggestion and mismatch detection |
| `title-store.ts` | `TitleProposalStore` | JSON persistence in `settings.title.proposalFolderPath` |
| `title-detector.ts` | `isUntitled` | Regex check for Obsidian "Untitled" default pattern |
| `types.ts` | -- | All title types |

## TitleSuggester (`title-suggester.ts`)

```ts
class TitleSuggester {
  constructor(aiClient: AIClient)
  suggestTitle(content: string, currentTitle: string): Promise<{ title: string; reasoning: string }>
  checkTitleMismatch(content: string, currentTitle: string): Promise<{ isMismatch: boolean; suggestedTitle?: string; reasoning?: string }>
}
```

Content truncated to 4000 chars before AI call.

## isUntitled (`title-detector.ts`)

```ts
function isUntitled(title: string): boolean
// Matches "Untitled", "Untitled 1", "Untitled 2", etc. (case-insensitive)
// Pattern: /^untitled(\s+\d+)?$/i
```

## Data Flow

```
checkTitle(filePath)  [called by main.ts after enrichment/elaboration/transcription/etc.]
  --> isPathExcluded(file.path, 'title', settings)  [silent skip if excluded]
  --> if isUntitled(basename): checkUntitled(filePath)
  --> else: checkMismatch(filePath)

checkUntitled(filePath)
  --> skip if existing pending proposal for this note
  --> TitleSuggester.suggestTitle(content, basename)  [AI]
  --> TitleProposalStore.save(proposal)
  --> maybeAutoAccept(proposal)  [if shouldAutoAccept(): acceptProposal(id, {silent:true})]
  --> if not auto-accepted: notifications.success('Title proposal ready', ..., Review toast)
  --> onViewRefreshNeeded?()

checkMismatch(filePath)
  --> skip if isUntitled (handled by checkUntitled)
  --> skip if existing pending proposal for this note
  --> TitleSuggester.checkTitleMismatch(content, basename)  [AI]
  --> if mismatch: TitleProposalStore.save(proposal)
  --> maybeAutoAccept(proposal)
  --> if not auto-accepted: notifications.success('Title proposal ready', ..., Review toast)
  --> onViewRefreshNeeded?()

acceptProposal(id, options?)
  --> guard: no-op if proposal.status !== 'pending'
  --> check no file exists at target path (in-folder rename collision)
  --> vault.rename(file, newPath)
  --> TitleProposalStore.updateStatus(id, 'accepted')
  --> if !silent: notifications.success, onViewRefreshNeeded?()

rejectProposal(id)
  --> TitleProposalStore.updateStatus(id, 'rejected')
  --> onViewRefreshNeeded?()
```

## Key Types

```ts
type TitleProposalTrigger = 'untitled' | 'content-mismatch'
type TitleProposalStatus = 'pending' | 'accepted' | 'rejected'

interface TitleProposal {
  id: string
  sourceNotePath: string
  currentTitle: string
  proposedTitle: string
  trigger: TitleProposalTrigger
  reasoning: string
  createdAt: string
  status: TitleProposalStatus
}
```

## Commands

None. Title checks are triggered via cross-module callbacks in `main.ts` (post-elaboration, post-enrichment, post-transcription, post-summarize, post-deep-dive accept). The `checkTitle` method is the single entry point.

## Settings Keys

Path exclusion is centralized (#307): `settings.exclusions: ExclusionRule[]` consulted via `isPathExcluded(path, 'title', settings)`. There is no per-module `excludeFolders` key. Title module has no `excludeTags` field.

| Key | Type | Default |
|-----|------|---------|
| `settings.title.enabled` | `boolean` | `true` |
| `settings.title.proposalFolderPath` | `string` | `.synapse/title-proposals` |
| `settings.title.checkAfterOperations` | `boolean` | `true` |
| `settings.autoAccept.title` | `boolean` | `false` |
| `settings.exclusions` | `ExclusionRule[]` | see `settings.ts` defaults |

## Dependencies

In: `shared/` (AIClient, NotificationManager, generateId, readNote, isPathExcluded), `settings.ts` (SynapseSettings)

Out: Nothing. No other feature module imports from `title/`.

## Invariants / Gotchas

- No `CheckpointManager` — title proposals are always single-note, never batched.
- `acceptProposal` guards against double-acceptance: no-ops if `proposal.status !== 'pending'`.
- `acceptProposal` does an in-folder rename: the new path is `<parentFolder>/<proposedTitle>.md`. Aborts if a file already exists at that path.
- Auto-accept for title RENAMES the file on the filesystem (same as accept, just silent).
- `checkTitle` is silent: no notifications until a proposal is confirmed or auto-accepted.
- The Review toast fires via `notifications.success('Title proposal ready', undefined, { label: 'Review', onClick: ... })` — only when a proposal remains pending after generation.
- `checkMismatch` skips notes that are already untitled (let `checkUntitled` handle those).
- Both check methods skip if any pending proposal already exists for the note (prevents duplicate proposals).

## Tests

| File | Covers |
|------|--------|
| `title-detector.test.ts` | isUntitled pattern matching |
| `title-suggester.test.ts` | TitleSuggester.suggestTitle, checkTitleMismatch |
| `title-store.test.ts` | TitleProposalStore persistence |
| `auto-accept.test.ts` | Auto-accept flow (#228) |
| `review-toast.test.ts` | Review toast notification behavior |
