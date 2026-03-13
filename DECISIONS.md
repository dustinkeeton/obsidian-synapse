# Decision Log

Decisions listed in reverse chronological order.

---

## 2026-03-12: Inline note audio transcription with in-place insertion

**Context**: Users often embed audio recordings directly in their notes (e.g., `![[meeting-recording.mp3]]`). The existing audio transcription workflow required opening a file-picker modal, selecting a file, and saving the transcription as a separate note -- disconnected from the note where the audio was referenced.

**Decision**: Add a new command "Transcribe audio from current note" (`auto-notes:transcribe-note-audio`) as an `editorCallback`. It scans the active note for audio embed syntax (`![[file.mp3]]`), presents a selection modal (`NoteAudioModal`), and inserts transcriptions as blockquote blocks directly below each embed in the same note.

**Alternatives considered**:
- Transcribe to separate files and link them back (breaks context -- user has to navigate away)
- Automatically transcribe all embeds without prompting (expensive, no user control)
- Use a sidebar panel instead of inline insertion (harder to read in context)

**Rationale**: Inline insertion keeps the transcription visually tied to the audio it came from. The blockquote format (`> **Transcription of file.mp3**`) is visually distinct and collapsible in many themes. Processing embeds in reverse line order prevents line-number shifts from invalidating subsequent insertions. A 2-second delay between API calls avoids rate limiting. Already-transcribed embeds are detected and skipped automatically.

**Impact**: Users can transcribe audio directly from the note they are reading. The note is modified in-place via `vault.modify()`. The `AudioEmbed` interface and `NoteAudioModal` class are currently in `note-audio-modal.ts` rather than `types.ts` -- a known deviation from the project's types-in-types.ts convention, flagged for future cleanup.

---

## 2026-03-12: Anthropic model IDs updated to current API versions

**Context**: Anthropic released new model versions. The `ANTHROPIC_MODEL_MAP` in `ai-client.ts` mapped simplified names (opus, sonnet, haiku) to specific dated API IDs that needed updating.

**Decision**: Update model IDs to: `opus` -> `claude-opus-4-6`, `sonnet` -> `claude-sonnet-4-6`, `haiku` -> `claude-haiku-4-5-20251001`. These reflect the current Anthropic API model identifiers.

**Alternatives considered**:
- Use undated model aliases if Anthropic supported them (they require specific IDs)
- Let users type model IDs directly (reverts the dropdown decision -- error-prone)

**Rationale**: Keeping model IDs current ensures API calls succeed. The `resolveModelId()` pattern means only one line per model needs updating when Anthropic releases new versions.

**Impact**: Users selecting Anthropic models get the latest model versions automatically. No settings migration needed -- simplified names (`opus`, `sonnet`, `haiku`) are unchanged.

---

## 2026-03-12: safeRequest wrapper for Obsidian requestUrl error handling

**Context**: Obsidian's `requestUrl` in `throw` mode strips the response body on HTTP errors, making it impossible to read error details from API providers (e.g., "invalid API key" messages from OpenAI or Anthropic).

**Decision**: Create a `safeRequest()` wrapper function in `ai-client.ts` that calls `requestUrl` with `throw: false`, then manually checks `response.status >= 400` and extracts the error message from the JSON response body before throwing a descriptive `Error`.

**Alternatives considered**:
- Use `requestUrl` in throw mode and lose error details (poor debugging experience)
- Switch all AI calls to native `fetch` (inconsistent -- Whisper/Deepgram use `fetch` for FormData, but `requestUrl` is preferred for simple JSON calls in Obsidian plugins)
- Wrap in try/catch at each call site (duplicated logic)

**Rationale**: A single wrapper gives all `requestUrl`-based API calls descriptive error messages. The pattern `body?.error?.message ?? JSON.stringify(body)` covers both OpenAI and Anthropic error response formats.

**Impact**: API errors now show the provider's actual error message (e.g., "Invalid API key") instead of a generic HTTP status code. Affects all AIClient methods (OpenAI, Anthropic, Ollama).

---

## 2026-03-12: Vault cache miss handling in ensureFolder and ProposalStore

**Context**: During plugin reload or when folders exist on disk but have not yet been indexed by Obsidian's vault cache, `vault.getAbstractFileByPath()` returns `null` and `vault.createFolder()` throws "Folder already exists". Similarly, `ProposalStore.listProposalFiles()` could fail if the proposal folder was not yet in the cache.

