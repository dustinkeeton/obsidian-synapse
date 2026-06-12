# Community Guidelines Audit

| | |
|---|---|
| **Audit date** | 2026-06-11 |
| **Plugin version** | 0.9.0 |
| **Audited against** | [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines), [Submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins), [Developer policies](https://docs.obsidian.md/Developer+policies) (all fetched 2026-06-11) |
| **Scope** | Full checklist walk of `src/` at v0.9.0, including the modules added since the previous audit: `commands`, `image`, `intake`, `pipeline`, `rem`, `title`, `transcription` |
| **Supersedes** | The v0.1.0 audit from closed PR #136 (March 2026). All four of its follow-ups (#132, #133, #134, #135) were re-verified as fixed in current code. |

## Verdict summary

| Status | Count | Items |
|--------|-------|-------|
| PASS | 30 | See sections below |
| WARNING | 3 | Sync `fs` calls (#279), static inline styles (folded into #278), custom frontmatter serialization (documented, no action) |
| FAIL | 6 | `minAppVersion` (fixed in this PR), adapter read of a vault note (fixed in this PR), double-prefixed command IDs (#276), missing README network/account disclosures (#277), settings UI text/heading (#278), adapter write of a vault file (#280) |

### Findings table (FAIL / WARNING only)

| # | Finding | Status | Evidence | Action |
|---|---------|--------|----------|--------|
| F1 | `minAppVersion` declared `0.15.0` but `vault.process()` (Obsidian 1.1.0) is used in 21 places | FAIL | `manifest.json:5`; e.g. `src/elaboration/index.ts`, `src/enrichment/enrichment-applier.ts:36`, `src/shared/file-utils.ts:34`, `src/video/index.ts:178` | **Fixed in this PR** — `minAppVersion` → `1.1.0`; `versions.json` `0.9.0` entry updated to match |
| F2 | Vault note read through the adapter instead of the Vault API | FAIL | `src/elaboration/proposer.ts:20` (pre-fix) | **Fixed in this PR** — now `vault.getAbstractFileByPath()` + `vault.cachedRead()` |
| F3 | Command IDs embed the plugin ID (`synapse:scan-vault`), so Obsidian registers them double-prefixed (`synapse:synapse:scan-vault`) | FAIL | `src/commands/registry.ts:17-63`; `src/commands/registrar.ts:43` passes ids verbatim to `addCommand` | Follow-up **#276** |
| F4 | README lacks the network-use and account-requirement disclosures required by developer policies; provider list is stale (omits Gemini) | FAIL | `README.md` (no privacy/network section); network surface in `src/shared/ai-client.ts`, `src/audio/transcriber.ts`, `src/shared/tweet-fetcher.ts`, `src/shared/content-fetcher.ts` | Follow-up **#277** |
| F5 | Settings tab has a top-level plugin-name heading; ~9 UI strings use title case instead of sentence case | FAIL | `src/settings-tab.ts:148` (`Synapse v<version>` heading); `setName('API Key')`, `setName('Ollama Endpoint')`, `setName('AI Provider')` (settings-tab.ts); `Proximity Weights`, `Tag Vocabulary` (`src/enrichment/settings-section.ts:123,156`); `Deepgram API Key`, `Google Gemini API Key`, `OpenAI API Key (Whisper)`, `Recursion Depth` | Follow-up **#278** |
| F6 | User-visible vault file written through the adapter (`adapter.writeBinary`) instead of `vault.createBinary()` | FAIL | `src/video/index.ts:327` (video download into user-configured folder) | Follow-up **#280** |
| W1 | Synchronous `fs` calls on whole media files block the main thread (desktop only) | WARNING | `src/video/index.ts:119,325`; `src/audio/index.ts:112,118,431,435`; `src/transcription/duration-detector.ts:41` | Follow-up **#279** |
| W2 | Two static inline styles that belong in `styles.css` | WARNING | `src/elaboration/proposal-modal.ts:48-49` (`width`/`fontFamily` on textarea). Dynamic values (progress-bar widths in `src/views/unified-proposal-view.ts:350,1203`, slider positions in `src/transcription/time-range-slider.ts:153-154`) are acceptable inline. | Folded into **#278** |
| W3 | Frontmatter edits use custom `parseYaml`/`stringifyYaml` round-trip instead of `FileManager.processFrontMatter` | WARNING | `src/shared/frontmatter-utils.ts`; callers in `src/intake/index.ts`, `src/tidy/index.ts`, `src/enrichment/enrichment-applier.ts` | No action required: every write happens inside `vault.process()` (atomic) and rewrites body + frontmatter together, which `processFrontMatter` cannot do. Documented here for reviewers. |

---

## Plugin guidelines — item-by-item

### General

#### Avoid the global `app` instance — PASS
All access goes through `this.app` / injected `App`. No `window.app` or bare global `app` references in `src/`.

#### Avoid unnecessary console logging — PASS
Zero `console.log`/`console.debug`/`console.info` calls. 34 `console.warn`/`console.error` calls remain, all reporting genuine failure conditions (e.g. the data-folder migration conflict warning in `src/main.ts`, image-context failure in `src/elaboration/proposer.ts`).

#### Organize code with folders — PASS
16 feature folders under `src/` (`audio`, `commands`, `deep-dive`, `elaboration`, `enrichment`, `image`, `intake`, `organize`, `pipeline`, `rem`, `summarize`, `tidy`, `title`, `transcription`, `video`, `views`) plus `shared/`. Each feature module exposes an `index.ts` orchestrator.

#### Rename placeholder class names — PASS
No `MyPlugin`, `MyPluginSettings`, or `SampleSettingTab` anywhere. Main class is `SynapsePlugin`; sample-plugin code fully removed.

### Mobile

#### Node and Electron APIs — PASS (with rationale)
`manifest.json` declares `isDesktopOnly: false`. Node APIs (`fs`, `os`, `path`, `child_process`) appear only as **lazy `require()` calls inside desktop-gated code paths** — there are no top-level Node imports (enforced by `scripts/check-top-level-requires.mjs`):

- `src/video/*` — module is only constructed when `Platform.isDesktop` (`src/main.ts:112-115`)
- `src/audio/index.ts:107-109,420-422` — guarded by `this.extractor` presence, which is only set on desktop (`src/main.ts:112`)
- `src/transcription/duration-detector.ts:25,83` — explicit `Platform.isDesktop` early-returns
- `src/transcription/unified-modal.ts:68,127,164` and `src/settings-tab.ts:169` — hide desktop-only features on mobile

Mobile users get the full feature set minus video transcription / ffmpeg-dependent flows, which the README labels "desktop only". This graceful-degradation pattern is the accepted alternative to `isDesktopOnly: true`.

#### Lookbehind in regular expressions — PASS
No `(?<=` / `(?<!` patterns in `src/` (mobile-Safari-safe).

### UI text

#### Only use headings under settings when you have multiple sections / no top-level heading — FAIL → #278
`src/settings-tab.ts:148` renders `Synapse v<version>` as a top-level heading in the settings tab. Reviewers flag plugin-name headings.

#### Avoid "settings" in headings — PASS
No heading contains the word "settings".

#### Use sentence case in UI — FAIL → #278
~9 of 67 `setName()` strings use title case: `AI Provider`, `API Key`, `Ollama Endpoint` (`src/settings-tab.ts`), `Deepgram API Key`, `Google Gemini API Key`, `OpenAI API Key (Whisper)` (transcription settings), `Recursion Depth` (deep-dive), and the headings `Proximity Weights` / `Tag Vocabulary` (`src/enrichment/settings-section.ts:123,156`). Everything else (e.g. `Max tokens`, `Detect TODO markers`, `Max image size (MB)`) is compliant.

#### Use `setHeading` instead of HTML heading elements — PASS
All section headings use `new Setting(...).setHeading()` (`src/settings-tab.ts:148`, `src/enrichment/settings-section.ts:123,156`). No `createEl('h1'|'h2'|...)` in settings UI. (Fix from old follow-up #134 re-verified.)

### Security

#### Avoid `innerHTML`, `outerHTML`, `insertAdjacentHTML` — PASS
Zero occurrences in `src/`.

#### Use DOM helper functions — PASS
UI built with `createEl`/`createDiv`/`createSpan` throughout (`src/views/unified-proposal-view.ts`, modals, settings sections). The only `document.createElement` is an **off-DOM canvas** for image downscaling (`src/image/preprocess.ts:196`) — never attached to the document, so no DOM is touched outside plugin-owned elements.

### Resource management

#### Clean up resources on unload — PASS
`SynapsePlugin.onunload()` (`src/main.ts:386-403`) clears its startup timer and delegates to every module's `onunload()`. Spot-checked: `src/elaboration/index.ts:92-100` clears its startup timeout and scan interval; `src/intake/index.ts:92-99` clears all pending debounce timers and state maps; `src/shared/notifications.ts` tracks and stops its ellipsis interval. (Fix from old follow-up #132 re-verified.)

#### Use `registerEvent()` / `addCommand()` — PASS
Vault listeners go through `this.plugin.registerEvent(...)` (`src/intake/index.ts:84,87`, `src/enrichment/index.ts:71`). All commands go through `addCommand` via the central `CommandRegistrar` (`src/commands/registrar.ts:43`). Status bar item via `addStatusBarItem()` (`src/main.ts:90`); ribbon icons via `addRibbonIcon` (`src/main.ts:288,297`) — all auto-cleaned by Obsidian.

#### Don't detach leaves in `onunload` — PASS
No `detachLeavesOfType` anywhere; `onunload` touches no leaves.

### Commands

#### Avoid setting default hotkeys — PASS
No `hotkeys` property on any command.

#### Use the appropriate callback type — PASS (note)
Commands use plain `callback` and validate context (active file, provider configured) at invocation time with a `Notice` on failure. `checkCallback` would hide inapplicable commands instead; current behavior is acceptable and intentional (commands surface why they can't run).

### Workspace

#### Avoid `workspace.activeLeaf` — PASS
Zero references. Active-file access uses `workspace.getActiveFile()` (8 call sites, e.g. `src/audio/index.ts:92`, `src/video/index.ts:144`).

#### Use `activeEditor` for editor access — PASS (N/A)
The plugin never manipulates the editor directly; all note edits go through `vault.process()`.

#### Don't manage references to custom views — PASS
`registerView` uses a pure factory (`src/main.ts:139`); the view is always re-acquired via `workspace.getLeavesOfType(UNIFIED_VIEW_TYPE)` (`src/main.ts:513,588`). No view instance is stored on the plugin.

### Vault

#### Prefer Editor API / avoid `Vault.modify` — PASS
Zero `vault.modify()` calls. (Fix from old follow-up #135 re-verified.)

#### Use `Vault.process` for background edits — PASS
21 `vault.process()` call sites perform every note mutation atomically (e.g. `src/video/index.ts:178,284`, `src/summarize/index.ts:304,591`, `src/enrichment/enrichment-applier.ts`, `src/shared/file-utils.ts`).

#### Use `FileManager.processFrontMatter` for YAML — WARNING (documented, no action)
Frontmatter is parsed/serialized with Obsidian's `parseYaml`/`stringifyYaml` (`src/shared/frontmatter-utils.ts`) and written back **inside `vault.process()`**, so writes are atomic. The custom round-trip exists because every caller (`src/intake/index.ts:327,398,462`, `src/tidy/index.ts:158`, `src/enrichment/enrichment-applier.ts:112,163`) modifies body and frontmatter in the same atomic operation, which `processFrontMatter` (frontmatter-only) cannot express.

#### Prefer Vault API over Adapter API — FAIL ×2 (one fixed in this PR) + accepted use
- **Fixed in this PR**: `src/elaboration/proposer.ts:20` read a vault markdown note via `adapter.read()`; now `vault.getAbstractFileByPath()` + `vault.cachedRead()`.
- **FAIL → #280**: `src/video/index.ts:327` writes a downloaded video into the user's vault via `adapter.writeBinary()`; should be `vault.createBinary()` (needs collision handling + tests, so deferred to the follow-up).
- **Accepted adapter use (rationale for reviewers)**: the remaining ~60 adapter calls across 11 files (`src/elaboration/proposal-store.ts`, `src/enrichment/enrichment-store.ts`, `src/organize/organize-store.ts`, `src/deep-dive/deep-dive-store.ts`, `src/title/title-store.ts`, `src/rem/rem-store.ts`, `src/tidy/tidy-store.ts`, `src/shared/checkpoint-manager.ts`, `src/main.ts:729` migration) operate exclusively on the plugin's own `.synapse/` dot-folder (internal JSON proposal/checkpoint storage). Dot-folders are invisible to the Vault API by design, so the adapter is the only way to read/write them — this is the accepted community pattern for plugin-internal storage.

#### Avoid iterating all files to find a file by path — PASS
File lookup uses `getAbstractFileByPath()` (34 call sites). `getMarkdownFiles()` iteration only appears where a full scan is the feature (vault-wide scans). Note: `getFileByPath()`/`getFolderByPath()` (Obsidian 1.5.3+) are deliberately **not** used, keeping the `minAppVersion` floor at 1.1.0.

#### Use `normalizePath()` — PASS
Applied to user-defined and constructed paths in 12 files (all stores, `src/shared/file-utils.ts`, `src/shared/checkpoint-manager.ts`, `src/intake/index.ts`). One gap (the video download path join) is folded into #280.

### Editor

#### Reconfigure extensions with `updateOptions` — PASS (N/A)
No `registerEditorExtension` usage; nothing to reconfigure.

### Styling

#### No hardcoded styling — WARNING (folded into #278)
`styles.css` (992 lines) carries the plugin's styling; runtime style injection was removed (old follow-up #133 re-verified). Two static inline styles remain in `src/elaboration/proposal-modal.ts:48-49` and should move to a CSS class. Dynamic inline values (progress-bar width `src/views/unified-proposal-view.ts:350,1203`; range-slider geometry `src/transcription/time-range-slider.ts:153-154`) are data-driven and fine.

#### Use CSS variables — PASS
149 `var(--...)` references in `styles.css` against Obsidian's theme variables.

### TypeScript

#### Prefer `const`/`let` over `var` — PASS
Zero `var` declarations.

#### Prefer async/await over Promise chains — PASS
One `.then()` in `src/`; everything else is async/await.

---

## Submission requirements

| Item | Status | Evidence |
|------|--------|----------|
| Plugin ID valid, matches manifest, no "obsidian" in id/name | PASS | `manifest.json` — id `synapse`, name `Synapse` |
| `minAppVersion` accurate | **FAIL → fixed in this PR** | Was `0.15.0`; `vault.process()` (1.1.0) is the newest API used (21 call sites). Now `1.1.0`. `versions.json` `0.9.0` entry updated to `1.1.0` so the catalog never offers 0.9.0 to pre-1.1.0 apps. PR #136's old fix (`1.0.0`) was itself stale. |
| Description ≤250 chars, ends with period, action verb, no emoji | PASS | 97 chars: "Automatically elaborate, transcribe, enrich, summarize, organize, and connect your notes with AI." |
| `fundingUrl` only for funding | PASS | GitHub Sponsors + Buy Me a Coffee links |
| `isDesktopOnly` correct for Node/Electron use | PASS | `false`, with all Node use desktop-gated (see Mobile section) |
| Don't include plugin ID in command IDs | **FAIL → #276** | `src/commands/registry.ts:17-63` ids are `synapse:*`; Obsidian registers them as `synapse:synapse:*` |
| Remove sample code | PASS | None present |
| LICENSE present | PASS | AGPL-3.0 in `LICENSE`, matches `package.json` `license` field |

## Developer policies

| Item | Status | Evidence |
|------|--------|----------|
| No client-side telemetry | PASS | All network calls serve user-initiated features; nothing phones home |
| No ads | PASS | None |
| No self-update mechanism | PASS | None |
| No obfuscated code | PASS | Plain TypeScript, esbuild bundle |
| Clearly explain remote services used and why | **FAIL → #277** | No README disclosure section. Full network surface (all via `requestUrl()`): OpenAI chat + Whisper, Anthropic, Gemini (chat + audio transcription), Deepgram, Ollama (local) in `src/shared/ai-client.ts` / `src/audio/transcriber.ts`; Twitter oEmbed + fxtwitter/vxtwitter fallbacks in `src/shared/tweet-fetcher.ts`; generic article fetcher in `src/shared/content-fetcher.ts`. The old `fetch()`-for-FormData exception is gone — the transcriber hand-builds multipart bodies over `requestUrl()` (`src/audio/transcriber.ts:3-4`). |
| Disclose account requirements | **FAIL → #277** | Cloud providers require API keys; README does not state this as a requirement |
| File access outside vault disclosed | PASS (minor) | Only OS temp files for ffmpeg/yt-dlp round-trips (desktop media features); covered by #277's disclosure section |
| Respect licenses of borrowed code | PASS | No vendored third-party code |

## Other checks from issue #80

| Item | Status | Evidence |
|------|--------|----------|
| No modification of `.obsidian/` config | PASS | Zero references to `.obsidian` in `src/` |
| Settings saved when changed | PASS | 67 `saveSettings()` call sites — every control persists on change |
| No `eval()` / `Function()` constructor | PASS | Zero occurrences |
| No blocking the main thread | **WARNING → #279** | Sync `fs` reads/writes of whole media files in desktop pipelines (`src/video/index.ts:119,325`, `src/audio/index.ts:112,118,431,435`, `src/transcription/duration-detector.ts:41`). Startup work is deferred (checkpoint scan at +3s `src/main.ts:313`; elaboration startup scan at +5s `src/elaboration/index.ts:81`). |

## New-module review (added since the v0.1.0 audit)

| Module | Notes |
|--------|-------|
| `commands` | Central registrar + drift audit; no default hotkeys. **FAIL: double-prefixed ids (#276)**, see above. |
| `image` | Off-DOM canvas preprocessing (`preprocess.ts`); AI calls via shared `requestUrl()` client; no DOM/network violations. PASS. |
| `intake` | Exemplary lifecycle: `registerEvent` for vault listeners (`index.ts:84,87`), debounce timers cleared in `onunload` (`index.ts:92-99`), `normalizePath` on folders. PASS. |
| `pipeline` | Pure orchestration over other modules; no direct vault/network/DOM access. PASS. |
| `rem` | Store confined to `.synapse/` (accepted adapter pattern); applies links via `vault.process()`. PASS. |
| `title` | Same store pattern; suggestions applied through vault API. PASS. |
| `transcription` | `Platform.isDesktop` gates on every Node path (`duration-detector.ts:25,83`, `unified-modal.ts:68,127,164`); one inline-style WARNING (dynamic slider geometry — acceptable); sync `fs` write covered by #279. PASS with notes. |

## Re-verification of prior audit follow-ups (all closed, all confirmed fixed)

- **#132 (timers leaked on unload)** — timers tracked and cleared (`src/main.ts:67,313,387-390`, `src/elaboration/index.ts:92-100`, `src/intake/index.ts:92-99`).
- **#133 (style injection)** — replaced by `styles.css`; no `document.head` / `<style>` injection remains.
- **#134 (HTML headings in settings)** — all headings via `setHeading()`.
- **#135 (`vault.modify`)** — zero calls; fully migrated to `vault.process()`.
