---
last-updated: 2026-03-13
---

# Views Module

Unified sidebar view combining elaboration and enrichment proposals in a single pane.

## Public API

Exported from `unified-proposal-view.ts`:

```ts
const UNIFIED_VIEW_TYPE = 'auto-notes-proposals'

type UnifiedItem =
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment'; data: EnrichmentProposal }

interface UnifiedViewCallbacks {
  onElaborationAccept: (id: string, editedContent: string) => Promise<void>
  onElaborationReject: (id: string) => Promise<void>
  onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>
  onEnrichmentReject: (id: string) => Promise<void>
}

class UnifiedProposalView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: UnifiedViewCallbacks)
  setItems(items: UnifiedItem[]): void
  getViewType(): string   // 'auto-notes-proposals'
  getDisplayText(): string // 'Auto Notes Proposals'
  getIcon(): string        // 'sparkles'
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE`, `UnifiedItem`, `UnifiedViewCallbacks` | Combined proposal sidebar |

## Three Rendering Modes

1. **List mode**: Groups all pending proposals by source note path. Each card shows badge (Elaboration/Enrichment), reasons/summary, preview, and action buttons (Review/Accept/Reject).

2. **Elaboration review**: Back button, source note link, detection reasons, editable textarea for proposed additions. Accept sends edited content.

3. **Enrichment review**: Back button, source note link, per-item checkboxes for tags/links/refs/frontmatter. Accept Selected/All/None/Reject buttons.

## Wiring (in main.ts)

```ts
this.registerView(UNIFIED_VIEW_TYPE, (leaf) => {
  return new UnifiedProposalView(leaf, {
    onElaborationAccept: (id, content) => this.elaboration.acceptProposal(id, content),
    onElaborationReject: (id) => this.elaboration.rejectProposal(id),
    onEnrichmentAcceptSelected: (id, accepted) => this.enrichment.acceptSelectedFromView(id, accepted),
    onEnrichmentReject: (id) => this.enrichment.rejectFromView(id),
  });
});
```

Refreshed via `main.refreshUnifiedView()` which gathers items from both modules.

## Dependencies

| Import | From |
|--------|------|
| `Proposal` | `../elaboration` (type only) |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` (type only) |

## Features

- Clickable note headings open the source note in main editor
- Auto-exits review mode if reviewed proposal is no longer in pending list
- Injects scoped CSS on first open (id: `auto-notes-unified-view-styles`)
- Color-coded cards: blue accent for elaboration, green for enrichment
