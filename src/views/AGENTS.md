---
last-updated: 2026-03-16
---

# Views Module

Unified sidebar view combining elaboration, enrichment, organize, and deep-dive proposals in a single pane.

## Public API

Exported from `unified-proposal-view.ts`:

```ts
const UNIFIED_VIEW_TYPE = 'auto-notes-proposals'

type UnifiedItem =
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment'; data: EnrichmentProposal }
  | { kind: 'organize'; data: OrganizeProposal }
  | { kind: 'deep-dive'; data: DeepDiveProposal }

interface UnifiedViewCallbacks {
  onElaborationAccept: (id: string, editedContent: string) => Promise<void>
  onElaborationReject: (id: string) => Promise<void>
  onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>
  onEnrichmentReject: (id: string) => Promise<void>
  onOrganizeAccept: (id: string) => Promise<void>
  onOrganizeReject: (id: string) => Promise<void>
  onDeepDiveAccept: (id: string) => Promise<void>
  onDeepDiveReject: (id: string) => Promise<void>
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

## Five Rendering Modes

1. **List mode**: Groups all pending proposals by source note path. Each card shows badge, reasons/summary, preview, and action buttons (Review/Accept/Reject).

2. **Elaboration review**: Back button, source note link, detection reasons, editable textarea for proposed additions. Accept sends edited content.

3. **Enrichment review**: Back button, source note link, per-item checkboxes for tags/links/refs/frontmatter. Accept Selected/All/None/Reject buttons.

4. **Organize review**: Back button, source note link, proposed directory path, AI reasoning text. Accept/Reject buttons.

5. **Deep-dive review**: Back button, topic title, depth badge, quality score, source note link, quality reasoning, proposed path, read-only content preview, child count warning. Accept/Reject buttons.

## Card Types

| Kind | Badge Color | Border Color |
|------|------------|--------------|
| elaboration | `interactive-accent` (blue) | `interactive-accent` |
| enrichment | `color-green` | `color-green` |
| organize | `color-orange` | `color-orange` |
| deep-dive | `color-purple` | `color-purple` |

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
  });
});
```

Refreshed via `main.refreshUnifiedView()` which gathers items from all four modules.

## Dependencies

| Import | From |
|--------|------|
| `Proposal` | `../elaboration` (type only) |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` (type only) |
| `OrganizeProposal` | `../organize` (type only) |
| `DeepDiveProposal` | `../deep-dive` (type only) |

## Features

- Clickable note headings open the source note in main editor
- Auto-exits review mode if reviewed proposal is no longer in pending list
- Injects scoped CSS on first open (id: `auto-notes-unified-view-styles`)
- Color-coded cards: blue for elaboration, green for enrichment, orange for organize, purple for deep-dive
