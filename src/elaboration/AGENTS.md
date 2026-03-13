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
| `detector.ts` | `PlaceholderDetector` | Scans notes for stub signals |
| `proposer.ts` | `ProposalGenerator` | Generates elaboration content via AI |
| `proposal-store.ts` | `ProposalStore` | CRUD for proposal JSON files in vault |
| `proposal-view.ts` | `ProposalReviewView`, `PROPOSAL_VIEW_TYPE` | Sidebar ItemView listing pending proposals |
| `proposal-modal.ts` | `ProposalDetailModal` | Modal for viewing/editing a proposal before accept |
| `index.ts` | `ElaborationModule` | Orchestrator, registers commands and view |

## Data Flow

```
1. scanVault() / scanNote()
   │
2. PlaceholderDetector.detect(file)
   │  Checks: word count, TODO markers, empty sections, sparse links
   │  Respects: excludeFolders, excludeTags
   │  Returns: DetectionResult | null
   │
3. ProposalGenerator.generate(detection)
   │  Reads note content + context from linked notes (up to 5)
   │  Calls AIClient.complete() with system prompt
   │  Returns: Proposal (status: 'pending')
   │
4. ProposalStore.save(proposal)
   │  Writes JSON to .auto-notes/proposals/{noteName}-{shortId}.json
   │
5. ProposalReviewView.setProposals() — refreshes sidebar
   │
6. User action:
   ├── Accept → sanitizeAIResponse(proposedAdditions), appends to source note, status → 'accepted'
   ├── View → ProposalDetailModal (editable textarea), sanitizeAIResponse on accept
   └── Reject → status → 'rejected'
```

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
| `proposal.maxProposalsPerNote` | Max proposals per note (not yet enforced) |
| `proposal.preserveFrontmatter` | Preserve frontmatter when appending |
| `proposal.includeSourceContext` | Gather linked note context for AI prompt |

## Error Handling

- `scanVault` / `scanNote`: catches all errors, calls `notifyError()` (Notice + console.error)
- `ProposalStore.loadAll`: silently skips unparseable JSON files
- `acceptProposal`: no-ops if proposal or source file not found
- AI-generated content sanitized via `sanitizeAIResponse()` before writing to vault (strips scripts, event handlers, dangerous URIs)
