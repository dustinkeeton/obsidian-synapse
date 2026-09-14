---
last-updated: 2026-09-14
---

# Changelog Module

In-app "What's new" (#375): parses the build-inlined `CHANGELOG.md` (esbuild `.md` text loader, `esbuild.config.mjs:44`; ambient type `shared/markdown.d.ts`) and renders it in a modal opened from the settings tab.

## Public API

Exported from `index.ts`:

```ts
// changelog.ts:12
interface ChangelogSection { title: string; items: string[] }
// changelog.ts:20
interface ChangelogEntry { version: string; date: string | null; sections: ChangelogSection[] }

// changelog.ts:34
function stripInlineMarkdown(text: string): string
// changelog.ts:60 — one entry per `## [version] - date` block
function parseChangelog(markdown: string): ChangelogEntry[]
// changelog.ts:106 — renders parsed entries into container; currentVersion marks the running release
function renderChangelog(container: HTMLElement, markdown: string, currentVersion?: string): void

// changelog-modal.ts:14
class ChangelogModal extends Modal {
  constructor(app: App, plugin: SynapsePlugin)
  onOpen(): void    // changelog-modal.ts:19 — adds `synapse-changelog` class, renderChangelog(CHANGELOG, plugin.manifest.version)
  onClose(): void   // changelog-modal.ts:30 — empties contentEl
}
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `stripInlineMarkdown`, `parseChangelog`, `renderChangelog`, `ChangelogSection`, `ChangelogEntry`, `ChangelogModal` | Barrel |
| `changelog.ts` | `ChangelogSection`, `ChangelogEntry`, `stripInlineMarkdown`, `parseChangelog`, `renderChangelog` | Pure parser + DOM renderer (no `obsidian` import) |
| `changelog-modal.ts` | `ChangelogModal` | Thin Modal wrapper; owns the `CHANGELOG.md` import |
| `changelog.test.ts`, `changelog-modal.test.ts` | Tests | `changelog-modal.test.ts` mocks `'../../CHANGELOG.md'` |

## Dependencies

| Import | From | File |
|--------|------|------|
| `App`, `Modal` | `obsidian` | `changelog-modal.ts:1` |
| `SynapsePlugin` (type) | `../main` | `changelog-modal.ts:2` |
| `CHANGELOG` (string) | `../../CHANGELOG.md` | `changelog-modal.ts:6` |

Consumers: `settings-ui/settings-tab.ts` (`ChangelogModal`, "What's new" button).
