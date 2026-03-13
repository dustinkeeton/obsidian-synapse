# Decision Log

Decisions listed in reverse chronological order.

---

## 2026-03-13: Tidy module uses immediate apply, no proposals

**Context**: The tidy feature (spelling/formatting correction) was being designed. Other modules (elaboration, enrichment) use a proposal-review workflow where changes are stored as JSON proposals and presented in a sidebar for user approval.

**Decision**: Tidy applies changes immediately to the note without a proposal step. A snapshot of the original content is saved to `.auto-notes/tidy-snapshots/` for undo capability.

**Alternatives considered**:
- Proposal workflow like elaboration/enrichment (adds friction for low-risk changes)
- Diff view showing before/after (complex UI for minimal benefit)
- No undo capability (risky if AI makes unwanted formatting changes)

**Rationale**: Tidy changes are cosmetic — spelling fixes and markdown formatting only, no content addition or removal. The risk of unwanted changes is low, and the undo command provides a safety net. A full proposal workflow would slow down a feature that should feel instant. One snapshot per file (overwriting previous) keeps storage bounded.

**Impact**: Users run `Tidy current note` and see changes immediately. If unsatisfied, `Undo last tidy` restores the original content. No sidebar review needed.

---

## 2026-03-13: Unified proposal view replaces per-module sidebars

**Context**: Elaboration and enrichment each had their own sidebar view classes (`ProposalReviewView`, `EnrichmentReviewView`) and their own modals. Users had to navigate between separate UI surfaces to review different types of proposals.

**Decision**: Create a single `UnifiedProposalView` in `src/views/` that displays both elaboration and enrichment proposals in one sidebar. The view has three rendering modes: list (all proposals grouped by note), elaboration review (editable textarea), and enrichment review (per-item checkboxes). Legacy view classes remain in the codebase but are not registered by `main.ts`.

**Alternatives considered**:
- Keep separate views (fragmented UX, multiple ribbon icons needed)
- Tabbed view with one tab per module (added complexity for two categories)
- Modal-only workflow without sidebar (less persistent, harder to browse)

**Rationale**: A single sidebar reduces cognitive overhead — users have one place to check for pending proposals. The `UnifiedItem` discriminated union (`kind: 'elaboration' | 'enrichment'`) keeps the data model clean. Color-coded cards (blue for elaboration, green for enrichment) provide visual distinction without separate views.

**Impact**: One ribbon icon (sparkles) opens all proposals. Legacy views are dead code but preserved for reference. The view is refreshed via callbacks from both modules through `main.refreshUnifiedView()`.

---

## 2026-03-13: Replace modals with inline review panes and clickable note links

**Context**: The initial proposal review flow used Obsidian `Modal` dialogs for viewing proposal details. Modals blocked interaction with the rest of the app and couldn't link back to source notes.

**Decision**: Replace modals with inline review panes within the unified sidebar view. Proposal headings are clickable links that open the source note in the main editor pane.

