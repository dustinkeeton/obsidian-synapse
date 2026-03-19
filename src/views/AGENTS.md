---
last-updated: 2026-03-18
---

# Views Module

Unified sidebar view combining elaboration, enrichment, organize, deep-dive, and title proposals in a single pane. Displays checkpoint recovery banner for interrupted operations. Supports batch Accept All.

## Public API

Exported from `unified-proposal-view.ts`:

```ts
const UNIFIED_VIEW_TYPE = 'synapse-proposals'

type UnifiedItem =
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment'; data: EnrichmentProposal }
  | { kind: 'organize'; data: OrganizeProposal }
  | { kind: 'deep-dive'; data: DeepDiveProposal }
  | { kind: 'title'; data: TitleProposal }

interface UnifiedViewCallbacks {
  onElaborationAccept: (id: string, editedContent: string) => Promise<void>
  onElaborationReject: (id: string) => Promise<void>
  onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>
  onEnrichmentReject: (id: string) => Promise<void>
  onOrganizeAccept: (id: string) => Promise<void>
  onOrganizeReject: (id: string) => Promise<void>
  onDeepDiveAccept: (id: string) => Promise<void>
  onDeepDiveReject: (id: string) => Promise<void>
  onTitleAccept: (id: string) => Promise<void>
  onTitleReject: (id: string) => Promise<void>
  onCheckpointDiscard: (id: string) => Promise<void>
  onCheckpointResume: (id: string) => Promise<void>
}

class UnifiedProposalView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: UnifiedViewCallbacks)
  setItems(items: UnifiedItem[]): void
  setCheckpoints(checkpoints: Checkpoint[]): void
  getViewType(): string   // 'synapse-proposals'
  getDisplayText(): string // 'Synapse Proposals'
  getIcon(): string        // 'sparkles'
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE` | Combined proposal sidebar with checkpoint banner |
| `types.ts` | `UnifiedItem`, `UnifiedViewCallbacks` | View type definitions |

## Rendering Modes

1. **Checkpoint banner**: When incomplete checkpoints exist, shows a banner per checkpoint with module label, progress (done/total), and Resume/Discard buttons.

2. **List mode**: Groups all pending proposals by source note path. Accept All button when 2+ proposals. Each card shows badge, reasons/summary, preview, and action buttons (Review/Accept/Reject).

3. **Elaboration review**: Back button, source note link, detection reasons, editable textarea for proposed additions. Accept sends edited content.

4. **Enrichment review**: Back button, source note link, per-item checkboxes for tags/links/refs/frontmatter. Accept Selected/All/None/Reject buttons.

5. **Organize review**: Back button, source note link, proposed directory path, AI reasoning text. Accept/Reject buttons.

6. **Deep-dive review**: Back button, topic title, depth badge, quality score, source note link, quality reasoning, proposed path, read-only content preview, child count warning. Accept/Reject buttons.

7. **Title review**: Back button, source note link, current vs proposed title, trigger reason (untitled/mismatch), AI reasoning. Accept (rename)/Reject buttons.

## Accept All

- Available when 2+ proposals pending
- Processes sequentially (organize proposals may affect file paths)
- Shows progress bar during batch
- Stops on first failure, reports count
- For enrichment: accepts all suggested items (tags + links + refs + frontmatter)

## Card Types

| Kind | Badge Color | Border Color |
|------|------------|--------------|
| elaboration | `interactive-accent` (blue) | `interactive-accent` |
| enrichment | `color-green` | `color-green` |
| organize | `color-orange` | `color-orange` |
| deep-dive | `color-purple` | `color-purple` |
| title | `color-yellow` | `color-yellow` |

Deep-dive cards additionally show depth badge and quality score badge.

## Wiring (in main.ts)

```ts
this.registerView(UNIFIED_VIEW_TYPE, (leaf) => {
  return new UnifiedProposalView(leaf, {
    onElaborationAccept: (id, content) => this.elaboration.acceptProposal(id, content),
    onElaborationReject: (id) => this.elaboration.rejectProposal(id),
    onEnrichmentAcceptSelected: (id, accepted) => this.enrichment.acceptSelectedFromView(id, accepted),
    onEnrichmentReject: (id) => this.enrichment.rejectFromView(id),
    onOrganizeAccept: (id) => this.organize.acceptProposal(id),
    onOrganizeReject: (id) => this.organize.rejectProposal(id),
    onDeepDiveAccept: (id) => this.deepDive.acceptProposal(id),
    onDeepDiveReject: (id) => this.deepDive.rejectProposal(id),
    onTitleAccept: (id) => this.title.acceptProposal(id),
    onTitleReject: (id) => this.title.rejectProposal(id),
    onCheckpointDiscard: (id) => this.discardCheckpoint(id),
    onCheckpointResume: (id) => this.resumeCheckpoint(id),
  });
});
```

Refreshed via `main.refreshUnifiedView()` which gathers items from all five modules and incomplete checkpoints.

## Dependencies

| Import | From |
|--------|------|
| `Proposal` | `../elaboration` (type only) |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` (type only) |
| `OrganizeProposal` | `../organize` (type only) |
| `DeepDiveProposal` | `../deep-dive` (type only) |
| `TitleProposal` | `../title` (type only) |
| `Checkpoint` | `../shared` (type only) |

## Features

- Clickable note headings open the source note in main editor
- Auto-exits review mode if reviewed proposal is no longer in pending list
- Injects scoped CSS on first open (id: `synapse-unified-view-styles`)
- Color-coded cards: blue for elaboration, green for enrichment, orange for organize, purple for deep-dive, yellow for title
- Checkpoint banner with progress display and Resume/Discard actions
