---
last-updated: 2026-11-09
---

# Views Module

Two Obsidian sidebar `ItemView`s — `UnifiedProposalView` (proposal review with in-progress operation rows, checkpoint recovery and bulk accept/reject) and `SynapseActionsView` (registry-driven touch-friendly command palette) — plus their sidebar activation/refresh helpers, the actions-sidebar command dispatcher, and the semantic color-token system and BEM class helpers shared by both.

## Public API

Exported from `index.ts` (re-export barrel; `index.ts:1-31`).

```ts
// unified-proposal-view.ts
const UNIFIED_VIEW_TYPE = 'synapse-proposals'   // unified-proposal-view.ts:14

class UnifiedProposalView extends ItemView {     // unified-proposal-view.ts:33
  constructor(
    leaf: WorkspaceLeaf,
    callbacks: UnifiedViewCallbacks,
    notifications: NotificationManager,   // required 3rd arg; surfaces bulk-op errors
  )
  setItems(items: UnifiedItem[]): void           // :114 replace list; exits stale review mode; an open review whose proposal is still pending is NOT re-rendered (draft/focus kept)
  setCheckpoints(checkpoints: Checkpoint[]): void // :96 banner data for interrupted ops; no render while a review is open
  setInProgress(entries: InProgressEntry[]): void // :102 id-set change -> full render(); same ids -> re-render rows only; stored but not rendered outside list mode (#577)
  getViewType(): string    // 'synapse-proposals'
  getDisplayText(): string // 'Synapse proposals'
  getIcon(): string        // 'synapse' (:81-86)
}

// synapse-actions-view.ts
const SYNAPSE_ACTIONS_VIEW_TYPE = 'synapse-actions'   // synapse-actions-view.ts:7

interface SynapseActionsCallbacks {                    // types.ts:110
  getActions: () => CommandDefinition[]   // palette commands in registry order
  runAction: (id: string) => void         // invoke command by registry id
  isNoteActive: () => boolean             // gates context:'note' buttons
}

class SynapseActionsView extends ItemView {            // synapse-actions-view.ts:35
  constructor(leaf: WorkspaceLeaf, callbacks: SynapseActionsCallbacks)
  getViewType(): string    // 'synapse-actions'
  getDisplayText(): string // 'Synapse actions'
  getIcon(): string        // 'synapse-actions' (synapse-actions-view.ts:51-56)
  refresh(): void          // synapse-actions-view.ts:67; re-render; called by main.ts on active-leaf-change
}

// types.ts:19
const PROPOSAL_KINDS = [
  'elaboration', 'enrichment', 'organize', 'deep-dive', 'title', 'rem', 'illustrate',
] as const

type ProposalKind = (typeof PROPOSAL_KINDS)[number]   // types.ts:40

type UnifiedItem =                                     // types.ts:30
  | { kind: 'elaboration'; data: Proposal }
  | { kind: 'enrichment';  data: EnrichmentProposal }
  | { kind: 'organize';    data: OrganizeProposal }
  | { kind: 'deep-dive';   data: DeepDiveProposal }
  | { kind: 'title';       data: TitleProposal }
  | { kind: 'rem';         data: RemProposal }
  | { kind: 'illustrate';  data: IllustrateProposal }

interface UnifiedViewCallbacks {                       // types.ts:63
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
  onIllustrateAcceptSelected: (id: string, acceptedItemIds: string[]) => Promise<void>   // types.ts:84
  onIllustrateReject: (id: string) => Promise<void>
  onCheckpointDiscard: (id: string) => Promise<void>
  onCheckpointResume: (id: string) => Promise<void>
  onCancelInProgress: (id: string) => void              // types.ts:90; main wires NotificationManager.cancelOperation (#577)
}

// proposal-styles.ts
const SYNAPSE_COLOR_TOKENS: Record<ProposalKind, string>  // :15 'elaboration' -> '--synapse-color-elaboration'
const FEATURE_COLOR_TOKENS: Record<FeatureKey, string>    // :35 proposal kinds minus 'title'; adds main/summarize/tidy/video

function cardClass(kind: ProposalKind): string             // 'synapse-card--<kind>'
function badgeClass(kind: ProposalKind): string            // 'synapse-badge--<kind>'
function reviewPaneLabelClass(kind: ProposalKind): string  // 'synapse-review-pane-label--<kind>'
function actionsGroupClass(feature: FeatureKey): string    // 'synapse-actions-group--<feature>'

// types.ts:94 — one pending-proposal reader per kind + the checkpoint banner + in-progress sources
interface UnifiedViewSources {
  elaboration: () => Promise<Proposal[]>
  enrichment: () => Promise<EnrichmentProposal[]>
  organize: () => Promise<OrganizeProposal[]>
  'deep-dive': () => Promise<DeepDiveProposal[]>
  title: () => Promise<TitleProposal[]>
  rem: () => Promise<RemProposal[]>
  illustrate: () => Promise<IllustrateProposal[]>
  checkpoints: () => Promise<Checkpoint[]>
  inProgress: () => InProgressEntry[]                  // types.ts:103; sync snapshot (main: notifications.inProgress.snapshot())
}
// view-activation.ts:28 — reveal (create in right sidebar if needed) then refreshUnifiedView; no-op when no right leaf
function activateUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void>
// view-activation.ts:34
function activateSynapseActionsView(workspace: Workspace): Promise<void>
// view-activation.ts:64 — serialized per workspace (WeakMap state): a call during a run schedules ONE rerun and every caller resolves after the last run; each run loads every deferred leaf, then takes ONE sources.inProgress() snapshot after all awaits (view-activation.ts:115), then setItems/setCheckpoints/setInProgress on every open unified leaf (duck-typed; isUnifiedProposalView requires all three, view-activation.ts:39-44); no-op when none open
function refreshUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void>
// view-activation.ts:130 — subscribes to the registry; id-set change -> fireAndForget(refreshUnifiedView, { background: true }); same ids (progress tick) -> setInProgress only; returns unsubscribe (#577)
function watchInProgress(workspace: Workspace, sources: UnifiedViewSources, registry: InProgressRegistry): () => void

// command-runner.ts:8 — active file iff extension === 'md' (survives the actions sidebar stealing focus)
function activeMarkdownFile(app: App): TFile | null
// command-runner.ts:26 — context:'note': invoke the registered command's editorCallback(view.editor, view) directly with the active file's MarkdownView (no setActiveLeaf/focus change; rejection -> fireAndForget), or notice when no note is active; everything else (and unresolvable note handlers) -> executeCommandById(`${pluginId}:${id}`) (#352). `app.commands` is undocumented, so it is feature-detected first (command-runner.ts:33-42): absent, or without an `executeCommandById` function -> notifications.info('Could not run this action here. Run it from the command palette instead.') and return
function runRegisteredCommand(app: App, pluginId: string, id: string, notifications: NotificationManager): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `unified-proposal-view.ts` | `UnifiedProposalView`, `UNIFIED_VIEW_TYPE` (no type re-exports: `UnifiedItem` / `UnifiedViewCallbacks` come from the barrel or `types.ts` only) | Combined proposal sidebar: in-progress section, checkpoint banner, list, per-kind review, bulk ops; module-private `KIND_LABELS` (`unified-proposal-view.ts:16`), `organizeTargetLabel` (`unified-proposal-view.ts:1647`) |
| `synapse-actions-view.ts` | `SynapseActionsView`, `SYNAPSE_ACTIONS_VIEW_TYPE` | Registry-driven touch-friendly command palette sidebar |
| `types.ts` | `PROPOSAL_KINDS`, `ProposalKind`, `UnifiedItem`, `UnifiedViewCallbacks`, `UnifiedViewSources`, `SynapseActionsCallbacks` | Every exported view type; compile-time guards bind `PROPOSAL_KINDS` to `UnifiedItem['kind']` and `ProposalKind` to shared `InProgressKind` |
| `proposal-styles.ts` | `SYNAPSE_COLOR_TOKENS`, `FEATURE_COLOR_TOKENS`, `cardClass`, `badgeClass`, `reviewPaneLabelClass`, `actionsGroupClass` | Semantic color tokens + BEM class helpers |
| `view-activation.ts` | `activateUnifiedView`, `activateSynapseActionsView`, `refreshUnifiedView`, `watchInProgress` | Sidebar reveal/create (private `revealSidebarView`, `view-activation.ts:16`) + unified-view data push + in-progress registry subscription (private `membershipKey`, `view-activation.ts:146`; private `refreshOnce`, `view-activation.ts:96` = one source read + push) |
| `command-runner.ts` | `activeMarkdownFile`, `runRegisteredCommand` | Actions-sidebar dispatch: direct `editorCallback` invocation for `context: 'note'` commands, Obsidian `executeCommandById` otherwise; `app.commands` feature-detected, info notice when unavailable |
| `index.ts` | barrel re-export of all the above | Public surface |
| `*.test.ts` (5 files) | tests | `unified-proposal-view` (incl. describe `UnifiedProposalView elaboration rewrite copy (#552)`, `unified-proposal-view.test.ts:426`), `synapse-actions-view`, `proposal-styles`, `view-activation`, `command-runner` |

Only the two registered `ItemView`s above exist; no other view class exists in `src/`.

## View Registry

| View type id | Class | getIcon | getDisplayText | Source |
|--------------|-------|---------|----------------|--------|
| `synapse-proposals` | `UnifiedProposalView` | `synapse` | `Synapse proposals` | `unified-proposal-view.ts:14` |
| `synapse-actions` | `SynapseActionsView` | `synapse-actions` | `Synapse actions` | `synapse-actions-view.ts:7` |

## Compile-Time Guards

`types.ts:48-51` asserts `PROPOSAL_KINDS` equals `UnifiedItem['kind']` in both directions via two distinct `const _x: true` assertions (`_AssertKindsCoverUnion`, `_AssertUnionCoversKinds`). Adding a kind to only one side fails the build.

`types.ts:56-59` asserts `ProposalKind` equals `InProgressKind` (`shared/in-progress-registry.ts:4`) in both directions (`_AssertInProgressCoversKinds`, `_AssertKindsCoverInProgress`). `InProgressKind` is a sanctioned duplicate of `ProposalKind`: `shared` cannot import `views`.

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

`render()` (`unified-proposal-view.ts:175`) dispatches on whichever `reviewing*` field is set (elaboration, enrichment, organize, deep-dive, title, rem, illustrate), else list mode.

1. In progress section (`renderInProgressRows` `:1538`, #577): `.synapse-in-progress` div created first in list mode (`:445`), above the checkpoint banner; hidden via `is-empty` when no entries. One row per `InProgressEntry`: kind badge (`KIND_LABELS`), label, optional target, `current/total` + determinate fill when `total > 0`, else indeterminate track; Cancel button only when `cancellable` -> `onCancelInProgress(entry.id)`. List-mode empty-state text is suppressed while any entry runs (`:454`). Styles `styles.css:1246-1324`.
2. Checkpoint banner (`renderCheckpointBanner` `:1577`): one card per incomplete checkpoint with operation label, done/total progress bar, Resume/Discard. Progress fills (`.synapse-checkpoint-fill`, `:1599`; `.synapse-accept-all-fill`, `:433`) set the `--synapse-fill` custom property via `setCssProps`, and `styles.css` reads it as `width: var(--synapse-fill, 0%)` — no inline `style.width`.
3. List mode (`renderList` `:439`): pending proposals grouped by `data.sourceNotePath`; Accept all / Reject all bar shown when 2+ pending; each card has a badge, summary, preview, and Review/Accept/Reject. Elaboration card (`renderElaborationCard` `:528`, #552): preview text is prefixed `Replaces the note's content with: ` (`:543`); accept button reads `Accept and replace` (`:555`) and sends `proposal.proposedAdditions` to `onElaborationAccept` (`:558`). Organize card (`:631`): headline `organizeTargetLabel(proposal)` (`:642`) = `Move to <dir>` when `proposalKind === 'move'`, else `New folder <dir>` (`:1647-1651`); `Decided by the System 1 lane` line when `proposal.lane === 'system-one'` (`:645-646`). REM card (`:1207`): `Semantic links decided by the System 1 lane` when `proposal.lane === 'system-one'` (`:1230-1231`). Illustrate card (`renderIllustrateCard` `:1393`): summary `N visual(s) | <counts per kind>` (`illustrateSummary` `:1384`), preview = first 3 captions; `Accept all` sends every item id to `onIllustrateAcceptSelected`.
4. Elaboration review (`renderElaborationReview` `:672`, #552): editable textarea labelled `Proposed rewrite (accepting replaces the note's content; frontmatter is kept)` (`:702`); `Accept and replace` (`:711`) sends the edited full body to `onElaborationAccept(id, textarea.value)` (`:715`).
5. Enrichment review (`:738`): per-item checkboxes (tags / internalLinks / externalLinks / frontmatter); Accept selected / All / None / Reject.
6. Organize review (`renderOrganizeReview` `:841`): pane label `Move to existing folder` (`proposalKind === 'move'`) or `New folder` (`:864`), proposed directory, `Decided by the System 1 lane` when lane is `system-one` (`:871-872`), reasoning; Accept/Reject.
7. Deep-dive review (`:951`): title, depth + quality badges, proposed path, read-only content preview, cascade warning when `childProposalIds.length > 0`; Accept/Reject.
8. Title review (`:1108`): current vs proposed title, trigger (`untitled` | `content-mismatch`), reasoning. No collision: single Accept (rename)/Reject. Collision (`data.conflictsWith` set, #414): a "Conflict" badge + callout (`describeConflict()` `:1035`) name the existing note/folder, and Accept is replaced by "Add suffix" (`onTitleAccept(id, 'iterate')`) and "Merge into existing" (`onTitleAccept(id, 'merge')`) (#408); the same badge/callout/split-buttons also render on the title list card.
9. REM review (`:1272`): per-candidate checkboxes with match-type badge (`title`/`alias`/`semantic`, semantic shows confidence %); per-candidate `System 1 lane` tag when `candidate.lane === 'system-one'` (`:1314-1315`); Accept selected / All / None / Reject.
10. Illustrate review (`renderIllustrateReview` `:1438`): per-item checkbox (all selected on entry, `enterIllustrateReview` `:1432`), placement label `describeInsertion(item.placement)` or `Placement resolved on accept` (`:1465`), kind badge `synapse-badge--illustrate-<kind>`, caption; photo items show the remote thumbnail + `title — license — attribution (provider)` (nothing downloaded during review), diagram/chart items show the Mermaid source in a `pre`; Accept selected / All / None / Reject.

## Bulk Operations (UnifiedProposalView)

| Op | Method | Trigger | Behavior |
|----|--------|---------|----------|
| Accept all | `acceptAll()` `:240` (per item `acceptSingleItem` `:280`) | "Accept all" button, 2+ pending | Sequential over snapshot; per-kind accept-all; stops on first error |
| Reject all | `rejectAll()` `:351` (per item `rejectSingleItem` `:387`) | "Reject all" button, 2+ pending | Sequential over snapshot; stops on first error |

Sequential because organize accepts may move files. Mutually exclusive via `acceptAllInProgress` / `rejectAllInProgress`; buttons disabled while either runs. Enrichment accept-all selects all tags/links/refs/frontmatter; REM accept-all selects all `candidates[].matchedText`; illustrate accept-all selects every `items[].id` (`:314`).

## Data Flow

Input: `refreshUnifiedView(workspace, sources)` (`view-activation.ts:64`) reads every `UnifiedViewSources` reader into `UnifiedItem[]` plus incomplete checkpoints and one in-progress snapshot, then calls `setItems()` / `setCheckpoints()` / `setInProgress()` on each open unified leaf. `watchInProgress` pushes registry changes between refreshes. The `UnifiedViewSources` instance is built in `main.ts:110-120` (seven `getPendingProposals()` readers + `checkpointManager.listIncomplete()` + `notifications.inProgress.snapshot()`).

Processing: view stores items, re-renders. User clicks invoke `UnifiedViewCallbacks` (proposal accept/reject) or `SynapseActionsCallbacks.runAction` (command dispatch via `runRegisteredCommand`). The view holds no proposal store and never touches `app`/vault for state — only `openNote()` opens files in the editor.

Output: callbacks return `Promise<void>`; modules mutate the vault/proposal store and re-trigger `refreshUnifiedView` through their `onViewRefreshNeeded` slot (`main.ts:181-184`). `SynapseActionsView.refresh()` re-renders on `active-leaf-change` to enable/disable `context:'note'` buttons.

## Wiring (main.ts)

`main.ts:147-166` registers `UNIFIED_VIEW_TYPE` with the third `notifications` arg; the checkpoint callbacks delegate to `CheckpointRecoveryModule.discard/resume` (`src/checkpoints`). Modules are locals destructured from the registry's `FeatureModules` record (`main.ts:82`):

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
  onCancelInProgress: (id) => this.notifications.cancelOperation(id),
}, this.notifications);
this.register(watchInProgress(this.app.workspace, viewSources, this.notifications.inProgress));   // main.ts:167
```

`main.ts:170-174` registers `SYNAPSE_ACTIONS_VIEW_TYPE`; `main.ts:175-178` calls `refresh()` on `active-leaf-change`:

```ts
new SynapseActionsView(leaf, {
  getActions: () => listPaletteActions(registrar.getRegistered()),
  runAction: (id) => runRegisteredCommand(this.app, this.manifest.id, id, this.notifications),
  isNoteActive: () => activeMarkdownFile(this.app) !== null,
});
```

Activation entry points: ribbon `synapse` and every module's `onOpenProposalView` slot call `activateUnifiedView` via `openProposalView` (`main.ts:122-123`, `:181-184`, `:218`); command `review-proposals` (`main.ts:224-226`); ribbon `synapse-actions` calls `activateSynapseActionsView` (`main.ts:220-222`).

## Dependencies

| Import | From | Kind |
|--------|------|------|
| `Proposal` | `../elaboration` | type only (`types.ts:1`, `unified-proposal-view.ts:2`, `view-activation.ts:4`) |
| `AcceptedItems`, `EnrichmentProposal` | `../enrichment` | type only (`types.ts:2`, `unified-proposal-view.ts:3`; `EnrichmentProposal` alone `view-activation.ts:5`) |
| `OrganizeProposal` | `../organize` | type only (`types.ts:3`, `unified-proposal-view.ts:4`, `view-activation.ts:6`) |
| `DeepDiveProposal` | `../deep-dive` | type only (`types.ts:4`, `unified-proposal-view.ts:5`, `view-activation.ts:7`) |
| `TitleProposal`, `TitleDuplicateStrategy` | `../title` | type only (`types.ts:5`; `TitleProposal` alone `unified-proposal-view.ts:6`, `view-activation.ts:8`) |
| `RemProposal` | `../rem` | type only (`types.ts:6`, `unified-proposal-view.ts:7`, `view-activation.ts:9`) |
| `IllustrateProposal` | `../illustrate` | type only (`types.ts:7`, `unified-proposal-view.ts:8`, `view-activation.ts:10`) |
| `Checkpoint`, `NotificationManager`, `InProgressKind`, `InProgressEntry`, `InProgressRegistry` | `../shared` | type only (`Checkpoint` + `InProgressEntry` + `InProgressKind` `types.ts:8`; `Checkpoint` + `InProgressEntry` + `InProgressRegistry` `view-activation.ts:3`; `Checkpoint` + `InProgressEntry` + `NotificationManager` `unified-proposal-view.ts:9`; `NotificationManager` `command-runner.ts:5`) |
| `fireAndForget` | `../shared` | runtime value (`unified-proposal-view.ts:10`, `view-activation.ts:2`, `command-runner.ts:4`) |
| `describeInsertion` | `../shared` | runtime value (`unified-proposal-view.ts:10`; illustrate placement label) |
| `CommandDefinition`, `FeatureKey` | `../commands` | type only (`CommandDefinition` `types.ts:9`; both `synapse-actions-view.ts:2`; `FeatureKey` `proposal-styles.ts:2`) |
| `FEATURE_ICONS` | `../commands` | runtime value (`synapse-actions-view.ts:3`) |
| `REGISTRY_BY_ID` | `../commands` | runtime value (`command-runner.ts:3`) |
| `MarkdownView` | `obsidian` | runtime value (`command-runner.ts:1`) |
| `App`, `Command`, `TFile`, `Workspace`, `WorkspaceLeaf` | `obsidian` | type only (`command-runner.ts:2`, `view-activation.ts:1`) |

The seven proposal feature modules are imported as TYPES ONLY (no runtime feature-module code in the view layer). Runtime imports are limited to `fireAndForget` + `describeInsertion` (shared), `FEATURE_ICONS` + `REGISTRY_BY_ID` (commands), and Obsidian's `ItemView`/`setIcon`/`MarkdownView`.

## Error States

- Individual Accept/Reject: handlers run via `onClick()`/`fireAndForget` (`unified-proposal-view.ts:207`), so a rejected promise is surfaced to the user instead of failing silently.
- Bulk Accept all / Reject all: on first failure the loop stops, sets the in-progress flag false, and calls `notifications.error(...)` with the failing item label, the error message, and a `X/total accepted, N remaining` summary (`unified-proposal-view.ts:261-264`, `:372-375`). Already-applied items are not rolled back.
- `setItems()` exits any active review mode (all seven kinds) whose proposal id is no longer pending (`unified-proposal-view.ts:114-163`).
- `openNote()` no-ops when the path resolves to no file (`unified-proposal-view.ts:214`).
- `SynapseActionsView`: empty `getActions()` renders an "enable features in settings" message (`synapse-actions-view.ts:79`); `context:'note'` buttons are `disabled` with `aria-disabled` and no click handler when no note is active (`synapse-actions-view.ts:103-112`).