**Alternatives considered**:
- Keep modals (blocking, can't reference source note simultaneously)
- Open proposals in a new pane (too many panes)

**Rationale**: Inline review lets users see the proposal and the source note side by side. Clickable note links provide immediate navigation context. The sidebar persists while users navigate between notes.

**Impact**: Review workflow is non-blocking. Users can read the source note while deciding on a proposal.

---

## 2026-03-13: Centralized notification system with cancellation and two-phase vault scan

**Context**: Feature modules used ad-hoc `new Notice()` calls for progress reporting. Long-running operations (vault scans, batch transcriptions) had no cancellation mechanism, and there was no way to show progress or prevent duplicate operations.

**Decision**: Create `NotificationManager` in `src/shared/` providing:
- Tracked operations with animated status, progress counters, and cancel buttons
- Non-dismissible notices for running operations
- Confirmation snackbars (Proceed/Cancel) returning `Promise<boolean>`
- Status bar integration showing active operation count
- CSS injection for styled notices

Vault scanning uses a two-phase approach: Phase 1 scans without API calls, Phase 2 asks for confirmation before generating proposals (which costs API credits).

**Alternatives considered**:
- Per-module notification logic (duplicated, inconsistent)
- Obsidian's built-in `Notice` only (no cancellation, no progress, auto-dismisses)
- Custom status bar only without notices (not attention-getting enough)

**Rationale**: Centralized notifications ensure consistent UX across all modules. Cancellation is critical for operations that make paid API calls. The two-phase vault scan prevents accidental credit consumption when a scan finds many stub notes. All modules receive `NotificationManager` via constructor injection.

**Impact**: All modules use `NotificationManager` for user communication. Operations are cancellable via `handle.cancelled`. The confirmation snackbar gates expensive operations.

---

## 2026-03-13: Enrichment module with proximity-weighted tag scoring

**Context**: After notes are elaborated or transcribed, they lack connections to the rest of the vault — no tags, no links to related notes, no external references.

**Decision**: Add an enrichment module that analyzes vault structure to suggest tags, internal links, external references, and frontmatter attributes. Tag scoring uses a proximity-weighted algorithm: candidate tags are scored by how often they appear in nearby notes (same folder > sibling > cousin > distant), combined with vault-wide frequency. Internal links are resolved from graph hops, shared tags, and folder proximity.

**Alternatives considered**:
- AI-only suggestions without vault context (ignores existing vault structure)
- Simple frequency-based tagging (doesn't account for note relationships)
- Manual tagging reminders (no automation)

**Rationale**: Proximity weighting produces tags that are contextually relevant to where the note lives in the vault hierarchy, not just globally popular tags. The pure function `computeProximityWeight()` is testable and configurable via six weight parameters. Combining AI suggestions with vault analysis produces better results than either alone.

**Impact**: Notes gain contextual tags and connections automatically. The enrichment runs after elaboration acceptance or transcription completion (when `autoEnrich` is enabled), or manually via command.

---

## 2026-03-13: Cross-module callbacks wired in main.ts

**Context**: When an elaboration proposal is accepted or a transcription completes, the resulting note should be enriched automatically. Modules need to communicate completion events without direct dependencies on each other.

**Decision**: Wire callbacks in `main.ts` using simple function assignments:
- `elaboration.onProposalAccepted(filePath)` → `enrichment.enrich(filePath, 'elaboration')`
- `audio.onTranscriptionComplete(filePath)` → `enrichment.enrich(filePath, 'transcription')`
- `video.onTranscriptionComplete(filePath)` → `enrichment.enrich(filePath, 'transcription')`
- `elaboration.onViewRefreshNeeded()` → `main.refreshUnifiedView()`
- `enrichment.onViewRefreshNeeded()` → `main.refreshUnifiedView()`

Callbacks are only wired when enrichment is enabled and `autoEnrich` is true.

**Alternatives considered**:
- Event bus / pub-sub pattern (over-engineered for 5 connections)
- Direct module imports (creates circular dependencies)
- Obsidian events on the workspace (global, hard to type-check)

**Rationale**: Simple callback assignment in the orchestrator (`main.ts`) is explicit and easy to trace. Each module declares nullable callback properties; `main.ts` assigns them. No event system overhead, no subscription management, no circular dependencies.

**Impact**: Enrichment runs automatically after elaboration and transcription. View refresh is centralized. Adding new cross-module connections requires editing `main.ts`.

---

## 2026-03-13: Removed output folder settings from audio and video

**Context**: Audio and video modules originally had `outputFolder` settings specifying where transcription notes would be saved. These were redundant — transcriptions are inserted inline into the current note (audio) or saved alongside video metadata (video).

**Decision**: Remove `audio.outputFolder` and `video.outputFolder` settings. Video retains `downloadFolder` (for saving video files to vault) and `embedInNote` (for embedding video file links in notes).

**Alternatives considered**:
- Keep output folders as optional settings (unused code, confusing settings)
- Add output folder support later if needed (YAGNI)

**Rationale**: Both modules insert content inline into existing notes rather than creating new files in an output folder. Keeping unused settings confuses users and adds maintenance burden.

**Impact**: Settings schema is simpler. Video `downloadFolder` and `embedInNote` remain for the video file download feature.

---

## 2026-03-13: AI response sanitization strategy

**Context**: AI providers (OpenAI, Anthropic, Ollama) return text that gets written directly into vault notes. Obsidian renders markdown, which means certain HTML constructs and URI schemes could execute code if injected.

**Decision**: `sanitizeAIResponse()` strips: `<script>` tags with content, HTML event handlers (`onclick`, `onerror`, etc.), dangerous URI schemes (`javascript:`, `data:`, `vbscript:`), and embedding tags (`<iframe>`, `<embed>`, `<object>`). Applied to all AI output before vault writes. The tidy module additionally strips code fences that AI sometimes wraps responses in.

**Alternatives considered**:
- Full HTML sanitizer library (adds runtime dependency, over-engineered for markdown context)
- No sanitization, trust AI providers (risky — prompt injection is a real threat)
- Escape all HTML (breaks legitimate markdown rendering)

**Rationale**: Targeted stripping removes known dangerous patterns while preserving legitimate markdown and inline HTML that Obsidian renders safely. Defense-in-depth: even if AI output contains injected content, sanitization prevents execution. The pattern is applied consistently via a single shared function.

**Impact**: All AI-generated content is safe to render in Obsidian. Legitimate markdown formatting is preserved.

---

## 2026-03-13: Enrichment uses marker comments for idempotent updates

**Context**: Enrichment adds "Related Notes" and "References" sections to notes. If enrichment runs again on the same note (e.g., after re-elaboration), it needs to update these sections rather than duplicating them.

**Decision**: Wrap enrichment-added sections with HTML comment markers: `%% auto-notes-enrichment-start %%` and `%% auto-notes-enrichment-end %%`. On subsequent enrichments, content between markers is replaced. Undo removes everything between markers.

**Alternatives considered**:
- Heading-based detection only (fragile — user might have a heading with the same name)
- Frontmatter flags (doesn't help with body content sections)
- Append-only without updates (causes duplication)

**Rationale**: Obsidian comment syntax (`%% ... %%`) is invisible in reading view but preserved in source. Markers provide reliable boundaries for idempotent section updates without depending on heading text matching.

**Impact**: Enrichment can safely re-run on the same note. Users don't see the markers in reading view. Undo cleanly removes only enrichment-added content.

---

## 2026-03-13: Frontmatter key validation with allowlist pattern and forbidden keys

**Context**: Enrichment suggests frontmatter attributes via AI. Without validation, AI could suggest keys that cause prototype pollution (`__proto__`, `constructor`) or overwrite Obsidian-reserved keys.

**Decision**: Validate frontmatter keys against pattern `^[a-z][a-z0-9_-]{0,49}$` and block a forbidden keys list (`__proto__`, `constructor`, `prototype`, etc.). Never overwrite existing frontmatter keys — only add new ones.

**Alternatives considered**:
- No validation (prototype pollution risk)
- Strict allowlist of specific keys (too restrictive, can't adapt to vault conventions)
- Overwrite existing keys if AI suggests better values (data loss risk)

**Rationale**: The regex pattern is permissive enough for any reasonable frontmatter key while blocking injection vectors. The forbidden keys list catches the most dangerous prototype pollution keys. Never overwriting existing keys preserves user data.

**Impact**: AI-suggested frontmatter is safe to apply. Users keep their existing frontmatter values intact.

---

## 2026-03-12: TDD infrastructure with Vitest

**Context**: The project had no test framework despite having testable pure functions (URL detection, input validation) and injectable dependencies (AIClient, Transcriber). The codebase was growing and needed automated regression coverage.

**Decision**: Adopt Vitest 4.x as the test framework with the following infrastructure:
- `vitest.config.ts` at project root with globals enabled, node environment, and `src/**/*.test.ts` include pattern
- Centralized Obsidian mock at `src/__mocks__/obsidian.ts` with real class implementations for `TFile` and `TFolder` (so `instanceof` checks work in tests) and stubs for UI classes (`Modal`, `Plugin`, `Setting`, etc.)
- Setup file at `src/__test-utils__/setup.ts` that calls `vi.mock('obsidian')` globally
- Mock factories at `src/__test-utils__/mock-factories.ts` providing `mockFile()`, `createMockApp()`, `createMockPlugin()`, and `makeSettings()` helpers
- Test files co-located with source as `<name>.test.ts`
- Three npm scripts: `test` (single run), `test:watch`, `test:coverage`

**Alternatives considered**:
- Jest (heavier, slower startup, more configuration required for ESM/TypeScript)
- No tests, rely on manual QA (unsustainable as features grow)
- End-to-end tests with real Obsidian (fragile, slow, hard to automate)

**Rationale**: Vitest is fast, has native TypeScript and ESM support, and integrates well with the esbuild-based build pipeline. The centralized Obsidian mock means every test file automatically gets stubs for all Obsidian APIs without per-file setup. Real `TFile`/`TFolder` class implementations (instead of plain objects) ensure `instanceof` checks in production code work correctly in tests.

**Impact**: Tests can be run with `npm test`. Test suites cover URL detection, weight calculation, validation, frontmatter parsing, enrichment store, tidy store, and notifications. The TDD skill (`/tdd`) guides the Red-Green-Refactor workflow for new features.

---

## 2026-03-12: Security hardening — defense-in-depth approach

**Context**: A security audit reviewed the plugin for input validation gaps, output sanitization, credential handling, and subprocess security.

**Decision**: Implement a comprehensive security layer:
- `shared/validation.ts` with `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()`, `sanitizeAIResponse()`
- `execFile` over `exec` for all subprocess calls (no shell invocation)
- `safeRequest()` wrapper for `requestUrl` with error body extraction and key redaction
- Password masking on all API key input fields
- Ollama endpoint protocol validation (HTTPS required, HTTP only for localhost)
- API key redaction in error messages
- 5-minute timeouts and 10MB buffer limits on all external calls
- Frontmatter key validation against allowlist + forbidden keys

**Alternatives considered**:
- Minimal hardening (validate only user-visible inputs)
- Third-party security libraries (adds runtime dependencies, violates zero-deps policy)
- No output sanitization (assumes AI providers return safe content)

**Rationale**: Defense-in-depth: multiple independent layers ensure a bypass in one layer does not compromise the system. Centralized in `shared/validation.ts` for easy auditing.

**Impact**: All external interactions are validated and sanitized. No user-facing behavior changes except masked API key fields and more descriptive error messages.

---

## 2026-03-12: VideoModule delegates transcription to AudioModule

**Context**: Video transcription requires downloading a video, extracting audio, and then transcribing it — the same pipeline AudioModule already provides.

**Decision**: VideoModule accepts AudioModule as a constructor argument and calls `AudioModule.transcribe()` for the transcription step.

**Alternatives considered**:
- Duplicate transcription logic in VideoModule
- Create a shared transcription service extracted from both modules

**Rationale**: Keeps transcription logic in one place. The dependency is one-directional (Video → Audio). Audio must be initialized before Video in `main.ts`.

**Impact**: Audio and Video modules are not fully independent. Audio must always be loaded if Video is enabled.

---

## 2026-03-12: Non-destructive proposal storage in `.auto-notes/`

**Context**: AI-generated elaborations and enrichments should never modify a user's notes without explicit consent. Proposals need to survive plugin reloads and Obsidian restarts.

**Decision**: Store proposals as JSON files in `.auto-notes/proposals/` (elaboration) and `.auto-notes/enrichments/` (enrichment). Each proposal is a separate file with metadata and proposed content. Tidy snapshots are stored in `.auto-notes/tidy-snapshots/`.

**Alternatives considered**:
- In-memory only (lost on reload)
- Single database file (merge conflicts, corruption risk)
- Frontmatter annotations on original notes (modifies user files)

**Rationale**: JSON files are human-inspectable, diffable, and survive reloads. Individual files avoid corruption cascading across proposals. The `.auto-notes/` folder is excluded from elaboration/enrichment scanning by default.

**Impact**: Vault contains a `.auto-notes/` folder with three subdirectories. Users can inspect, back up, or delete proposal/snapshot files manually.

---

## 2026-03-12: Modular architecture with FeatureModule contract

**Context**: The plugin has five distinct features that share infrastructure but are otherwise independent.

**Decision**: Each feature is a self-contained module following a common contract: `constructor(plugin, getSettings, notifications)`, `onload()`, `onunload()`. Modules are conditionally loaded based on settings. A shared utilities layer (`src/shared/`) provides cross-cutting concerns.

**Alternatives considered**:
- Monolithic single-file plugin
- Separate plugins per feature
- Event-bus architecture with loose coupling

**Rationale**: The module pattern balances isolation with simplicity. Features can be independently enabled/disabled. The `getSettings()` closure ensures modules always read fresh settings without event wiring.

**Impact**: Adding a new feature means creating a new module directory and wiring it in `main.ts`. Five modules currently follow this pattern: elaboration, audio, video, enrichment, tidy.

---

## 2026-03-12: Zero runtime npm dependencies

**Context**: Obsidian community plugins are reviewed for security and bundle size. Runtime dependencies increase both risk and review burden.

**Decision**: Zero runtime npm dependencies. All external API calls use Obsidian's `requestUrl` or native `fetch`. External tools (yt-dlp, ffmpeg) are invoked as subprocesses.

**Alternatives considered**:
- Use SDK packages for OpenAI, Anthropic, Deepgram
- Bundle a minimal HTTP client library

**Rationale**: Keeps the bundle small and avoids supply chain risk. API calls are simple enough to implement directly.

**Impact**: API integration code is hand-rolled but the plugin has no transitive dependency risk.

---

## 2026-03-12: Provider-specific model dropdowns

**Context**: The original model setting was a free-text input where users typed model identifiers. Typos caused silent API failures.

**Decision**: Replace free-text with dropdowns populated from `MODEL_OPTIONS`, keyed by provider. Anthropic uses simplified names mapped to full API IDs by `resolveModelId()`.

**Alternatives considered**:
- Free-text with validation (still requires users to know model IDs)
- Fetching available models from API at runtime (requires valid API key first)

**Rationale**: Eliminates typo risk and shows only relevant models per provider.

**Impact**: Users pick from curated lists. Adding a model requires updating `MODEL_OPTIONS` in `settings.ts`.

---

## 2026-03-12: `isDesktopOnly: true` in manifest

**Context**: The plugin uses `child_process` for yt-dlp/ffmpeg execution — Node.js APIs unavailable on mobile.

**Decision**: Mark the plugin as desktop-only in `manifest.json`.

**Alternatives considered**:
- Graceful degradation (disable video features on mobile)
- API-based video processing service

**Rationale**: Core video functionality depends on local CLI tools. Desktop-only is clearly communicated.

**Impact**: Plugin will not appear in Obsidian's mobile plugin browser.

---

## 2026-03-12: Whisper API as default transcription provider with key fallback

**Context**: Audio transcription needs a reliable backend. Users may use Anthropic or Ollama as their AI provider, meaning their shared API key isn't an OpenAI key.

**Decision**: Default to OpenAI Whisper API. Add dedicated `audio.whisperApiKey` with fallback: `whisperApiKey || ai.apiKey`. The settings UI conditionally shows the Whisper key field only when needed.

**Alternatives considered**:
- Always require a separate Whisper key (redundant for OpenAI users)
- Require OpenAI as AI provider to use Whisper (unnecessarily restrictive)

**Rationale**: Zero extra configuration for OpenAI users; clear prompt for others. Conditional UI keeps settings clean.

**Impact**: Anthropic/Ollama users who want Whisper see an additional key field. OpenAI users see no change.

---

## 2026-03-12: yt-dlp for URL-based media fetching with PATH resolution

**Context**: Video transcription needs to download from YouTube/TikTok. Obsidian runs in Electron with a minimal PATH.

**Decision**: Use yt-dlp (external CLI) via `execFile`. A `shellEnv()` function prepends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH for subprocess calls. Use `os.tmpdir()` for temp files instead of vault-relative paths.

**Alternatives considered**:
- Require absolute paths in settings (poor UX)
- Use `shell: true` for PATH inheritance (reintroduces injection risk)

**Rationale**: Covers most installations automatically while preserving `execFile` security.

**Impact**: yt-dlp/ffmpeg found automatically on most systems. Users can verify via the dependency check command.
