---
last-updated: 2026-06-25
---

# Views Module

Two Obsidian sidebar `ItemView`s — `UnifiedProposalView` (proposal review with checkpoint recovery and bulk accept/reject) and `SynapseActionsView` (registry-driven touch-friendly command palette) — plus the semantic color-token system and BEM class helpers shared by both.

## Public API

Exported from `index.ts` (re-export barrel; see `index.ts:L1-L23`).

```ts
// unified-proposal-view.ts
const UNIFIED_VIEW_TYPE = 'synapse-proposals'

class UnifiedProposalView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    callbacks: UnifiedViewCallbacks,
    notifications: NotificationManager,   // required 3rd arg; surfaces bulk-op errors
  )
  setItems(items: UnifiedItem[]): void           // replace list; exits stale review mode
  setCheckpoints(checkpoints: Checkpoint[]): void // banner data for interrupted ops
  getViewType(): string    // 'synapse-proposals'
  getDisplayText(): string // 'Synapse Proposals'
  getIcon(): string        // 'synapse'  (brand S-Signal mark; not 'sparkles')
}

// synapse-actions-view.ts
const SYNAPSE_ACTIONS_VIEW_TYPE = 'synapse-actions'

interface SynapseActionsCallbacks {
  getActions: () => CommandDefinition[]   // palette commands in registry order
  runAction: (id: string) => void         // invoke command by registry id
  isNoteActive: () => boolean             // gates context:'note' buttons
}

class SynapseActionsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: SynapseActionsCallbacks)
  getViewType(): string    // 'synapse-actions'
  getDisplayText(): string // 'Synapse actions'
  getIcon(): string        // 'synapse-actions'  (bespoke launcher mark; addIcon)
  refresh(): void          // re-render; called by main.ts on active-leaf-change
}

// types.ts
const PROPOSAL_KINDS = [
  'elaboration', 'enrichment', 'organize', 'deep-dive', 'title', 'rem',
] as const

type ProposalKind = (typeof PROPOSAL_KINDS)[number]

type UnifiedItem =
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment';  data: EnrichmentProposal }
  | { kind: 'organize';    data: OrganizeProposal }
  | { kind: 'deep-dive';   data: DeepDiveProposal }
  | { kind: 'title';       data: TitleProposal }
  | { kind: 'rem';         data: RemProposal }

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
const SYNAPSE_COLOR_TOKENS: Record<ProposalKind, string>  // 'elaboration' -> '--synapse-color-elaboration'
const FEATURE_COLOR_TOKENS: Record<FeatureKey, string>    // superset minus 'title'; adds main/summarize/tidy/video

function cardClass(kind: ProposalKind): string             // 'synapse-card--<kind>'
function badgeClass(kind: ProposalKind): string            // 'synapse-badge--<kind>'
function reviewPaneLabelClass(kind: ProposalKind): string  // 'synapse-review-pane-label--<kind>'
function actionsGroupClass(feature: FeatureKey): string    // 'synapse-actions-group--<feature>'
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE` (re-exports `UnifiedItem`, `UnifiedViewCallbacks` types) | Combined proposal sidebar: checkpoint banner, list, per-kind review, bulk ops |
| `synapse-actions-view.ts` | `SynapseActionsView`, `SYNAPSE_ACTIONS_VIEW_TYPE`, `SynapseActionsCallbacks` | Registry-driven touch-friendly command palette sidebar |
| `types.ts` | `PROPOSAL_KINDS`, `ProposalKind`, `UnifiedItem`, `UnifiedViewCallbacks` | View type defs; compile-time guard binds `PROPOSAL_KINDS` to `UnifiedItem['kind']` |
| `proposal-styles.ts` | `SYNAPSE_COLOR_TOKENS`, `FEATURE_COLOR_TOKENS`, `cardClass`, `badgeClass`, `reviewPaneLabelClass`, `actionsGroupClass` | Semantic color tokens + BEM class helpers |
| `index.ts` | barrel re-export of all the above | Public surface |
| `*.test.ts` (3 files) | tests | `unified-proposal-view`, `synapse-actions-view`, `proposal-styles` |

No legacy views exist in this directory; only the two registered `ItemView`s above. A legacy `ProposalReviewView` still lives in `src/elaboration/proposal-view.ts` (outside this module) and is not registered.

## View Registry

| View type id | Class | getIcon | getDisplayText | Source |
|--------------|-------|---------|----------------|--------|
| `synapse-proposals` | `UnifiedProposalView` | `synapse` | `Synapse Proposals` | `unified-proposal-view.ts:L15` |
| `synapse-actions` | `SynapseActionsView` | `synapse-actions` | `Synapse actions` | `synapse-actions-view.ts:L6` |

## Compile-Time Guards

`types.ts:L43-L48` asserts `PROPOSAL_KINDS` equals `UnifiedItem['kind']` in both directions via two distinct `const _x: true` assertions (`_AssertKindsCoverUnion`, `_AssertUnionCoversKinds`). Adding a kind to only one side fails the build.

`proposal-styles.ts:L15` types `SYNAPSE_COLOR_TOKENS` as `Record<ProposalKind, string>`; `proposal-styles.ts:L34` types `FEATURE_COLOR_TOKENS` as `Record<FeatureKey, string>`. Build fails if a kind/feature lacks a `--synapse-color-*` token. CSS custom properties are authoritative in `styles.css`; these maps are only the exhaustiveness guard, not the color values.

## Color Tokens