**Decision**: Add a try/catch in `ensureFolder()` that swallows the "Folder already exists" error specifically. In `ProposalStore`, use `vault.adapter.exists()` and `vault.adapter.list()` (which bypass the vault cache and hit the filesystem directly) instead of cache-dependent methods.

**Alternatives considered**:
- Wait for vault cache to be ready before operating (unreliable timing, no clear API)
- Use `vault.adapter` everywhere (bypasses useful Obsidian abstractions)
- Wrap all vault operations in retry loops (masks the root cause)

**Rationale**: The vault cache is eventually consistent. Defensive error handling in `ensureFolder()` covers the race condition cleanly. Using `vault.adapter` in `ProposalStore` is appropriate because proposal files are JSON (not markdown notes), so they benefit less from vault-level abstractions.

**Impact**: Plugin reload no longer causes spurious "Folder already exists" errors. Proposal listing works immediately after plugin load even if the vault cache is still warming up.

---

## 2026-03-12: Ribbon icons register unconditionally

**Context**: The two ribbon icons (sparkles for elaboration proposals, mic for audio transcription) are registered in `main.ts` outside the `if (settings.*.enabled)` conditional blocks.

**Decision**: Keep ribbon icons registered regardless of whether their corresponding module is enabled. This is a known architectural deviation, documented for future improvement.

**Alternatives considered**:
- Move ribbon registration inside the enabled check (would require re-registration when settings change, which Obsidian does not natively support without a full reload)
- Remove ribbon icons entirely and rely on the command palette (less discoverable)

**Rationale**: Obsidian's `addRibbonIcon` is a one-time registration during `onload()`. There is no `removeRibbonIcon` API. Moving registration inside the enabled check would mean users who enable a module after plugin load would not see the ribbon icon until they restart Obsidian. The current behavior is simpler, though it means clicking a ribbon icon for a disabled module will fail gracefully (the module's methods handle the disabled state).

**Impact**: Ribbon icons are always visible. Clicking one when its module is disabled may show an error or do nothing. Documented as a known issue for future improvement.

---

## 2026-03-12: Provider-specific model dropdowns instead of free-text input

**Context**: The original model setting was a free-text input where users typed model identifiers (e.g., `claude-sonnet-4-20250514`). This was error-prone — a typo meant a silent API failure, and users had to look up exact model IDs.

**Decision**: Replace the free-text model input with a dropdown populated from `MODEL_OPTIONS`, a provider-keyed map. Each AI provider (OpenAI, Anthropic, Ollama) has its own curated list of models with human-friendly display names. When the user switches providers, the model resets to the first option for that provider.

**Alternatives considered**:
- Free-text input with validation (still requires users to know model IDs)
- A single combined dropdown with all models (confusing — shows irrelevant models)
- Fetching available models from the API at runtime (requires valid API key before configuration is complete)

**Rationale**: Provider-specific dropdowns eliminate typo risk and show only relevant models. Simplified names (e.g., `opus` instead of `claude-opus-4-20250514`) are friendlier; the internal `resolveModelId()` function maps them to full API IDs at request time via `ANTHROPIC_MODEL_MAP`.

**Impact**: Users pick from a curated list. Adding a new model requires updating `MODEL_OPTIONS` in `settings.ts` (and `ANTHROPIC_MODEL_MAP` in `ai-client.ts` for Anthropic models). The settings tab re-renders when the provider changes to show the correct model list.

---

## 2026-03-12: Separate Whisper API key for non-OpenAI providers

**Context**: Whisper transcription requires an OpenAI API key, but users may choose Anthropic or Ollama as their AI provider — meaning their shared `ai.apiKey` is not an OpenAI key.

**Decision**: Add a dedicated `audio.whisperApiKey` field. The transcriber resolves the key with fallback logic: use `whisperApiKey` if set, otherwise fall back to the shared `ai.apiKey`. The settings UI only shows the Whisper API key field when the transcription provider is Whisper AND the AI provider is not OpenAI (since OpenAI users already have a valid key).

**Alternatives considered**:
- Always require a separate Whisper key (redundant for OpenAI users)
- Auto-detect and show a warning at transcription time (poor UX — fails only when the user tries to transcribe)
- Require OpenAI as AI provider to use Whisper (unnecessarily restrictive)

