---
last-updated: 2026-10-09
---

# Views Module

Two Obsidian sidebar `ItemView`s — `UnifiedProposalView` (proposal review with checkpoint recovery and bulk accept/reject) and `SynapseActionsView` (registry-driven touch-friendly command palette) — plus their sidebar activation/refresh helpers, the actions-sidebar command dispatcher, and the semantic color-token system and BEM class helpers shared by both.

## Public API

Exported from `index.ts` (re-export barrel; `index.ts:1-30`).

```ts
// unified-proposal-view.ts
const UNIFIED_VIEW_TYPE = 'synapse-proposals'   // unified-proposal-view.ts:16

class UnifiedProposalView extends ItemView {     // unified-proposal-view.ts:25
  constructor(
    leaf: WorkspaceLeaf,
    callbacks: UnifiedViewCallbacks,
    notifications: NotificationManager,   // required 3rd arg; surfaces bulk-op errors
  )
  setItems(items: UnifiedItem[]): void           // :90 replace list; exits stale review mode
  setCheckpoints(checkpoints: Checkpoint[]): void // :85 banner data for interrupted ops
  getViewType(): string    // 'synapse-proposals'
  getDisplayText(): string // 'Synapse proposals'
  getIcon(): string        // 'synapse' (:74)
}

// synapse-actions-view.ts
const SYNAPSE_ACTIONS_VIEW_TYPE = 'synapse-actions'   // synapse-actions-view.ts:6

interface SynapseActionsCallbacks {
  getActions: () => CommandDefinition[]   // palette commands in registry order
  runAction: (id: string) => void         // invoke command by registry id
  isNoteActive: () => boolean             // gates context:'note' buttons
}

class SynapseActionsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, callbacks: SynapseActionsCallbacks)
  getViewType(): string    // 'synapse-actions'
  getDisplayText(): string // 'Synapse actions'
  getIcon(): string        // 'synapse-actions' (:67)
  refresh(): void          // re-render; called by main.ts on active-leaf-change
}

// types.ts:17
const PROPOSAL_KINDS = [
  'elaboration', 'enrichment', 'organize', 'deep-dive', 'title', 'rem', 'illustrate',
] as const

type ProposalKind = (typeof PROPOSAL_KINDS)[number]   // types.ts:38

type UnifiedItem =                                     // types.ts:28
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment';  data: EnrichmentProposal }
  | { kind: 'organize';    data: OrganizeProposal }
  | { kind: 'deep-dive';   data: DeepDiveProposal }
  | { kind: 'title';       data: TitleProposal }
  | { kind: 'rem';         data: RemProposal }
  | { kind: 'illustrate';  data: IllustrateProposal }

interface UnifiedViewCallbacks {                       // types.ts:53
  onElaborationAccept: (id: string, editedContent: string) => Promise<void>
  onElaborationReject: (id: string) => Promise<void>
  onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>
  onEnrichmentReject: (id: string) => Promise<void>
  onOrganizeAccept: (id: string) => Promise<void>
  onOrganizeReject: (id: string) => Promise<void>
  onDeepDiveAccept: (id: string) => Promise<void>
  onDeepDiveReject: (id: string) => Promise<void>
  onTitleAccept: (id: string, resolution?: TitleDuplicateStrategy) => Promise<void>
  onTitleReject: (id: string) => Promise<void>
  onRemAcceptSelected: (id: string, acceptedMatchTexts: string[]) => Promise<void>
  onRemReject: (id: string) => Promise<void>
  onIllustrateAcceptSelected: (id: string, acceptedItemIds: string[]) => Promise<void>   // types.ts:74
  onIllustrateReject: (id: string) => Promise<void>
  onCheckpointDiscard: (id: string) => Promise<void>
  onCheckpointResume: (id: string) => Promise<void>
}

// proposal-styles.ts
const SYNAPSE_COLOR_TOKENS: Record<ProposalKind, string>  // :15 'elaboration' -> '--synapse-color-elaboration'
const FEATURE_COLOR_TOKENS: Record<FeatureKey, string>    // :35 proposal kinds minus 'title'; adds main/summarize/tidy/video

function cardClass(kind: ProposalKind): string             // 'synapse-card--<kind>'
function badgeClass(kind: ProposalKind): string            // 'synapse-badge--<kind>'
function reviewPaneLabelClass(kind: ProposalKind): string  // 'synapse-review-pane-label--<kind>'
function actionsGroupClass(feature: FeatureKey): string    // 'synapse-actions-group--<feature>'

// view-activation.ts:16 — one pending-proposal reader per kind + the checkpoint banner source
interface UnifiedViewSources {
  elaboration: () => Promise<Proposal[]>
  enrichment: () => Promise<EnrichmentProposal[]>
  organize: () => Promise<OrganizeProposal[]>
  'deep-dive': () => Promise<DeepDiveProposal[]>
  title: () => Promise<TitleProposal[]>
  rem: () => Promise<RemProposal[]>
  illustrate: () => Promise<IllustrateProposal[]>
  checkpoints: () => Promise<Checkpoint[]>
}
// view-activation.ts:40 — reveal (create in right sidebar if needed) then refreshUnifiedView; no-op when no right leaf
function activateUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void>
// view-activation.ts:46
function activateSynapseActionsView(workspace: Workspace): Promise<void>
// view-activation.ts:63 — setItems/setCheckpoints on every open unified leaf (deferred leaves loaded first, duck-typed); no-op when none open
function refreshUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void>

// command-runner.ts:8 — active file iff extension === 'md' (survives the actions sidebar stealing focus)
function activeMarkdownFile(app: App): TFile | null
// command-runner.ts:26 — context:'note': invoke the registered command's editorCallback(view.editor, view) directly with the active file's MarkdownView (no setActiveLeaf/focus change; rejection -> fireAndForget), or notice when no note is active; everything else (and unresolvable note handlers) -> executeCommandById(`${pluginId}:${id}`) (#352)
function runRegisteredCommand(app: App, pluginId: string, id: string, notifications: NotificationManager): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE` (re-exports `UnifiedItem`, `UnifiedViewCallbacks` types) | Combined proposal sidebar: checkpoint banner, list, per-kind review, bulk ops; module-private `organizeTargetLabel` (`:1565`) |
| `synapse-actions-view.ts` | `SynapseActionsView`, `SYNAPSE_ACTIONS_VIEW_TYPE`, `SynapseActionsCallbacks` | Registry-driven touch-friendly command palette sidebar |
| `types.ts` | `PROPOSAL_KINDS`, `ProposalKind`, `UnifiedItem`, `UnifiedViewCallbacks` | View type defs; compile-time guard binds `PROPOSAL_KINDS` to `UnifiedItem['kind']` |
| `proposal-styles.ts` | `SYNAPSE_COLOR_TOKENS`, `FEATURE_COLOR_TOKENS`, `cardClass`, `badgeClass`, `reviewPaneLabelClass`, `actionsGroupClass` | Semantic color tokens + BEM class helpers |
| `view-activation.ts` | `activateUnifiedView`, `activateSynapseActionsView`, `refreshUnifiedView`, `UnifiedViewSources` | Sidebar reveal/create (private `revealSidebarView`, `:28`) + unified-view data push |
| `command-runner.ts` | `activeMarkdownFile`, `runRegisteredCommand` | Actions-sidebar dispatch: direct `editorCallback` invocation for `context: 'note'` commands, Obsidian `executeCommandById` otherwise |
| `index.ts` | barrel re-export of all the above | Public surface |
| `*.test.ts` (5 files) | tests | `unified-proposal-view` (incl. describe `UnifiedProposalView elaboration rewrite copy (#552)`, `unified-proposal-view.test.ts:418`), `synapse-actions-view`, `proposal-styles`, `view-activation`, `command-runner` |

