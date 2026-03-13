---
last-updated: 2026-03-13
---

# Elaboration Module

Detects stub/placeholder notes in the vault and generates AI-powered elaboration proposals for non-destructive review.

## Public API

Exported from `index.ts`:

```ts
class ElaborationModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  scanVault(): Promise<number>
  scanNote(file: TFile): Promise<void>
  acceptProposal(id: string, editedContent?: string): Promise<void>
  rejectProposal(id: string): Promise<void>
  getPendingProposals(): Promise<Proposal[]>
  onProposalAccepted: ((filePath: string) => void) | null
  onViewRefreshNeeded: (() => Promise<void>) | null
}

type DetectionReason =
  | { type: 'short-note'; wordCount: number }
  | { type: 'todo-marker'; markers: string[] }
  | { type: 'empty-section'; heading: string }
  | { type: 'sparse-link'; linkedFrom: string[] }

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
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `DetectionReason`, `DetectionResult`, `Proposal` | Type definitions |
| `detector.ts` | `PlaceholderDetector` | Scans notes for stub signals |
| `proposer.ts` | `ProposalGenerator` | AI proposal generation with context gathering |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON files |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Legacy sidebar view (not registered by main.ts) |
| `proposal-modal.ts` | `ProposalDetailModal` | Legacy modal for editing proposals |
| `index.ts` | `ElaborationModule` | Orchestrator, commands, scan intervals |

## Data Flow

```
1. scanVault() / scanNote()
   |
2. PlaceholderDetector.detect(file)
   |  Checks: word count, TODO markers, empty sections, sparse links
   |  Filters: excludeFolders, excludeTags
   |  Returns: DetectionResult | null
   |
3. Two-phase confirmation (vault scan only):
   |  Phase 1: lightweight detection (no API calls)
   |  Phase 2: NotificationManager.confirm() snackbar
   |  Phase 3: cancellable proposal generation
   |
4. ProposalGenerator.generate(detection)
   |  Gathers context from up to 5 linked notes (500 chars each)
   |  AIClient.complete() with system prompt
   |  sanitizeAIResponse() on output
   |  Returns: Proposal (status: 'pending')
   |
5. ProposalStore.save(proposal)
   |
6. onViewRefreshNeeded() --> main.refreshUnifiedView()
   |
7. User action via UnifiedProposalView:
   Accept --> blockquoteOriginal(content), sanitizeAIResponse(additions), append
   Reject --> status = 'rejected'
```

## Detection Rules

| Rule | Setting | Logic |
|------|---------|-------|
| Short note | `detection.minWordThreshold` | `wordCount(body) < threshold` |
| TODO markers | `detection.detectTodoMarkers` | Regex: `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` |
| Empty sections | `detection.detectEmptySections` | Heading with no content before next same-or-higher heading |
| Sparse links | `detection.detectSparseLinks` | Inbound links AND word count below threshold |

## Accept Behavior

On accept, the original note content is wrapped in a blockquote with attribution (`blockquoteOriginal()`), then sanitized AI additions are appended. This preserves the original while adding new content.

## Error Handling

- `scanVault`: two-phase with cancellation; auto-rejects created proposals on error/cancel
- `scanNote`: catches errors, reports via `NotificationManager.startOperation()`
- `ProposalStore.loadAll`: silently skips unparseable JSON
- `acceptProposal`: no-ops if proposal or source file not found
