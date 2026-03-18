# Community Plugin Guidelines Audit

**Date**: 2026-03-18
**Plugin**: Synapse v0.1.0
**Guidelines**: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

## Summary

**PASS WITH NOTES** — The plugin passes all critical requirements (no dynamic code execution, no `.obsidian/` modification, no telemetry, proper settings API). Several non-blocking warnings around style cleanup, adapter usage, and settings UI conventions should be addressed before community submission.

## Detailed Findings

### 1. No `.obsidian/` Modification
**Status**: PASS
**Details**: No code references or modifies the `.obsidian/` directory. All plugin data is stored under `.synapse/` using the vault adapter.
**Files**: Searched all `src/**/*.ts` files.
**Action**: None.

### 2. No Dynamic Code Execution
**Status**: PASS
**Details**: Zero matches for dynamic code execution patterns (code evaluation, dynamic function construction, or direct HTML insertion) in the source code. DOM is built programmatically using `createEl()`, `createDiv()`, and Obsidian's API methods.
**Files**: Searched all `src/**/*.ts` files.
**Action**: None.

### 3. Proper `registerEvent()` Usage
**Status**: PASS
**Details**: Event listeners use `this.plugin.registerEvent()` for automatic cleanup (e.g., `src/enrichment/index.ts:60`). View event listeners are attached to DOM elements owned by the view (cleaned up when the view closes). No orphaned `addEventListener` calls on global objects.
**Files**: `src/enrichment/index.ts`
**Action**: None.

### 4. Settings API Usage
**Status**: PASS
**Details**: Uses standard `this.loadData()` / `this.saveData()` pattern via Obsidian's Plugin base class. Settings are deeply merged with defaults on load.
**Files**: `src/main.ts:224-233`
**Action**: None.

### 5. `app.vault.adapter` Usage
**Status**: WARNING
**Details**: `app.vault.adapter` is used extensively across 11 source files, primarily in store classes that persist JSON proposals/checkpoints under the hidden `.synapse/` folder. The migration function in `main.ts:479-509` also uses adapter for folder rename. The guidelines state "Prefer Vault API over Adapter API for performance and safety." However, the adapter usage here is for **non-markdown JSON files in a hidden folder** — the Vault API (`vault.create`, `vault.modify`) is designed for markdown files tracked in Obsidian's index. Using it for internal JSON state would pollute the file explorer, search results, and graph view. The current adapter usage is the accepted pattern for plugin-internal storage.
**Files**: `src/main.ts`, `src/elaboration/proposal-store.ts`, `src/enrichment/enrichment-store.ts`, `src/organize/organize-store.ts`, `src/deep-dive/deep-dive-store.ts`, `src/shared/checkpoint-manager.ts`, `src/tidy/tidy-store.ts`, `src/video/index.ts`, `src/elaboration/proposer.ts`
**Action**: None — adapter usage is justified for non-indexed internal storage. Document this rationale for reviewers.

### 6. Clean Unload
**Status**: WARNING
**Details**: All modules have `onunload()` methods called from `main.ts:213-222`. The `setInterval` in `elaboration/index.ts:76` is properly cleaned up in `onunload()`. However:
- **`setTimeout` not cleaned up**: `main.ts:190` (checkpoint check, 3s delay) and `elaboration/index.ts:72` (startup scan, 5s delay) use `setTimeout` without storing the handle for cleanup. If the plugin is disabled within the delay window, the callback will still fire.
- **Injected styles not removed**: `notifications.ts:44-116` and `unified-proposal-view.ts:880-1316` inject `<style>` elements into `document.head` but never remove them on unload. A `stylesInjected` flag prevents re-injection but the styles persist across disable/enable cycles.
- **`NotificationManager` intervals**: Ellipsis animation intervals are properly tracked and cleaned up via `stopEllipsis()`.
**Files**: `src/main.ts:190`, `src/elaboration/index.ts:72`, `src/shared/notifications.ts:36-116`, `src/views/unified-proposal-view.ts:876-1317`
**Action**: Follow-up issue created for setTimeout cleanup and style cleanup on unload.

### 7. `minAppVersion` Accuracy
**Status**: WARNING
**Details**: Currently set to `0.15.0` (from early 2021). The plugin uses APIs that were stabilized in later versions:
- `workspace.getRightLeaf(false)` — requires `~1.0.0`+
- `registerView()` pattern — stable since `~0.15.0`
- `workspace.getActiveFile()` — available since `~0.15.0`
- `Platform.isDesktop` — available since `~0.15.0`
- `normalizePath()` — available since `~0.15.0`
The `getRightLeaf(false)` parameter (boolean for `createIfNeeded`) was introduced around Obsidian 1.0. Setting `minAppVersion` to `1.0.0` is safer and more accurate.
**Files**: `manifest.json:5`
**Action**: Bumped `minAppVersion` to `1.0.0` in this PR (safe, minor fix).

