---
last-updated: 2026-06-19
---

# Views Module

Two Obsidian sidebar views: `UnifiedProposalView` (proposal review with checkpoint recovery) and `SynapseActionsView` (touch-friendly command palette). Also exports the semantic color token system and BEM class helpers used by both views.

## Public API

Exported from `index.ts`:

```ts
// unified-proposal-view.ts
const UNIFIED_VIEW_TYPE = 'synapse-proposals'

class UnifiedProposalView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: UnifiedViewCallbacks)
  setItems(items: UnifiedItem[]): void
  setCheckpoints(checkpoints: Checkpoint[]): void
  getViewType(): string    // 'synapse-proposals'
  getDisplayText(): string // 'Synapse Proposals'
  getIcon(): string        // 'synapse'  (brand S-Signal mark, not 'sparkles')
}

// synapse-actions-view.ts
const SYNAPSE_ACTIONS_VIEW_TYPE = 'synapse-actions'

interface SynapseActionsCallbacks {
  getActions: () => CommandDefinition[]
  runAction: (id: string) => void
  isNoteActive: () => boolean
}

class SynapseActionsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: SynapseActionsCallbacks)
  getViewType(): string    // 'synapse-actions'
  getDisplayText(): string // 'Synapse actions'
  getIcon(): string        // 'layout-grid'
  refresh(): void          // re-render; called by main.ts on active-leaf-change
}

// types.ts
const PROPOSAL_KINDS = [
  'elaboration', 'enrichment', 'organize', 'deep-dive', 'title', 'rem',
] as const

type ProposalKind = (typeof PROPOSAL_KINDS)[number]

type UnifiedItem =
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment'; data: EnrichmentProposal }
  | { kind: 'organize'; data: OrganizeProposal }
  | { kind: 'deep-dive'; data: DeepDiveProposal }
  | { kind: 'title'; data: TitleProposal }
  | { kind: 'rem'; data: RemProposal }

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
  onRemAcceptSelected: (id: string, acceptedMatchTexts: string[]) => Promise<void>
  onRemReject: (id: string) => Promise<void>
  onCheckpointDiscard: (id: string) => Promise<void>
  onCheckpointResume: (id: string) => Promise<void>
}

// proposal-styles.ts
const SYNAPSE_COLOR_TOKENS: Record<ProposalKind, string>   // e.g. 'elaboration' -> '--synapse-color-elaboration'
const FEATURE_COLOR_TOKENS: Record<FeatureKey, string>     // superset; covers main/summarize/tidy/video too

function cardClass(kind: ProposalKind): string             // 'synapse-card--<kind>'
function badgeClass(kind: ProposalKind): string            // 'synapse-badge--<kind>'
function reviewPaneLabelClass(kind: ProposalKind): string  // 'synapse-review-pane-label--<kind>'
function actionsGroupClass(feature: FeatureKey): string    // 'synapse-actions-group--<feature>'
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE` | Combined proposal sidebar with checkpoint banner |
| `synapse-actions-view.ts` | `SynapseActionsView`, `SYNAPSE_ACTIONS_VIEW_TYPE`, `SynapseActionsCallbacks` | Touch-friendly command palette sidebar |
| `types.ts` | `UnifiedItem`, `UnifiedViewCallbacks`, `ProposalKind`, `PROPOSAL_KINDS` | View type definitions; compile-time guard asserts `PROPOSAL_KINDS` matches `UnifiedItem['kind']` |
| `proposal-styles.ts` | `SYNAPSE_COLOR_TOKENS`, `FEATURE_COLOR_TOKENS`, `cardClass`, `badgeClass`, `reviewPaneLabelClass`, `actionsGroupClass` | Semantic color tokens + BEM class helpers (#342) |
| `index.ts` | re-exports all of the above | Barrel |
| `unified-proposal-view.test.ts`, `synapse-actions-view.test.ts`, `proposal-styles.test.ts` | Tests | |

## Compile-Time Guards

`types.ts:L43-L46` asserts `PROPOSAL_KINDS` exactly covers `UnifiedItem['kind']` in both directions via two
typed `const` assertions. Build fails if a new proposal kind is added to only one.

`proposal-styles.ts:L15` types `SYNAPSE_COLOR_TOKENS` as `Record<ProposalKind, string>` — build fails if a
kind lacks a CSS token. `FEATURE_COLOR_TOKENS` does the same for `FeatureKey`.

## Rendering Modes (UnifiedProposalView)

1. Checkpoint banner: incomplete checkpoints → banner per checkpoint with module label, progress (done/total), Resume/Discard buttons.
2. List mode: all pending proposals grouped by source note path. Accept All button when 2+ proposals. Each card shows badge, reasons/summary, preview, and action buttons (Review/Accept/Reject).
3. Elaboration review: editable textarea for proposed additions; Accept sends edited content.
4. Enrichment review: per-item checkboxes for tags/links/refs/frontmatter; Accept Selected/All/None/Reject.
5. Organize review: proposed directory path + AI reasoning; Accept/Reject.
6. Deep-dive review: topic title, depth badge, quality score, proposed path, read-only content preview, child count warning; Accept/Reject.
7. Title review: current vs proposed title, trigger reason, AI reasoning; Accept (rename)/Reject.
8. REM review: per-match checkboxes for link suggestions; Accept Selected/Reject.

## Card Types

| Kind | CSS token |
|------|-----------|
| elaboration | `--synapse-color-elaboration` |
| enrichment | `--synapse-color-enrichment` |
| organize | `--synapse-color-organize` |
| deep-dive | `--synapse-color-deep-dive` |
| title | `--synapse-color-title` |
| rem | `--synapse-color-rem` |

CSS custom properties declared in `styles.css` (`.theme-light, .theme-dark` block). TypeScript tokens in
`proposal-styles.ts` are the exhaustiveness guard — they are NOT the authoritative color values.

## Accept All (UnifiedProposalView)

- Available when 2+ proposals pending.
- Processes sequentially (organize proposals may affect file paths).
- Shows progress bar during batch; stops on first failure.
- Enrichment: accepts all suggested items (tags + links + refs + frontmatter).
- REM: accepts all suggested match texts.

## Wiring (in main.ts)

```ts
this.registerView(UNIFIED_VIEW_TYPE, (leaf) =>
  new UnifiedProposalView(leaf, {
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
    onRemAcceptSelected: (id, texts) => this.rem.acceptSelectedFromView(id, texts),
    onRemReject: (id) => this.rem.rejectFromView(id),
    onCheckpointDiscard: (id) => this.discardCheckpoint(id),
    onCheckpointResume: (id) => this.resumeCheckpoint(id),
  })
);

this.registerView(SYNAPSE_ACTIONS_VIEW_TYPE, (leaf) =>
  new SynapseActionsView(leaf, {
    getActions: () => this.commands.listPaletteActions(),
    runAction: (id) => (this.app as any).commands.executeCommandById(id),
    isNoteActive: () => this.app.workspace.getActiveViewOfType(MarkdownView) !== null,
  })
);
```

Refreshed via `main.refreshUnifiedView()` which gathers items from all six modules plus incomplete checkpoints.
`SynapseActionsView.refresh()` called on `active-leaf-change` to enable/disable per-note buttons.

## Dependencies

| Import | From |
|--------|------|
| `Proposal` | `../elaboration` (type only) |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` (type only) |
| `OrganizeProposal` | `../organize` (type only) |
| `DeepDiveProposal` | `../deep-dive` (type only) |
| `TitleProposal` | `../title` (type only) |
| `RemProposal` | `../rem` (type only) |
| `Checkpoint`, `fireAndForget` | `../shared` |
| `CommandDefinition`, `FeatureKey` | `../commands` (type only, in synapse-actions-view.ts) |

`unified-proposal-view.ts` imports TYPES ONLY from feature modules (no runtime feature-module code in the view layer).
