# MVP Product Requirements Document -- Obsidian Community Plugin Release

**Plugin**: Auto Notes
**Version**: 0.1.0
**Date**: 2026-03-17
**Status**: Draft -- items marked with checkboxes for tracking

This document serves as a checklist and roadmap for releasing Auto Notes as an Obsidian community plugin. Each item is marked as done `[x]`, needs work `[ ]`, or partial `[~]`.

---

## Table of Contents

1. [Security Audit](#1-security-audit)
2. [Settings Audit](#2-settings-audit)
3. [Mobile Compatibility](#3-mobile-compatibility)
4. [Test Coverage](#4-test-coverage)
5. [Feature Completeness](#5-feature-completeness)
6. [User-Facing Documentation](#6-user-facing-documentation)
7. [Obsidian Submission Requirements](#7-obsidian-submission-requirements)
8. [Build and Release Pipeline](#8-build-and-release-pipeline)
9. [UX Polish](#9-ux-polish)

---

## 1. Security Audit

- [x] **No hardcoded secrets or API keys in source** -- Grep for `sk-`, `api_key`, `secret`, `token`, `password` patterns found zero matches in `src/`. All API keys come from user settings.
- [x] **API keys stored in Obsidian settings** -- Keys stored via `plugin.saveData()`, which Obsidian encrypts at rest in `data.json`. Keys are never written to note content.
- [x] **No network calls without user consent** -- All AI/transcription calls are triggered by explicit user commands or opt-in settings (`autoEnrich`, `scanOnStartup`). No telemetry or analytics.
- [x] **Input sanitization on user-provided content** -- `shared/validation.ts` provides `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()`, and `sanitizeAIResponse()`. URLs reject non-HTTP schemes and shell metacharacters. Paths reject traversal (`..`) and null bytes.
- [x] **AI response sanitization** -- `sanitizeAIResponse()` strips `<script>` tags, HTML event handlers, `javascript:` / `data:` URIs, and `<iframe>` / `<embed>` / `<object>` tags from all AI output before writing to notes.
- [x] **Subprocess security** -- `video/audio-extractor.ts` uses `execFile` with argument arrays (no shell interpolation). Defense-in-depth: URL/path validation happens before subprocess invocation.
- [x] **API key redaction in errors** -- `redactSecrets()` in `shared/ai-client.ts` strips key patterns (`sk-`, `key-`, `dg-`, `Bearer`, etc.) from error messages. `NotificationManager.notifyError()` also applies the same redaction before displaying to users.
- [x] **Ollama HTTPS enforcement** -- `ai-client.ts` requires HTTPS for non-localhost Ollama endpoints. Settings tab validates this at input time; the client enforces again at call time.
- [x] **Prototype pollution protection** -- `deepMerge()` in `main.ts` (lines 291-315) skips `__proto__`, `constructor`, and `prototype` keys during settings merge.
- [x] **Frontmatter safety** -- `enrichment/enrichment-applier.ts` validates key names with regex and maintains a forbidden keys blocklist.
- [x] **.gitignore covers sensitive files** -- `.env`, `.env.*`, `data.json` (Obsidian settings with API keys), and `.auto-notes/` are all gitignored.
- [ ] **CSP compliance for Obsidian sandbox** -- Not explicitly verified. Obsidian's Electron sandbox imposes Content Security Policy restrictions. The plugin uses `requestUrl` (Obsidian's CSP-compliant HTTP wrapper) for AI calls, but audio transcription uses native `fetch` + `FormData` directly. **Next step**: Verify that native `fetch` calls in `audio/transcriber.ts` work within Obsidian's CSP. Consider migrating to `requestUrl` with binary body support if not.

---

## 2. Settings Audit

- [x] **All settings have sensible defaults** -- `DEFAULT_SETTINGS` in `src/settings.ts` provides defaults for every field. Key defaults: `provider: 'openai'`, `model: 'gpt-4o'`, `temperature: 0.7`, `maxTokens: 2048`, all features enabled. API keys default to empty string (user must configure).
- [x] **Settings descriptions are clear and user-friendly** -- Every setting in `settings-tab.ts` has a `setName()` and `setDesc()` with plain-language descriptions. Technical terms are explained (e.g., "Notes with fewer words than this are considered stubs").
- [x] **API key fields use password-type inputs** -- All API key fields (`ai.apiKey`, `audio.whisperApiKey`, `audio.deepgramApiKey`) set `text.inputEl.type = 'password'` and `autocomplete = 'off'`.
- [x] **Model selections are validated** -- Model dropdowns are populated from `MODEL_OPTIONS` constant (not free text). Provider change auto-resets model to first option for the new provider. Invalid model values are caught and reset on display.
- [x] **Deep merge preserves user settings on upgrade** -- `loadSettings()` uses `deepMerge(DEFAULT_SETTINGS, savedData)` so new settings get defaults without losing existing user configuration.
- [~] **Settings migration path for future versions** -- Deep merge handles additive changes (new settings get defaults). However, there is no formal migration system for breaking changes (renamed keys, removed settings, changed types). **Next step**: Document the deep-merge strategy as sufficient for 0.x releases. Consider adding a `settingsVersion` field and explicit migration logic before 1.0.
- [ ] **Max tokens setting not exposed in UI** -- `ai.maxTokens` has a default (2048) but no settings UI control. Users cannot adjust this without editing `data.json` manually. **Next step**: Add a slider or text input in the AI Configuration section of the settings tab.
- [ ] **Language setting not exposed in UI** -- `audio.language` setting exists (for transcription language hint) but has no UI control. **Next step**: Add a text input or dropdown in Audio Transcription settings.

---

## 3. Mobile Compatibility

- [x] **Plugin supports mobile** -- `manifest.json` has `"isDesktopOnly": false`. Mobile support added in v0.4.0 milestone (#96).
- [x] **Desktop-only features gated behind `Platform.isDesktop`** -- `VideoModule` is only instantiated on desktop (`main.ts`). `AudioExtractor` (which has top-level `require('child_process')`) is never loaded on mobile.
- [x] **Status bar item gated** -- `addStatusBarItem()` wrapped in `Platform.isDesktop` check (mobile doesn't support status bar items).
- [x] **Settings hidden on mobile** -- Video Transcription settings section and `local-whisper` provider option are hidden via `Platform.isDesktop` checks in `settings-tab.ts`.
- [x] **Commands/ribbon gated** -- `mic` ribbon icon is desktop-only. Transcription commands only register when audio is enabled or video is available (desktop).
- [x] **Unified modal adapted** -- Video URL input section hidden on mobile in `unified-modal.ts`.
- [x] **Portable path resolution** -- `ensureWithinVault()` in `shared/validation.ts` replaced `require('path')` with string-based path normalization that works on all platforms.
- [x] **Mobile-responsive CSS** -- `@media (max-width: 768px)` queries added for sliders, modal actions, and proposal editor (#100).

### Per-Feature Mobile Compatibility Matrix

| Feature | Mobile Status | Dependency | Notes |
|---------|:------------:|------------|-------|
| Elaboration | Ready | `requestUrl` | Fully compatible |
| Enrichment | Ready | `requestUrl` | Fully compatible |
| Summarize | Ready | `requestUrl` | Video URL summarization falls back to error on mobile |
| Tidy | Ready | `requestUrl` | Fully compatible |
| Organize | Ready | `requestUrl` | Fully compatible |
| Deep Dive | Ready | `requestUrl` | Fully compatible |
| Audio Transcription (Whisper API) | Ready | `fetch` + `FormData` | CSP verification pending |
| Audio Transcription (Deepgram) | Ready | `fetch` + `FormData` | CSP verification pending |
| Audio Transcription (Local Whisper) | Desktop-only | `execFile` | Hidden from provider dropdown on mobile |
| Video Transcription | Desktop-only | `execFile` (yt-dlp, ffmpeg) | Module not loaded on mobile; UI hidden |

### Remaining Mobile Items

- [ ] **CSP verification** -- Verify `fetch` + `FormData` in `audio/transcriber.ts` works within Obsidian mobile sandbox. Migrate to `requestUrl` if needed.
- [ ] **Test on Android** -- Sideload and verify all mobile-ready features work.
- [ ] **Test on iOS** -- Sideload and verify all mobile-ready features work.

---

## 4. Test Coverage

Test infrastructure: **Vitest** with co-located test files (`*.test.ts` next to source files). All 419 tests pass.

### Overall Coverage

| Metric | Coverage |
|--------|----------|
| Statements | 51.28% |
| Branches | 44.39% |
| Functions | 55.94% |
| Lines | 51.62% |

### Per-Module Breakdown

| Module | Stmts | Branch | Funcs | Lines | Notes |
|--------|:-----:|:------:|:-----:|:-----:|-------|
| settings.ts | 100% | 100% | 100% | 100% | Fully covered |
| audio/ | 15.78% | 27.53% | 9.09% | 15.6% | Only `note-scanner.ts` tested; `index.ts`, `transcriber.ts`, `post-processor.ts` at 0% |
| deep-dive/ | 57.53% | 47.68% | 67.12% | 57.23% | Store, quality scorer, syllabus navigator, topic analyzer tested. `index.ts` at 6%, `note-generator.ts` at 0% |
| elaboration/ | 56.09% | 39.68% | 66.66% | 56.98% | Detector, proposer, store tested. `index.ts` at 19% |
| enrichment/ | 58.67% | 46.74% | 71.42% | 59.94% | Strong coverage on classifiers, extractors, analyzers. `enrichment-applier.ts` at 2%, `link-resolver.ts` at 17% |
| organize/ | 39.54% | 29.74% | 57.14% | 39.62% | Content analyzer, directory matcher, store tested. `index.ts` at 0% |
| shared/ | 59.54% | 47.02% | 59.3% | 59.85% | Callouts, frontmatter, notifications tested. `ai-client.ts` at 5%, `api-utils.ts` at 0%, `slider-helper.ts` at 0% |
| summarize/ | 53.71% | 61.38% | 43.47% | 54.89% | Summarizer, note scanner tested. `index.ts` at 42% |
| tidy/ | 96.92% | 75% | 88.23% | 96.87% | Best-covered module |
| video/ | 21.78% | 26.31% | 13.79% | 21.05% | URL detector and note scanner tested. `index.ts` at 0%, `audio-extractor.ts` at 6% |

### Untested Critical Paths

- [ ] **AIClient (5% coverage)** -- The central AI integration layer. All three provider paths (OpenAI, Anthropic, Ollama) are untested. Mocking `requestUrl` would enable testing.
- [ ] **Module orchestrators (index.ts files)** -- Most module entry points are at 0-20% coverage. These contain the command registration, workflow logic, and inter-module wiring.
- [ ] **Enrichment applier (2%)** -- The code that actually writes enrichment changes to notes is nearly untested.
- [ ] **Audio transcriber (0%)** -- No tests for the transcription routing logic (Whisper vs. Deepgram vs. local).
- [ ] **Video audio extractor (6%)** -- Subprocess management for yt-dlp/ffmpeg is untested.

### Assessment

- [~] **Test coverage is adequate for MVP** -- Pure logic (detectors, scorers, analyzers, stores) is well-tested. Integration points (module orchestrators, AI client, file I/O) are weak. This is acceptable for an initial community release but should improve before 1.0. **Next step**: Prioritize tests for `ai-client.ts` and module orchestrator happy paths.

---

## 5. Feature Completeness

### Module Status Matrix

| Module | Status | MVP Ready | Notes |
|--------|--------|:---------:|-------|
| **Elaboration** | Working | Yes | Detection + proposals + sidebar review all functional |
| **Audio Transcription** | Working | Yes | Whisper API and Deepgram work. Local Whisper not implemented (throws). |
| **Video Transcription** | Working | Yes | YouTube/TikTok download + transcribe works. Requires yt-dlp + ffmpeg. |
| **Transcription UI** | Working | Yes | Unified modal (issue #20) consolidates 4 old modals into 2. |
| **Enrichment** | Working | Yes | Tags, links, refs, frontmatter. Vault-wide scan. Undo support. |
| **Summarize** | Working | Yes | URL + transcription summaries. Inline and standalone note modes. |
| **Tidy** | Working | Yes | Spelling/formatting with undo. Best-tested module. |
| **Organize** | Working | Yes | AI-based directory proposals with undo. |
| **Deep Dive** | Working | Yes | Recursive topic exploration. BFS generation with quality gating. |

### Features to Disable/Hide for MVP

- [~] **Local Whisper provider** -- Listed in the transcription provider dropdown but throws "not implemented" on use. **Next step**: Either implement it, or hide the option from the dropdown and document it as planned.
- [~] **Local video file transcription** -- Shows "coming soon" notice. **Next step**: Either implement or remove the code path that references it.
- [~] **Frame extraction** -- `FrameExtractionSettings` exist in settings with UI controls (enable toggle, interval, vision model, max frames) but the feature is entirely placeholder. Settings are visible but non-functional. **Next step**: Remove frame extraction settings from the settings tab until the feature is implemented. Keep the types for forward compatibility.
- [~] **supportedPlatforms toggles** -- `video.supportedPlatforms.youtube` and `.tiktok` settings exist but are not enforced in the video module. **Next step**: Either enforce the toggles or remove them from settings.

### All Features Are MVP-Ready

- [x] All 8 core modules are working and user-accessible via commands and/or the sidebar.
- [x] Unified proposal sidebar consolidates 4 proposal types (elaboration, enrichment, organize, deep dive).
- [x] Undo support exists for enrichment, tidy, and organize.
- [x] All AI operations have loading states (tracked operations with cancel buttons).
- [ ] Vault-wide scan commands exist for elaboration, enrichment, summarize, and organize, but none have been stress-tested on large vaults (1000+ notes). **Next step**: Test vault-wide operations on a large vault and add safety limits if needed.

---

## 6. User-Facing Documentation

- [ ] **README exists** -- No `README.md` at the repository root. PR #69 (from Issue #15) is referenced but not yet merged. **Next step**: Merge or create README with: feature overview, installation instructions, configuration guide, usage examples, and screenshots.
- [ ] **LICENSE file exists** -- No `LICENSE` file at the repository root. `package.json` declares `"license": "MIT"` but the actual license text is missing. **Next step**: Add a `LICENSE` file with the MIT license text. Obsidian community plugin guidelines require a license file.
- [x] **In-app help/descriptions for settings** -- Every setting in the settings tab has a name and description. Descriptions explain what each setting does in plain language.
- [x] **Error messages are user-friendly** -- `NotificationManager` prefixes all messages with "Auto Notes:" and uses color-coded notices (info, progress, success, warning, error). API errors are redacted and shown in a readable format. Operations show progress counters (e.g., "Scanning 3/5").
- [ ] **CHANGELOG** -- No CHANGELOG.md exists. **Next step**: Create a CHANGELOG.md with release notes for 0.1.0 (or adopt GitHub Releases for this).

---

## 7. Obsidian Submission Requirements

Reference: [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)

- [x] **manifest.json has all required fields** -- `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly` are all present. Current values:
  - `id`: `auto-notes`
  - `name`: `Auto Notes`
  - `version`: `0.1.0`
  - `minAppVersion`: `0.15.0`
  - `description`: `AI-powered note elaboration, audio transcription, and video transcription for Obsidian`
  - `author`: `Dustin Keeton`
  - `isDesktopOnly`: `false`
- [~] **manifest.json optional fields** -- Missing `authorUrl` and `fundingUrl`. These are optional but recommended. **Next step**: Add `authorUrl` (GitHub profile or website) and optionally `fundingUrl`.
- [x] **Plugin ID follows naming conventions** -- `auto-notes` uses lowercase with hyphens, no special characters. Follows the `kebab-case` convention.
- [~] **No banned APIs used** -- The plugin uses `requestUrl` (recommended) for most HTTP calls. However, it uses native `fetch` for audio transcription (Whisper/Deepgram) because `requestUrl` does not natively support `FormData` / multipart uploads. `execFile` is used for subprocess management but only on desktop (`Platform.isDesktop` guard prevents loading on mobile). **Next step**: Verify with Obsidian review team that native `fetch` usage for multipart uploads is acceptable, or find a `requestUrl`-based workaround.
- [ ] **Follows Obsidian plugin guidelines (full audit)** -- A comprehensive audit against the [full guidelines checklist](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) has not been performed. **Next step**: Walk through every item in the Obsidian plugin guidelines document and verify compliance. Key areas to check:
  - No modification of `.obsidian/` config files
  - No accessing `app.vault.adapter` directly for operations available through `vault` API
  - Settings are saved when changed (currently saves on every individual setting change -- this is correct)
  - Plugin cleans up after itself on unload (each module has `onunload()`)
- [x] **versions.json exists** -- `versions.json` maps `"0.1.0"` to `"0.15.0"` (minimum Obsidian version). This file is required for the plugin auto-update system.
- [ ] **Plugin description is compelling** -- Current description is functional but could be more appealing. **Next step**: Revise to highlight key user benefits (e.g., "Automatically elaborate, transcribe, enrich, summarize, and organize your notes with AI").

---

## 8. Build and Release Pipeline

- [x] **Production build works** -- `node esbuild.config.mjs production` completes successfully. Output: `main.js` (285 KB, bundled, tree-shaken, no sourcemap).
- [x] **Release artifacts are generated** -- The three required files exist:
  - `main.js` -- Plugin entry point (285 KB)
  - `manifest.json` -- Plugin metadata
  - `styles.css` -- Custom styles (93 lines: video height cap, slider styles, callout theming)
- [ ] **GitHub Actions for CI/CD** -- No `.github/workflows/` directory exists. No automated testing or release pipeline. **Next step**: Create a CI workflow that runs on PR:
  - `npx tsc --noEmit --skipLibCheck` -- type checking
  - `npm test` -- test suite
  - `node esbuild.config.mjs production` -- build verification
  Create a release workflow triggered by tags that:
  - Builds the production bundle
  - Creates a GitHub Release with `main.js`, `manifest.json`, `styles.css` attached
  - Updates `versions.json`
- [~] **Versioning strategy** -- Currently `0.1.0` in both `package.json` and `manifest.json`. No automated version bumping. **Next step**: Decide on versioning approach:
  - Option A: Manual version bumps in `package.json` and `manifest.json` before tagging
  - Option B: GitHub Action that reads version from `manifest.json` on tag push
  - Semantic versioning: use 0.x.y during pre-release, 1.0.0 for first stable
- [ ] **main.js is gitignored** -- `main.js` is in `.gitignore`, which is correct for development but means it is not in the repository. Obsidian community plugins require `main.js` to be downloadable from GitHub Releases (not committed to the repo). **Next step**: Confirm the release workflow attaches `main.js` as a release asset rather than committing it to the repo.

---

## 9. UX Polish

- [x] **Loading states for AI operations** -- `NotificationManager.startOperation()` creates a persistent, non-dismissible notice with animated ellipsis, progress counter updates, and a Cancel button. Status bar shows operation summary.
- [x] **Error handling with user-friendly messages** -- All modules use `notifyError(context, error)` which: prefixes with "Auto Notes:", redacts API keys, shows for 8 seconds, logs to console. No raw stack traces shown to users.
- [x] **Settings UI is organized and intuitive** -- Settings are grouped under clear headings: AI Configuration, Note Elaboration, Media Transcription (with Audio/Video subheadings), Note Enrichment (with Proximity Weights/Tag Vocabulary subsections), Summarize, Note Tidy, Note Organize, Deep Dive. Sliders have tick marks, labels, and current-value display.
- [x] **Commands are well-named in the command palette** -- 21 commands follow "Action target" naming pattern. Examples: "Open proposal review sidebar", "Transcribe media", "Enrich current note", "Scan vault", "Undo enrichment".
- [x] **Confirmation dialogs for destructive operations** -- Vault-wide scans prompt "Found N eligible notes. Proceed?" before making AI calls. Cancel button on all long-running operations.
- [x] **Visual identity for AI content** -- All AI-generated content uses Obsidian callouts from a shared registry (`auto-notes-summary`, `auto-notes-transcription`, etc.) with distinct colors and Lucide icons. Users can always identify which content was AI-generated.
- [x] **Ribbon icons** -- Two ribbon icons: sparkles (proposal review sidebar) and mic (transcribe media).
- [~] **Settings UI for advanced features** -- Some settings lack UI controls (see Settings Audit: maxTokens, language). Frame extraction settings are visible but non-functional. **Next step**: Address the items flagged in the Settings Audit section.
- [ ] **First-run experience** -- No onboarding flow or welcome message for new users. The plugin is functional but requires users to discover features through the command palette and settings. **Next step**: Consider adding a one-time notice on first install pointing users to the README or settings, or a minimal "Getting Started" modal.

---

## Summary: What Blocks Release

### Must-Fix Before Submission

| Item | Section | Effort |
|------|---------|--------|
| Add README.md | 6 | Medium (PR #69 pending or new) |
| Add LICENSE file (MIT) | 6 | Trivial |
| Create GitHub Actions CI workflow | 8 | Medium |
| Create GitHub Actions release workflow | 8 | Medium |
| Hide frame extraction settings from UI | 5 | Small |
| Full Obsidian plugin guidelines audit | 7 | Medium |

### Should-Fix Before Submission

| Item | Section | Effort |
|------|---------|--------|
| Hide or implement local Whisper provider | 5 | Small (hide) or Large (implement) |
| Remove "coming soon" video file transcription stub | 5 | Small |
| Remove or enforce supportedPlatforms toggles | 5 | Small |
| Add `authorUrl` to manifest.json | 7 | Trivial |
| Revise plugin description for appeal | 7 | Small |
| Expose maxTokens setting in UI | 2 | Small |
| Expose language setting in UI | 2 | Small |
| Verify native `fetch` CSP compliance | 1 | Small |

### Nice-to-Have for 0.1.0

| Item | Section | Effort |
|------|---------|--------|
| First-run onboarding experience | 9 | Medium |
| CHANGELOG.md | 6 | Small |
| Improve test coverage (AI client, orchestrators) | 4 | Large |
| Stress-test vault-wide operations on large vaults | 5 | Medium |
| Settings migration system | 2 | Medium |

---

## Appendix: Command Registry (21 commands)

| Module | Command | ID |
|--------|---------|-----|
| Main | Open proposal review sidebar | `auto-notes:review-proposals` |
| Main | Transcribe media | `auto-notes:transcribe-media` |
| Main | Transcribe media from current note | `auto-notes:transcribe-note-media` |
| Elaboration | Scan vault for stubs | `auto-notes:elaboration-scan-vault` |
| Elaboration | Scan current note | `auto-notes:elaboration-scan-note` |
| Elaboration | Clear all proposals | `auto-notes:elaboration-clear` |
| Video | Check dependencies | `auto-notes:video-check-deps` |
| Enrichment | Enrich current note | `auto-notes:enrichment-enrich-note` |
| Enrichment | Scan vault for enrichment | `auto-notes:enrichment-scan-vault` |
| Enrichment | Undo enrichment | `auto-notes:enrichment-undo` |
| Summarize | Summarize current note | `auto-notes:summarize-note` |
| Summarize | Scan vault for summarization | `auto-notes:summarize-scan-vault` |
| Tidy | Tidy current note | `auto-notes:tidy-note` |
| Tidy | Undo tidy | `auto-notes:tidy-undo` |
| Organize | Organize current note | `auto-notes:organize-note` |
| Organize | Scan directory | `auto-notes:organize-scan-directory` |
| Organize | Undo organize | `auto-notes:organize-undo` |
| Deep Dive | Deep dive into note | `auto-notes:deep-dive-note` |
| Deep Dive | Clear deep dive proposals | `auto-notes:deep-dive-clear` |

## Appendix: External Dependencies

| Dependency | Required By | User Action | Status |
|------------|-------------|-------------|--------|
| yt-dlp | Video transcription | Install and add to PATH | Auto-detected; check command available |
| ffmpeg | Audio extraction from video | Install and add to PATH | Auto-detected; check command available |
| OpenAI API key | Whisper, GPT models | Enter in settings | Password-masked input |
| Anthropic API key | Claude models | Enter in settings | Password-masked input |
| Deepgram API key | Deepgram transcription | Enter in settings (optional) | Password-masked input |
| Ollama | Local AI (optional) | Run Ollama server | HTTPS required for non-localhost |