No legacy views exist in this directory; only the two registered `ItemView`s above. A legacy `ProposalReviewView` still lives in `src/elaboration/proposal-view.ts` (outside this module) and is not registered.

## View Registry

| View type id | Class | getIcon | getDisplayText | Source |
|--------------|-------|---------|----------------|--------|
| `synapse-proposals` | `UnifiedProposalView` | `synapse` | `Synapse proposals` | `unified-proposal-view.ts:16` |
| `synapse-actions` | `SynapseActionsView` | `synapse-actions` | `Synapse actions` | `synapse-actions-view.ts:6` |

## Compile-Time Guards

`types.ts:46-49` asserts `PROPOSAL_KINDS` equals `UnifiedItem['kind']` in both directions via two distinct `const _x: true` assertions (`_AssertKindsCoverUnion`, `_AssertUnionCoversKinds`). Adding a kind to only one side fails the build.

`proposal-styles.ts:15` types `SYNAPSE_COLOR_TOKENS` as `Record<ProposalKind, string>`; `proposal-styles.ts:35` types `FEATURE_COLOR_TOKENS` as `Record<FeatureKey, string>`. Build fails if a kind/feature lacks a `--synapse-color-*` token. CSS custom properties are authoritative in `styles.css`; these maps are only the exhaustiveness guard, not the color values.

