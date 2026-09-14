---
last-updated: 2026-09-14
---

# Properties Fold Module

Auto-fold a note's Properties (frontmatter) panel when it opens (#381), gated by `settings.ui.autoFoldProperties`. Registration + teardown live here; `main.ts` calls the single hook.

## Public API

Exported from `index.ts`:

```ts
// properties-fold.ts:35 / :38 / :45
const METADATA_CONTAINER_SELECTOR = '.metadata-container'
const PROPERTIES_COLLAPSED_CLASS = 'is-collapsed'
const PROPERTIES_COLLAPSE_INDICATOR_SELECTOR = '.collapse-indicator.collapse-icon'

// properties-fold.ts:92 — true only when it collapsed a previously-expanded panel
function foldPropertiesIn(root: QueryRoot | null | undefined): boolean
// properties-fold.ts:117 — no-op unless enabled and view present
function applyPropertiesFold(view: ViewLike | null | undefined, enabled: boolean): boolean
// properties-fold.ts:132 — folds the active MarkdownView (settings-tab toggle path)
function foldActiveNoteProperties(app: App, enabled: boolean): boolean
// properties-fold.ts:158 — folds on onLayoutReady + workspace `file-open` (registerEvent), each with a deferred setTimeout(0) second pass; timers cleared via plugin.register
function registerPropertiesAutoFold(plugin: SynapsePlugin, getSettings: () => SynapseSettings): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | everything above | Barrel |
| `properties-fold.ts` | `METADATA_CONTAINER_SELECTOR`, `PROPERTIES_COLLAPSED_CLASS`, `PROPERTIES_COLLAPSE_INDICATOR_SELECTOR`, `foldPropertiesIn`, `applyPropertiesFold`, `foldActiveNoteProperties`, `registerPropertiesAutoFold` | DOM fold + plugin wiring |
| `properties-fold.test.ts` | Tests | |

## Dependencies

| Import | From | File |
|--------|------|------|
| `MarkdownView`, `App` (type) | `obsidian` | `properties-fold.ts:1-2` |
| `SynapsePlugin` (type) | `../main` | `properties-fold.ts:3` |
| `SynapseSettings` (type) | `../settings` | `properties-fold.ts:4` |

Consumers: `main.ts` (`registerPropertiesAutoFold`), `settings-ui/settings-tab.ts` (`foldActiveNoteProperties`; its test imports the selector constants).
