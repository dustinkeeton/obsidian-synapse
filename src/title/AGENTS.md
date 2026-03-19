---
last-updated: 2026-03-18
---

# title — Agent Reference

Detects notes with "Untitled" filenames or content-mismatched titles and proposes AI-generated alternatives.

## Public API

### TitleModule

```ts
class TitleModule {
  constructor(
    plugin: Plugin,
    getSettings: () => SynapseSettings,
    notifications: NotificationManager
  )

  async onload(): Promise<void>
  onunload(): void

  async getPendingProposals(): Promise<TitleProposal[]>
  async checkUntitled(filePath: string): Promise<void>
  async checkMismatch(filePath: string): Promise<void>
  async checkTitle(filePath: string): Promise<void>
  async acceptProposal(id: string): Promise<void>
  async rejectProposal(id: string): Promise<void>

  onViewRefreshNeeded?: () => Promise<void>
}
```

### Exported Functions

```ts
function isUntitled(basename: string): boolean
```

### Types

```ts
type TitleProposalTrigger = 'untitled' | 'content-mismatch'
type TitleProposalStatus = 'pending' | 'accepted' | 'rejected'

interface TitleProposal {
  id: string; sourceNotePath: string; currentTitle: string
  proposedTitle: string; trigger: TitleProposalTrigger
  reasoning: string; createdAt: string; status: TitleProposalStatus
}
```

## Internal Architecture

| File | Purpose |
|------|---------|
| `index.ts` | Re-exports module, types, `isUntitled` |
| `title-module.ts` | Main module: title checking, proposal lifecycle |
| `title-suggester.ts` | AI title generation and mismatch detection |
| `title-proposal-store.ts` | JSON persistence in `.synapse/title-proposals/` |
| `types.ts` | `TitleProposal`, trigger/status types |

## Data Flow

```
checkTitle(filePath) [called after enrichment/elaboration/transcription/summarize/deep-dive]
  --> checkUntitled(filePath): if "Untitled*" → suggestTitle()
  --> checkMismatch(filePath): AI evaluates title vs content
  --> TitleProposalStore.save(proposal)
  --> onViewRefreshNeeded()

acceptProposal(id)
  --> rename file to proposedTitle
  --> TitleProposalStore.updateStatus('accepted')
```

## Commands

No direct commands. Title checks are triggered via cross-module callbacks wired in main.ts.

## Configuration

| Key | Type | Default |
|-----|------|---------|
| `title.enabled` | boolean | true |
| `title.proposalFolderPath` | string | `.synapse/title-proposals` |
| `title.checkAfterOperations` | boolean | true |

## Dependencies

- `shared/` — AIClient, NotificationManager, file-utils
- No CheckpointManager (single-note operation)
