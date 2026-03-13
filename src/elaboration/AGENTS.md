---
last-updated: 2026-03-12
---

# Elaboration Module

Detects stub/placeholder notes in the vault and generates AI-powered elaboration proposals for non-destructive review.

## Public API

Exported from `index.ts`:

```ts
class ElaborationModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings)
  onload(): Promise<void>
  onunload(): void
  scanVault(): Promise<number>
  scanNote(file: TFile): Promise<void>
  acceptProposal(id: string): Promise<void>
  rejectProposal(id: string): Promise<void>
  activateProposalView(): Promise<void>
}

const PROPOSAL_VIEW_TYPE = 'auto-notes-proposal-review'

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

## Internal Files

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `DetectionReason`, `DetectionResult`, `Proposal` | Type definitions |
| `detector.ts` | `PlaceholderDetector` | Scans notes for stub signals (word count, TODO markers, empty sections, sparse links) |
| `proposer.ts` | `ProposalGenerator` | Generates elaboration content via AIClient, gathers context from linked notes |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON files in vault |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Sidebar ItemView listing pending proposals grouped by source note |
| `proposal-modal.ts` | `ProposalDetailModal` | Modal for viewing/editing a proposal before accept |
| `index.ts` | `ElaborationModule` | Orchestrator, registers commands and view, manages scan intervals |

## Data Flow

```
1. scanVault() / scanNote()
   |
2. PlaceholderDetector.detect(file)
   |  Checks: word count < minWordThreshold, TODO/TBD/FIXME/PLACEHOLDER markers,
   |          headings with no content beneath, notes linked from many but sparse
   |  Filters: excludeFolders (path prefix), excludeTags (frontmatter)
   |  Strips frontmatter before analysis
   |  Returns: DetectionResult | null
   |
3. ProposalGenerator.generate(detection)
   |  Reads note content via vault.adapter.read()
   |  Gathers context from up to 5 linked notes (first 500 chars each)
   |  Calls AIClient.complete() with system prompt
   |  Sanitizes AI response via sanitizeAIResponse()
   |  Returns: Proposal (status: 'pending', insertionPoint: 'append')
   |
4. ProposalStore.save(proposal)
   |  Writes JSON to {proposalFolderPath}/{noteName}-{shortId}.json
   |
5. ProposalReviewView.setProposals() -- refreshes sidebar
   |
6. User action:
   -- Accept -> sanitizeAIResponse(proposedAdditions), appends to source note, status -> 'accepted'
   -- View -> ProposalDetailModal (editable textarea), sanitizeAIResponse on accept
   -- Reject -> status -> 'rejected'
```

## PlaceholderDetector Detection Rules

| Rule | Setting | Logic |
|------|---------|-------|
| Short note | `detection.minWordThreshold` | `wordCount(body) < threshold` after stripping frontmatter |
| TODO markers | `detection.detectTodoMarkers` | Regex match for `\bTODO\b`, `\bTBD\b`, `\bFIXME\b`, `\bPLACEHOLDER\b` (case-insensitive for PLACEHOLDER) |
| Empty sections | `detection.detectEmptySections` | Heading followed by no content before next same-or-higher-level heading |
| Sparse links | `detection.detectSparseLinks` | Inbound links from other notes AND word count below threshold |

Exclusion checks run first: folder path prefix match, frontmatter tag match.

## ProposalStore Storage

- Location: `settings.elaboration.proposalFolderPath` (default: `.auto-notes/proposals`)
- Format: JSON files named `{notePath-with-dashes}-{8-char-uuid}.json`
- Operations: `save`, `load(id)`, `loadAll`, `loadPending`, `delete(id)`, `updateStatus(id, status)`
- `init()` called on module load to ensure folder exists

## Settings Keys

All under `settings.elaboration`:

| Key | Controls |
|-----|----------|
| `enabled` | Module activation at startup |
| `proposalFolderPath` | Storage location for proposal JSON files |
| `scanOnStartup` | Auto-scan vault 5s after plugin load |
| `autoScanInterval` | Recurring scan interval in minutes (0=disabled) |
| `detection.minWordThreshold` | Word count below which a note is flagged |
| `detection.detectTodoMarkers` | Scan for TODO/TBD/FIXME/PLACEHOLDER |
| `detection.detectEmptySections` | Flag headings with no content beneath |
| `detection.detectSparseLinks` | Flag notes linked from many but with sparse content |
| `detection.excludeFolders` | Folder paths to skip |
| `detection.excludeTags` | Frontmatter tags that suppress detection |
| `proposal.maxProposalsPerNote` | Max proposals per note (not yet enforced in code) |
| `proposal.preserveFrontmatter` | Preserve frontmatter when appending (not yet enforced in code) |
| `proposal.includeSourceContext` | Gather linked note context for AI prompt |

## Error Handling

- `scanVault` / `scanNote`: catches all errors, calls `notifyError()` (Notice + console.error)
- `ProposalStore.loadAll`: silently skips unparseable JSON files
- `acceptProposal`: no-ops if proposal or source file not found
- AI-generated content sanitized via `sanitizeAIResponse()` before writing to vault