### 8. DOM Manipulation / Style Injection
**Status**: WARNING
**Details**: Two files inject CSS via `document.createElement('style')` + `document.head.appendChild()`:
- `src/shared/notifications.ts:44` — notification styling (border colors, layout, buttons)
- `src/views/unified-proposal-view.ts:880` — proposal view styling (cards, lists, review mode)

Both use Obsidian CSS variables (`var(--interactive-accent)`, `var(--text-muted)`, etc.) for theme compatibility. They define CSS classes rather than inline styles. The guideline "Never hardcode inline styles; use CSS classes instead" is satisfied. However, the guideline also suggests using a `styles.css` file for plugin styles. Moving these to `styles.css` would be cleaner and allow theme developers to override them.
**Files**: `src/shared/notifications.ts:44-116`, `src/views/unified-proposal-view.ts:880-1316`
**Action**: Follow-up issue created to migrate inline style injection to `styles.css`.

### 9. No Undeclared Network Calls
**Status**: PASS
**Details**: All network calls are user-configured AI provider requests:
- `src/audio/transcriber.ts:63,121` — `fetch()` to OpenAI Whisper API and Deepgram API
- `src/shared/ai-client.ts:24` — `requestUrl()` to configured AI provider
- `src/summarize/content-fetcher.ts:18` — `requestUrl()` for URL summarization
No telemetry, analytics, or undeclared external requests found.
**Files**: `src/audio/transcriber.ts`, `src/shared/ai-client.ts`, `src/summarize/content-fetcher.ts`
**Action**: None.

### 10. Settings UI Conventions
**Status**: WARNING
**Details**: Settings tab uses `containerEl.createEl('h2', ...)` and `containerEl.createEl('h3', ...)` for section headings (e.g., `settings-tab.ts:17,117,184,290,353,553,654,669,727`). The guidelines state: "Use `setHeading()` method instead of HTML heading elements for consistent styling." The `setHeading()` method on `Setting` provides Obsidian-native heading rendering. Additionally, several section headings include "Transcription" which could be simplified.
**Files**: `src/settings-tab.ts`
**Action**: Follow-up issue created to migrate to `setHeading()` pattern.

### 11. No Regex Lookbehinds
**Status**: PASS
**Details**: No regex lookbehind patterns found in source code. The plugin is mobile-compatible in this regard.
**Files**: Searched all `src/**/*.ts` files.
**Action**: None.

### 12. Console Logging
**Status**: PASS
**Details**: No `console.log()` calls found. Only `console.warn()` and `console.error()` are used, which is appropriate for error/warning conditions per the guidelines.
**Files**: Searched all `src/**/*.ts` files.
**Action**: None.

### 13. Workspace API Usage
**Status**: PASS
**Details**: No deprecated `workspace.activeLeaf` usage. No `detachLeavesOfType` in `onunload()`. Views are retrieved via `getLeavesOfType()`. Active editor is accessed through proper patterns.
**Files**: `src/main.ts`, `src/views/unified-proposal-view.ts`
**Action**: None.

### 14. `vault.modify()` vs `vault.process()`
**Status**: WARNING
**Details**: Several modules use `vault.modify()` for background file edits (e.g., `src/enrichment/enrichment-applier.ts:99,139`, `src/video/index.ts:146,250`, `src/elaboration/index.ts:313`). The guidelines prefer `vault.process()` which is atomic and avoids race conditions with concurrent edits. However, `vault.process()` was introduced in a later Obsidian version and the current `vault.modify()` usage reads-then-writes in quick succession.
**Files**: `src/enrichment/enrichment-applier.ts`, `src/video/index.ts`, `src/elaboration/index.ts`
**Action**: Follow-up issue created to migrate to `vault.process()`.

### 15. `fetch()` vs `requestUrl()`
**Status**: WARNING
**Details**: `src/audio/transcriber.ts` uses the native `fetch()` API for Whisper and Deepgram API calls instead of Obsidian's `requestUrl()`. The guidelines prefer `requestUrl()` for cross-platform compatibility. However, `requestUrl()` does not support `FormData` bodies (required for multipart file upload to Whisper API), making `fetch()` the only viable option here. This works on both desktop and mobile Obsidian.
**Files**: `src/audio/transcriber.ts:63,121`
**Action**: None — `fetch()` is necessary due to `FormData` requirement.

### 16. Class Naming
**Status**: PASS
**Details**: All classes use meaningful names (`SynapsePlugin`, `SynapseSettingTab`, `ElaborationModule`, etc.). No generic placeholder names.
**Files**: All source files.
**Action**: None.

### 17. Command Hotkeys
**Status**: PASS
**Details**: No default hotkeys are set on any commands. All commands use `callback` or `editorCallback` appropriately.
**Files**: `src/main.ts`, `src/elaboration/index.ts`, `src/enrichment/index.ts`, other module files.
**Action**: None.

## Follow-up Issues

| Issue | Title | Priority |
|-------|-------|----------|
| #132 | Clean up setTimeout handles and remove injected styles on unload | Medium |
| #133 | Migrate settings headings from createEl to setHeading() | Low |
| #134 | Migrate inline style injection to styles.css | Low |
| #135 | Migrate vault.modify() to vault.process() for background edits | Low |