**Rationale**: The fallback pattern (`whisperApiKey || ai.apiKey`) means zero extra configuration for OpenAI users, while Anthropic/Ollama users get a clear, contextual prompt to enter their OpenAI key for Whisper specifically. The conditional UI keeps settings clean.

**Impact**: Anthropic/Ollama users who want Whisper transcription see an additional "OpenAI API Key (Whisper)" field. The field explains why it's needed. OpenAI users see no change.

---

## 2026-03-12: Password masking for all API key inputs

**Context**: API keys were displayed as plain text in the settings tab, making them visible to anyone looking at the screen or in screenshots.

**Decision**: Set `inputEl.type = 'password'` and `inputEl.autocomplete = 'off'` on all API key input fields (AI key, Whisper key, Deepgram key).

**Alternatives considered**:
- No masking (status quo — keys visible in settings)
- Show/hide toggle (added complexity for minimal benefit)

**Rationale**: Password masking is a standard UX pattern for sensitive fields. Combined with `autocomplete = 'off'`, it prevents both visual exposure and browser autofill of credentials.

**Impact**: All API key fields show dots instead of the key text. Users can still paste and edit keys normally.

---

## 2026-03-12: Anthropic has no developer-facing transcription API

**Context**: While evaluating whether to add Anthropic as a transcription provider (alongside Whisper and Deepgram), we researched the Anthropic API surface.

**Decision**: Do not add Anthropic as a transcription provider. Anthropic does not offer a speech-to-text or audio transcription API for developers as of March 2026.

**Alternatives considered**:
- Wait for Anthropic to launch a transcription API (unknown timeline)
- Use Claude's multimodal capabilities to process audio (not designed for transcription at scale)

**Rationale**: There is no API endpoint to integrate with. Whisper and Deepgram cover the transcription use case well. If Anthropic launches a transcription API in the future, it can be added as a new provider.

**Impact**: None — no code changes needed. Documents the finding so the question doesn't need to be re-researched.

---

## 2026-03-12: Deepgram converted from `requestUrl` to `fetch` with AbortController

**Context**: The Deepgram transcription call originally used Obsidian's `requestUrl`. This was inconsistent with how Whisper already used `fetch` (required for FormData), and `requestUrl` does not support `AbortController` for timeout management.

**Decision**: Convert Deepgram to use native `fetch` with an `AbortController` timeout (5 minutes), matching the Whisper implementation pattern. Also validate that the Deepgram API key is non-empty before making the request.

**Alternatives considered**:
- Keep `requestUrl` and use a separate timeout mechanism (inconsistent with Whisper pattern)
- Use `requestUrl` with its built-in timeout (less control, no abort signal)

**Rationale**: Consistency between Whisper and Deepgram request patterns simplifies the code. `AbortController` gives explicit timeout control and properly cancels the underlying request. Empty-key validation fails fast with a clear error message instead of a cryptic 401.

**Impact**: Deepgram requests now have a 5-minute timeout and will abort cleanly on timeout. Empty API key is caught before the request is made.

---

## 2026-03-12: Centralized input validation layer (`shared/validation.ts`)

**Context**: The architecture audit identified that URLs and file paths were being passed to shell commands (`execFile`) and external APIs without consistent validation. AI-generated text was being written to vault notes without sanitization, creating potential XSS vectors in Obsidian's markdown renderer.

**Decision**: Create a dedicated `validation.ts` module in `src/shared/` exporting four functions: `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()`, and `sanitizeAIResponse()`. All security-sensitive inputs pass through these before use.