| Proposal kind | CSS token | Feature-only keys (no proposal kind) | CSS token |
|---------------|-----------|--------------------------------------|-----------|
| elaboration | `--synapse-color-elaboration` | main | `--synapse-color-main` |
| enrichment | `--synapse-color-enrichment` | summarize | `--synapse-color-summarize` |
| organize | `--synapse-color-organize` | tidy | `--synapse-color-tidy` |
| deep-dive | `--synapse-color-deep-dive` | video | `--synapse-color-video` |
| title | `--synapse-color-title` | | |
| rem | `--synapse-color-rem` | | |

`FEATURE_COLOR_TOKENS` covers all `FeatureKey` values (the proposal kinds minus `title`, plus `main`/`summarize`/`tidy`/`video`) for the actions sidebar, which groups by `FeatureKey` rather than `ProposalKind`.

## Rendering Modes (UnifiedProposalView)

`render()` (`unified-proposal-view.ts:L129`) dispatches on whichever `reviewing*` field is set, else list mode.

1. Checkpoint banner: one card per incomplete checkpoint with operation label, done/total progress bar, Resume/Discard.
2. List mode: pending proposals grouped by `data.sourceNotePath`; Accept all / Reject all bar shown when 2+ pending; each card has a badge, summary, preview, and Review/Accept/Reject.
3. Elaboration review: editable textarea; Accept sends edited content.
4. Enrichment review: per-item checkboxes (tags / internalLinks / externalLinks / frontmatter); Accept selected / All / None / Reject.
5. Organize review: proposed directory + reasoning; Accept/Reject.
6. Deep-dive review: title, depth + quality badges, proposed path, read-only content preview, cascade warning when `childProposalIds.length > 0`; Accept/Reject.
7. Title review: current vs proposed title, trigger (`untitled` | `mismatch`), reasoning; Accept (rename)/Reject.
8. REM review: per-candidate checkboxes with match-type badge (`title`/`alias`/`semantic`, semantic shows confidence %); Accept selected / All / None / Reject.

## Bulk Operations (UnifiedProposalView)

| Op | Method | Trigger | Behavior |
|----|--------|---------|----------|
| Accept all | `acceptAll()` `:L190` | "Accept all" button, 2+ pending | Sequential over snapshot; per-kind accept-all; stops on first error |
| Reject all | `rejectAll()` `:L296` | "Reject all" button, 2+ pending | Sequential over snapshot; stops on first error |

Sequential because organize accepts may move files. Mutually exclusive via `acceptAllInProgress` / `rejectAllInProgress`; buttons disabled while either runs. Enrichment accept-all selects all tags/links/refs/frontmatter; REM accept-all selects all `candidates[].matchedText`.

## Data Flow

Input: `main.refreshUnifiedView()` gathers pending proposals from the six feature modules into `UnifiedItem[]` and incomplete checkpoints, then calls `setItems()` / `setCheckpoints()`.

Processing: view stores items, re-renders. User clicks invoke `UnifiedViewCallbacks` (proposal accept/reject) or `SynapseActionsCallbacks.runAction` (command dispatch). The view holds no proposal store and never touches `app`/vault for state — only `openNote()` opens files in the editor.

Output: callbacks return `Promise<void>`; modules mutate the vault/proposal store and re-trigger `refreshUnifiedView()`. `SynapseActionsView.refresh()` re-renders on `active-leaf-change` to enable/disable `context:'note'` buttons.

## Wiring (main.ts)

`main.ts:L157-L174` registers `UNIFIED_VIEW_TYPE` with the third `notifications` arg:

```ts
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
  onRemAcceptSelected: (id, texts) => this.rem.acceptProposal(id, texts),
  onRemReject: (id) => this.rem.rejectProposal(id),
  onCheckpointDiscard: (id) => this.discardCheckpoint(id),
  onCheckpointResume: (id) => this.resumeCheckpoint(id),
}, this.notifications);
```

`main.ts:L182-L186` registers `SYNAPSE_ACTIONS_VIEW_TYPE`:

```ts
new SynapseActionsView(leaf, {
  getActions: () => listPaletteActions(registrar.getRegistered()),
  runAction: (id) => this.runCommand(id),
  isNoteActive: () => this.activeMarkdownFile() !== null,
});
```

## Dependencies

| Import | From | Kind |
|--------|------|------|
| `Proposal` | `../elaboration` | type only |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` | type only |
| `OrganizeProposal` | `../organize` | type only |
| `DeepDiveProposal` | `../deep-dive` | type only |
| `TitleProposal` | `../title` | type only |
| `RemProposal` | `../rem` | type only |
| `Checkpoint`, `NotificationManager` | `../shared` | type only |
| `fireAndForget` | `../shared` | runtime value |
| `CommandDefinition`, `FeatureKey` | `../commands` | type only |
| `FEATURE_ICONS` | `../commands` | runtime value (`synapse-actions-view.ts`) |

The six proposal feature modules are imported as TYPES ONLY (no runtime feature-module code in the view layer). Runtime imports are limited to `fireAndForget` (shared) and `FEATURE_ICONS` (commands).

## Error States

- Individual Accept/Reject: handlers run via `onClick()`/`fireAndForget` (`:L158`), so a rejected promise is surfaced to the user instead of failing silently.
- Bulk Accept all / Reject all: on first failure the loop stops, sets the in-progress flag false, and calls `notifications.error(...)` with the failing item label, the error message, and a `X/total accepted, N remaining` summary (`:L207-L217`, `:L313-L323`). Already-applied items are not rolled back.
- `setItems()` exits any active review mode whose proposal id is no longer pending (`:L90-L125`).
- `openNote()` no-ops when the path resolves to no file (`:L165-L171`).
- `SynapseActionsView`: empty `getActions()` renders an "enable features in settings" message (`:L88-L94`); `context:'note'` buttons are `disabled` with `aria-disabled` and no click handler when no note is active (`:L114-L126`).