## Color Tokens

| Proposal kind | CSS token | Feature-only keys (no proposal kind) | CSS token |
|---------------|-----------|--------------------------------------|-----------|
| elaboration | `--synapse-color-elaboration` | main | `--synapse-color-main` |
| enrichment | `--synapse-color-enrichment` | summarize | `--synapse-color-summarize` |
| organize | `--synapse-color-organize` | tidy | `--synapse-color-tidy` |
| deep-dive | `--synapse-color-deep-dive` | video | `--synapse-color-video` |
| title | `--synapse-color-title` | | |
| rem | `--synapse-color-rem` | | |
| illustrate | `--synapse-color-illustrate` | | |

`FEATURE_COLOR_TOKENS` covers all `FeatureKey` values (the proposal kinds minus `title`, plus `main`/`summarize`/`tidy`/`video`) for the actions sidebar, which groups by `FeatureKey` rather than `ProposalKind`.

## Rendering Modes (UnifiedProposalView)

`render()` (`unified-proposal-view.ts:138`) dispatches on whichever `reviewing*` field is set (elaboration, enrichment, organize, deep-dive, title, rem, illustrate), else list mode.

1. Checkpoint banner (`renderCheckpointBanner` `:1495`): one card per incomplete checkpoint with operation label, done/total progress bar, Resume/Discard. Progress fills (`.synapse-checkpoint-fill`, `:1517`; `.synapse-accept-all-fill`, `:394`) set the `--synapse-fill` custom property via `setCssProps`, and `styles.css` reads it as `width: var(--synapse-fill, 0%)` — no inline `style.width`.
2. List mode (`renderList` `:400`): pending proposals grouped by `data.sourceNotePath`; Accept all / Reject all bar shown when 2+ pending; each card has a badge, summary, preview, and Review/Accept/Reject. Elaboration card (`renderElaborationCard` `:485`, #552): preview text is prefixed `Replaces the note's content with: ` (`:500`); accept button reads `Accept and replace` (`:512`) and sends `proposal.proposedAdditions` to `onElaborationAccept` (`:515`). Organize card (`:588`): headline `organizeTargetLabel(proposal)` (`:599`) = `Move to <dir>` when `proposalKind === 'move'`, else `New folder <dir>` (`:1565-1569`); `Decided by the System 1 lane` line when `proposal.lane === 'system-one'` (`:602-603`). REM card (`:1164`): `Semantic links decided by the System 1 lane` when `proposal.lane === 'system-one'` (`:1187-1188`). Illustrate card (`renderIllustrateCard` `:1350`): summary `N visual(s) | <counts per kind>` (`illustrateSummary` `:1341`), preview = first 3 captions; `Accept all` sends every item id to `onIllustrateAcceptSelected`.
3. Elaboration review (`renderElaborationReview` `:629`, #552): editable textarea labelled `Proposed rewrite (accepting replaces the note's content; frontmatter is kept)` (`:659`); `Accept and replace` (`:668`) sends the edited full body to `onElaborationAccept(id, textarea.value)` (`:672`).
4. Enrichment review (`:695`): per-item checkboxes (tags / internalLinks / externalLinks / frontmatter); Accept selected / All / None / Reject.
5. Organize review (`renderOrganizeReview` `:798`): pane label `Move to existing folder` (`proposalKind === 'move'`) or `New folder` (`:821`), proposed directory, `Decided by the System 1 lane` when lane is `system-one` (`:828-829`), reasoning; Accept/Reject.
6. Deep-dive review (`:908`): title, depth + quality badges, proposed path, read-only content preview, cascade warning when `childProposalIds.length > 0`; Accept/Reject.
7. Title review (`:1065`): current vs proposed title, trigger (`untitled` | `content-mismatch`), reasoning. No collision: single Accept (rename)/Reject. Collision (`data.conflictsWith` set, #414): a "Conflict" badge + callout (`describeConflict()` `:992`) name the existing note/folder, and Accept is replaced by "Add suffix" (`onTitleAccept(id, 'iterate')`) and "Merge into existing" (`onTitleAccept(id, 'merge')`) (#408); the same badge/callout/split-buttons also render on the title list card.
8. REM review (`:1229`): per-candidate checkboxes with match-type badge (`title`/`alias`/`semantic`, semantic shows confidence %); per-candidate `System 1 lane` tag when `candidate.lane === 'system-one'` (`:1271-1272`); Accept selected / All / None / Reject.
9. Illustrate review (`renderIllustrateReview` `:1395`): per-item checkbox (all selected on entry, `enterIllustrateReview` `:1389`), placement label `describeInsertion(item.placement)` or `Placement resolved on accept` (`:1422`), kind badge `synapse-badge--illustrate-<kind>`, caption; photo items show the remote thumbnail + `title — license — attribution (provider)` (nothing downloaded during review), diagram/chart items show the Mermaid source in a `pre`; Accept selected / All / None / Reject.

## Bulk Operations (UnifiedProposalView)

| Op | Method | Trigger | Behavior |
|----|--------|---------|----------|
| Accept all | `acceptAll()` `:202` (per item `acceptSingleItem` `:242`) | "Accept all" button, 2+ pending | Sequential over snapshot; per-kind accept-all; stops on first error |
| Reject all | `rejectAll()` `:313` (per item `rejectSingleItem` `:349`) | "Reject all" button, 2+ pending | Sequential over snapshot; stops on first error |

Sequential because organize accepts may move files. Mutually exclusive via `acceptAllInProgress` / `rejectAllInProgress`; buttons disabled while either runs. Enrichment accept-all selects all tags/links/refs/frontmatter; REM accept-all selects all `candidates[].matchedText`; illustrate accept-all selects every `items[].id` (`:276`).

## Data Flow

Input: `refreshUnifiedView(workspace, sources)` (`view-activation.ts:63`) reads every `UnifiedViewSources` reader into `UnifiedItem[]` plus incomplete checkpoints, then calls `setItems()` / `setCheckpoints()` on each open unified leaf. The `UnifiedViewSources` instance is built in `main.ts:110-119` (seven `getPendingProposals()` readers + `checkpointManager.listIncomplete()`).

Processing: view stores items, re-renders. User clicks invoke `UnifiedViewCallbacks` (proposal accept/reject) or `SynapseActionsCallbacks.runAction` (command dispatch via `runRegisteredCommand`). The view holds no proposal store and never touches `app`/vault for state — only `openNote()` opens files in the editor.

Output: callbacks return `Promise<void>`; modules mutate the vault/proposal store and re-trigger `refreshUnifiedView` through their `onViewRefreshNeeded` slot (`main.ts:178-181`). `SynapseActionsView.refresh()` re-renders on `active-leaf-change` to enable/disable `context:'note'` buttons.

## Wiring (main.ts)

`main.ts:146-164` registers `UNIFIED_VIEW_TYPE` with the third `notifications` arg; the checkpoint callbacks delegate to `CheckpointRecoveryModule.discard/resume` (`src/checkpoints`). Modules are locals destructured from the registry's `FeatureModules` record (`main.ts:82`):

```ts
new UnifiedProposalView(leaf, {
  onElaborationAccept: (id, content) => elaboration.acceptProposal(id, content),
  onElaborationReject: (id) => elaboration.rejectProposal(id),
  onEnrichmentAcceptSelected: (id, accepted) => enrichment.acceptSelectedFromView(id, accepted),
  onEnrichmentReject: (id) => enrichment.rejectFromView(id),
  onOrganizeAccept: (id) => organize.acceptProposal(id),
  onOrganizeReject: (id) => organize.rejectProposal(id),
  onDeepDiveAccept: (id) => deepDive.acceptProposal(id),
  onDeepDiveReject: (id) => deepDive.rejectProposal(id),
  onTitleAccept: (id, resolution) =>
    title.acceptProposal(id, resolution ? { resolution } : undefined).then(() => {}),
  onTitleReject: (id) => title.rejectProposal(id),
  onRemAcceptSelected: (id, texts) => rem.acceptProposal(id, texts),
  onRemReject: (id) => rem.rejectProposal(id),
  onIllustrateAcceptSelected: (id, itemIds) => illustrate.acceptProposal(id, itemIds),
  onIllustrateReject: (id) => illustrate.rejectProposal(id),
  onCheckpointDiscard: (id) => this.checkpoints.discard(id),
  onCheckpointResume: (id) => this.checkpoints.resume(id),
}, this.notifications);
```

`main.ts:167-171` registers `SYNAPSE_ACTIONS_VIEW_TYPE`; `main.ts:172-175` calls `refresh()` on `active-leaf-change`:

```ts
new SynapseActionsView(leaf, {
  getActions: () => listPaletteActions(registrar.getRegistered()),
  runAction: (id) => runRegisteredCommand(this.app, this.manifest.id, id, this.notifications),
  isNoteActive: () => activeMarkdownFile(this.app) !== null,
});
```

Activation entry points: ribbon `synapse` and every module's `onOpenProposalView` slot call `activateUnifiedView` via `openProposalView` (`main.ts:121-122`, `:178-181`, `:215`); command `review-proposals` (`main.ts:221-223`); ribbon `synapse-actions` calls `activateSynapseActionsView` (`main.ts:217-219`).

## Dependencies

| Import | From | Kind |
|--------|------|------|
| `Proposal` | `../elaboration` | type only |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` | type only |
| `OrganizeProposal` | `../organize` | type only |
| `DeepDiveProposal` | `../deep-dive` | type only |
| `TitleProposal`, `TitleDuplicateStrategy` | `../title` | type only |
| `RemProposal` | `../rem` | type only |
| `IllustrateProposal` | `../illustrate` | type only (`types.ts:7`, `unified-proposal-view.ts:8`, `view-activation.ts:10`) |
| `Checkpoint`, `NotificationManager` | `../shared` | type only |
| `fireAndForget` | `../shared` | runtime value (`unified-proposal-view.ts:10`, `view-activation.ts:2`, `command-runner.ts:4`) |
| `describeInsertion` | `../shared` | runtime value (`unified-proposal-view.ts:10`; illustrate placement label) |
| `CommandDefinition`, `FeatureKey` | `../commands` | type only |
| `FEATURE_ICONS` | `../commands` | runtime value (`synapse-actions-view.ts:3`) |
| `REGISTRY_BY_ID` | `../commands` | runtime value (`command-runner.ts:3`) |
| `MarkdownView` | `obsidian` | runtime value (`command-runner.ts:1`) |
| `App`, `Command`, `TFile`, `Workspace`, `WorkspaceLeaf` | `obsidian` | type only (`command-runner.ts:2`, `view-activation.ts:1`) |

The seven proposal feature modules are imported as TYPES ONLY (no runtime feature-module code in the view layer). Runtime imports are limited to `fireAndForget` + `describeInsertion` (shared), `FEATURE_ICONS` + `REGISTRY_BY_ID` (commands), and Obsidian's `ItemView`/`setIcon`/`MarkdownView`.

## Error States

- Individual Accept/Reject: handlers run via `onClick()`/`fireAndForget` (`unified-proposal-view.ts:169`), so a rejected promise is surfaced to the user instead of failing silently.
- Bulk Accept all / Reject all: on first failure the loop stops, sets the in-progress flag false, and calls `notifications.error(...)` with the failing item label, the error message, and a `X/total accepted, N remaining` summary (`unified-proposal-view.ts:223-226`, `:334-337`). Already-applied items are not rolled back.
- `setItems()` exits any active review mode (all seven kinds) whose proposal id is no longer pending (`unified-proposal-view.ts:90-136`).
- `openNote()` no-ops when the path resolves to no file (`unified-proposal-view.ts:176`).
- `SynapseActionsView`: empty `getActions()` renders an "enable features in settings" message (`synapse-actions-view.ts:91`); `context:'note'` buttons are `disabled` with `aria-disabled` and no click handler when no note is active (`synapse-actions-view.ts:115-124`).