**Alternatives considered**:
- Inline validation at each call site (inconsistent, easy to miss)
- Third-party validation library (violates zero-runtime-deps policy)
- Validation only at the settings layer (doesn't cover runtime inputs like pasted URLs)

**Rationale**: Centralized validation ensures consistency and makes it easy to audit. Defense-in-depth: even though `execFile` avoids shell injection by design, we still reject shell metacharacters in inputs. A single module makes it straightforward to add new validation rules.

**Impact**: All URL and path inputs are validated before reaching `execFile` or external APIs. AI responses are sanitized before being written to vault notes. The validation module is imported via the shared barrel export.

---

## 2026-03-12: `execFile` over `exec` for subprocess execution

**Context**: The video module originally used `child_process.exec` to run yt-dlp and ffmpeg, which passes commands through the shell. This created a command injection risk if user-controlled data (URLs, file paths) contained shell metacharacters.

**Decision**: Switch from `exec` to `execFile`, which bypasses the shell entirely by passing arguments as an array. Combined with input validation from `sanitizeUrl()`/`sanitizePath()`, this provides defense-in-depth against command injection.

**Alternatives considered**:
- Keep `exec` with aggressive escaping (error-prone, platform-dependent)
- Use a shell-escape library (adds a dependency)
- Only validate inputs without changing the exec method (single layer of defense)

**Rationale**: `execFile` is the correct Node.js API for running commands with untrusted arguments — it never invokes a shell, so shell metacharacters are harmless. Combined with input validation, this gives two independent layers of protection.

**Impact**: Subprocess calls in `audio-extractor.ts` use `execFile` with argument arrays. A 5-minute timeout and 10MB buffer limit are enforced on all subprocess calls.

---

## 2026-03-12: API key redaction in error messages

**Context**: Error messages from failed API calls could contain API keys or tokens, which Obsidian's `Notice` UI and `console.error` would display to the user or persist in logs.

**Decision**: The `notifyError()` utility redacts patterns matching common API key formats (prefixes like `sk-`, `key-`, `dg-`, `Bearer`, `Token` followed by 8+ alphanumeric characters) before displaying or logging.

**Alternatives considered**:
- Only log generic "API error" messages (loses debugging context)
- Never log errors (bad for diagnostics)
- Store errors in a separate log file (complexity overhead)

**Rationale**: Redaction preserves useful error context while preventing accidental key exposure. The regex pattern covers OpenAI, Anthropic, Deepgram, and generic Bearer token formats.

**Impact**: Users see descriptive error messages without risking key leakage. Developers debugging issues still get context about what failed.

---

## 2026-03-12: Ollama endpoint protocol validation

**Context**: The Ollama AI provider allows users to configure a custom endpoint URL. Without validation, a user could misconfigure this to a non-HTTPS endpoint, sending AI prompts (which may contain vault content) over an unencrypted connection.

**Decision**: Validate the Ollama endpoint URL: require HTTPS, except allow HTTP for `localhost`/`127.0.0.1` (since local traffic doesn't traverse the network).

**Alternatives considered**:
- Allow any protocol (user's choice, but risky default)
- Require HTTPS always (breaks the primary Ollama use case — local server)
- Validate at settings save time only (runtime bypass possible)

**Rationale**: The localhost exception covers the standard Ollama setup (local server on port 11434) while protecting against accidental plaintext transmission to remote endpoints. Validation happens at request time, not just settings save.

**Impact**: Users with standard local Ollama setups are unaffected. Users pointing to a remote Ollama instance must use HTTPS.

---

## 2026-03-12: Request timeouts on all external calls

**Context**: API calls to external services (Whisper, Deepgram, yt-dlp) could hang indefinitely if the service is unresponsive, leaving the user waiting with no feedback.

**Decision**: Enforce timeouts on all external calls: 5-minute `AbortController` timeout on Whisper API fetch calls, 5-minute timeout on `execFile` subprocess calls (yt-dlp, ffmpeg). Obsidian's `requestUrl` has its own built-in timeout.

**Alternatives considered**:
- No timeouts (risk of infinite hangs)
- Short timeouts (would fail on large files — transcribing a 2-hour podcast takes time)
- User-configurable timeouts (added complexity for edge case)

**Rationale**: 5 minutes is generous enough for large audio files and long video downloads, while still protecting against unresponsive services. Subprocess timeout also prevents orphaned processes.

**Impact**: Long-running operations will fail with a timeout error after 5 minutes rather than hanging. Users processing very large files may hit this limit.

---

## 2026-03-12: Shared barrel export (`shared/index.ts`)

**Context**: The architecture audit found inconsistent import paths across modules — some imported from `../shared/ai-client`, others from `../shared/file-utils`, etc. This made it harder to discover available utilities and refactor internal file boundaries.

**Decision**: Add a barrel file (`shared/index.ts`) that re-exports all public APIs from the shared module. All feature modules import from `../shared` (or `../shared/index`) instead of reaching into internal files.

**Alternatives considered**:
- Direct imports to internal files (status quo — works but inconsistent)
- Separate packages per utility (over-engineered for this project size)

**Rationale**: A barrel export creates a clear public API boundary for the shared module. It standardizes imports and makes it safe to reorganize internal files without updating consumers.

**Impact**: All imports from shared now go through `../shared`. Internal file structure can change without breaking consumers.

---

## 2026-03-12: VideoModule delegates transcription to AudioModule

**Context**: Video transcription requires downloading a video, extracting audio, and then transcribing it — the same transcription pipeline that AudioModule already provides.

**Decision**: VideoModule accepts AudioModule as a constructor argument and calls `AudioModule.transcribe()` for the transcription step rather than implementing its own.

**Alternatives considered**:
- Duplicate transcription logic in VideoModule
- Create a shared transcription service extracted from both modules

**Rationale**: Keeps transcription logic in one place. The dependency is one-directional (Video -> Audio), which is easy to reason about. Audio must be initialized before Video in `main.ts`.

**Impact**: Audio and Video modules are not fully independent. Audio must always be loaded if Video is enabled. Initialization order in `main.ts` matters.

---

## 2026-03-12: Hash-based conflict detection for proposal merging

**Context**: Between proposal generation and user acceptance, the original note may have been edited. Blindly applying a proposal could overwrite changes.

**Decision**: Store a SHA-256 hash of the note's content at proposal time (`sourceHash`). Before merging, recompute the hash and compare. If they differ, warn the user and offer options: merge anyway, regenerate, or cancel.

**Alternatives considered**:
- Diff-based merge (complex, error-prone with markdown)
- Timestamp comparison (unreliable across devices)
- No conflict detection (risk of silent data loss)

**Rationale**: Hash comparison is simple, deterministic, and catches any change. It avoids the complexity of diff algorithms while still protecting user data.

**Impact**: Proposals can go "stale" if the source note changes. Users see a clear conflict warning rather than silent overwrites.

---

## 2026-03-12: Non-destructive proposal storage in `.auto-notes/proposals/`

**Context**: AI-generated elaborations should never modify a user's notes without explicit consent. Proposals need to survive plugin reloads and Obsidian restarts.

**Decision**: Store proposals as JSON files in `.auto-notes/proposals/` within the vault. Each proposal is a separate file named `{noteName}-{shortId}.json` with metadata (source path, creation time, detection reasons, status) and the proposed content.

**Alternatives considered**:
- In-memory only (lost on reload)
- Single database file (merge conflicts, corruption risk)
- Frontmatter annotations on original notes (modifies user files)
- SQLite/IndexedDB (not portable across Obsidian vaults)

**Rationale**: JSON files are queryable, diffable, and human-inspectable. They survive reloads. Individual files avoid corruption cascading across proposals.

**Impact**: Vault contains a `.auto-notes/` folder. Users can inspect, back up, or delete proposals manually. The folder should be excluded from Obsidian search/sync if desired.

---

## 2026-03-12: Scored heuristic system for placeholder detection

**Context**: The elaboration feature needs to identify "stub" or "placeholder" notes that would benefit from AI elaboration. Binary detection (is/isn't a stub) is too coarse.

**Decision**: Each note receives a placeholder score (0-100) computed from weighted heuristics: word count (30), empty sections (25), TODO/TBD markers (20), bullet-only content (10), incoming link ratio (10), and recency (5). Notes above a configurable threshold are candidates.

**Alternatives considered**:
- Binary detection rules (any single signal triggers)
- AI-based classification (expensive, slow for vault scans)
- Manual tagging only (no automation)

**Rationale**: Weighted scoring lets multiple weak signals combine into a strong signal. It reduces false positives compared to binary rules. Users can tune the threshold. It's fast enough for vault-wide scans without API calls.

**Impact**: Detection is nuanced but explainable — users see the score breakdown. The system can be tuned per-vault via settings.

---

## 2026-03-12: Claude API as primary elaboration AI provider

**Context**: The elaboration feature needs an AI backend to generate note content. The plugin should support multiple providers.

**Decision**: Use Anthropic Claude API as the default AI provider via the shared `AIClient`. Also support OpenAI and Ollama. All API calls go through Obsidian's `requestUrl` (except Whisper, which needs `fetch` for FormData).

**Alternatives considered**:
- OpenAI only
- Local models only (Ollama)
- No default, force user to choose

**Rationale**: Multi-provider support via `AIClient` abstraction gives users flexibility. Claude is a strong default for note elaboration tasks. Ollama support enables fully offline usage.

**Impact**: Users must provide an API key for cloud providers. The `AIClient` abstraction makes adding new providers straightforward.

---

## 2026-03-12: Whisper API as primary transcription provider

**Context**: Audio transcription needs a reliable speech-to-text backend. Multiple options exist with different tradeoffs.

**Decision**: Default to OpenAI Whisper API (`whisper-1`). Also support Deepgram and local Whisper (placeholder). Whisper API uses `fetch` instead of Obsidian's `requestUrl` due to FormData requirements.

**Alternatives considered**:
- Deepgram only (good quality, less widely known)
- Local Whisper only (no API key needed, but requires binary installation)
- Browser-based speech recognition (inconsistent quality)

**Rationale**: Whisper API is widely available, high quality, and requires minimal setup — just an OpenAI API key. Deepgram is offered as an alternative. Local Whisper is stubbed for future implementation.

**Impact**: Users need an OpenAI API key for the default provider. The `fetch` workaround for FormData is a known divergence from the Obsidian `requestUrl` pattern.

---

## 2026-03-12: yt-dlp for URL-based media fetching

**Context**: The video transcription feature needs to download videos from YouTube and TikTok to extract audio for transcription.

**Decision**: Use yt-dlp (external CLI tool) for video downloading and metadata extraction. Use ffmpeg for audio extraction from local files. Both are invoked via Node.js `child_process.execFile` (no shell).

**Alternatives considered**:
- Browser-based video download (blocked by CORS, unreliable)
- Built-in download library (large bundle, maintenance burden)
- API-based services (cost, privacy concerns)

**Rationale**: yt-dlp is the standard tool for this purpose — actively maintained, supports hundreds of platforms, handles DRM and rate limiting. It's already installed by many technical users.

**Impact**: Users must install yt-dlp and ffmpeg separately. The plugin includes a dependency check command (`auto-notes:check-dependencies`) to verify availability.

---

## 2026-03-12: `isDesktopOnly: true` in manifest

**Context**: The plugin uses `child_process` for yt-dlp/ffmpeg execution and `fs` for temp file operations — both Node.js APIs unavailable on mobile.

**Decision**: Mark the plugin as desktop-only in `manifest.json`.

**Alternatives considered**:
- Graceful degradation (disable video features on mobile, keep elaboration)
- API-based video processing service (avoid child_process)

**Rationale**: Core video functionality depends on local CLI tools. Attempting mobile support would either break video features or require a fundamentally different architecture. Elaboration and audio features could theoretically work on mobile, but the video dependency on `child_process` makes the plugin desktop-only overall.

**Impact**: Plugin will not appear in Obsidian's mobile plugin browser. Desktop-only is clearly communicated.

---

## 2026-03-12: Zero runtime npm dependencies

**Context**: Obsidian community plugins are reviewed for security and bundle size. Runtime dependencies increase both risk and review burden.

**Decision**: Zero runtime npm dependencies. All external API calls use Obsidian's `requestUrl` or native `fetch`. External tools (yt-dlp, ffmpeg) are invoked as subprocesses rather than imported as libraries.

**Alternatives considered**:
- Use SDK packages for OpenAI, Anthropic, Deepgram
- Bundle a minimal HTTP client library

**Rationale**: Keeps the bundle small and avoids supply chain risk. Obsidian's `requestUrl` handles CORS and provides consistent behavior. API calls are simple enough to implement directly.

**Impact**: API integration code is hand-rolled (more code to maintain) but the plugin has no transitive dependency risk. Bundle stays small.

---

## 2026-03-12: Modular architecture with FeatureModule contract

**Context**: The plugin has three distinct features (elaboration, audio, video) that share some infrastructure but are otherwise independent.

**Decision**: Each feature is a self-contained module following a common contract: `constructor(plugin, getSettings)`, `onload()`, `onunload()`. Modules are conditionally loaded based on settings. A shared utilities layer (`src/shared/`) provides cross-cutting concerns (AI client, file utils, error handling).

**Alternatives considered**:
- Monolithic single-file plugin
- Separate plugins per feature
- Event-bus architecture with loose coupling

**Rationale**: The module pattern balances isolation with simplicity. Features can be independently enabled/disabled. The `getSettings()` closure ensures modules always read fresh settings without event wiring. Shared utilities prevent duplication without tight coupling.

**Impact**: Adding a new feature means creating a new module directory and wiring it in `main.ts`. The pattern is easy to follow and test independently.
