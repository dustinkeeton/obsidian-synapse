# Changelog

All notable changes to Synapse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.8] - 2026-06-29

### Added

- Optional response caching for AI requests — with automatic coalescing of identical in-flight requests — so repeated work on the same content doesn't call the model again (toggle in Settings)
- Proposed titles that would collide with an existing file are now surfaced as a distinct state, letting you add a suffix or merge into the existing note instead of failing

### Changed

- Note elaboration no longer adds duplicate proposals for content it has already suggested, and respects a per-note limit on how many proposals it creates
- Repeated notifications are throttled and de-duplicated, so identical messages no longer stack up
- Synapse settings now migrate automatically when you update the plugin, so older configurations carry forward cleanly

### Fixed

- The Review button now respects each action's auto-accept setting instead of always accepting immediately

### Security

- External page content fetched for note elaboration is now treated as untrusted, guarding against prompt-injection from linked pages
- Broadened secret-key redaction to cover more of the error messages Synapse writes to the console

## [1.0.7] - 2026-06-25

### Added

- Summarize a note's own prose, not just the URLs, transcriptions, and audio it references ("Summarize note content" toggle)
- Choose one combined summary or a separate summary per item ("Combine into one summary" toggle) — both honored by single-note summarize and vault/folder scans
- Get a notice when a newer version of Synapse is available, with an Update button that opens Community plugins
- Turn update notifications on or off with the new "Notify me about Synapse updates" toggle in General settings
- A "What's new" link in Settings → About that opens an in-app changelog view with the installed version highlighted
- A General settings section with an "Auto-fold properties" toggle that collapses a note's Properties panel when it opens — off by default, still manually expandable
- An "Open settings" button on the video-summary error notice when yt-dlp or ffmpeg is missing, jumping straight to the Video transcription section
- Per-OS install commands (macOS, Linux, Windows) with one-click copy in the yt-dlp and ffmpeg path settings

### Changed

- By default, summarize now includes the note's own prose and produces a single combined summary block; switch either off in Settings → Summarize
- Note elaboration now uses the note's title as a signal, producing more relevant suggestions — including for notes that have only a title and no body yet
- Elaboration declines to generate content for an empty note with a generic title (an Untitled default, a date, or a bare URL) and prompts you to add a few words first
- REM link discovery suggests content-relevant links automatically whenever it's enabled; the separate semantic-matching toggle has been removed
- REM ranks link suggestions by content relevance, so a coincidental title match no longer automatically outranks a more relevant link
- Sentence-cased the "REM: discover links in current note" command to match Obsidian's command-palette convention

### Fixed

- Elaborate now reads content from Reddit links (including share links) instead of silently ignoring them
- Elaborate shows a notice when a linked page can't be loaded, instead of silently continuing without it
- Full links with multiple query parameters — such as complete TikTok and YouTube URLs — are no longer rejected as containing invalid characters
- URLs with parentheses, like Wikipedia disambiguation pages, are now accepted instead of being treated as invalid
- Transcribing a TikTok photo slideshow now reports that the post has no audio track instead of failing with a cryptic codec error
- When ffmpeg or ffprobe can't be found, transcription tells you to set the ffmpeg path in Synapse settings instead of showing a raw error
- Audio extraction from video URLs retries with a fallback format, succeeding more often

### Security

- Redact secret keys from operation-error messages written to the console, matching the redaction already applied to on-screen error notices

## [1.0.6] - 2026-06-22

### Added

- Click an error notice before it dismisses to copy its full message to the clipboard

### Changed

- Error notices now persist until dismissed and use a softer, less alarming color
- Normalized action command names in the command palette for clearer, more consistent wording

## [1.0.5] - 2026-06-20

### Added

- On-brand icons throughout Synapse: per-feature glyphs in the Synapse Actions sidebar and per-action icons in the command palette

### Changed

- Redesigned all three ribbon icons (review proposals, transcribe media, Synapse actions) as bespoke, on-brand marks
- Nested settings helper controls within their setting-item rows for cleaner alignment

## [1.0.4] - 2026-06-20

### Added

- Guided API-key onboarding with live validation when configuring AI providers
- "Review" action on proposal toasts to open the unified proposal view directly

### Changed

- Unified action-type colors into semantic theme tokens for consistent coloring across the UI

### Fixed

- Stop the animated progress-notification timer when the plugin is disabled mid-operation, preventing an orphaned interval from firing after unload

## [1.0.3] - 2026-06-19

### Added

- Synapse actions sidebar — a registry-driven panel exposing every action, including on mobile
- Centralized per-path exclusion list, applied across vault enumeration so excluded folders are skipped everywhere
- Automatic formatting of song transcripts into structured lyrics

### Changed

- Hoisted the transcription provider and API key into the shared AI Configuration settings

## [1.0.2] - 2026-06-14

### Changed

- Centralized desktop-only Node.js access behind a guarded loader for safer mobile behavior
- Hardened internals: typed AI/provider responses and external data, enforced promise-rejection handling, and type-aware ESLint rules in CI

### Fixed

- Use window-scoped timers and DOM APIs so features work correctly in pop-out windows
- Adopt Obsidian API and CSS best practices from a guideline review

### Security

- Publish build provenance attestations for release assets

## [1.0.1] - 2026-06-12

### Fixed

- Declare the correct minimum Obsidian version (`minAppVersion` 1.7.2) — the plugin uses APIs (`Workspace.revealLeaf`, `Setting.setDisabled`, `ToggleComponent.setTooltip`, `Vault.createFolder`) introduced after the previously declared 1.1.0 minimum
- Pin the `obsidian` typings to 1.7.2 so future API drift beyond the declared minimum is caught at compile time
- Replace the `any`-typed settings merge in `loadSettings` with fully typed deep merging, so malformed persisted settings are caught by the type checker
- Document and correctly scope the lazy Node-builtin loading in the video audio extractor (mobile-safe bundle loading)

## [1.0.0] - 2026-06-12

### Added

- **Elaboration** — AI-powered stub note detection and content proposal generation with configurable thresholds (word count, TODO markers, empty sections)
- **Audio Transcription** — Transcribe audio files via OpenAI Whisper API, Deepgram, or local Whisper with AI post-processing to clean filler words and add structure
- **Video Transcription** — Download and transcribe YouTube/TikTok videos using yt-dlp and ffmpeg (desktop only)
- **Enrichment** — AI-suggested metadata tags, internal links, topic links, and external references with proximity-weighted scoring
- **Summarize** — URL, transcription, and audio embed summarization with bullet, paragraph, and key-points styles
- **Tidy** — AI spelling and formatting correction that preserves content meaning
- **Organize** — AI-powered semantic directory structuring with confidence thresholds
- **Deep Dive** — Recursive topic exploration generating interlinked child notes with configurable depth, quality scoring, and folder structure modes (nested/flat/auto)
- **Unified Proposal View** — Sidebar panel for reviewing and accepting/rejecting proposals from all modules
- **Checkpoint/Undo System** — Automatic checkpoints for vault-wide operations with resume and rollback support
- **Mobile Support** — Responsive CSS, platform-gated features, and portable file utilities
- **Notification Manager** — Centralized notifications with status bar integration
- **Directory-scoped scanning** — Folder picker UI for targeting specific vault directories
- **Accept All button** — Batch-accept proposals in the review pane
- **Mermaid diagrams** — Visual folder structure change previews
- **Syllabus navigation** — Breadcrumb navigation in deep dive notes
- **Depth selection** — Interactive depth picker when starting deep dives
- **Multi-provider AI support** — OpenAI, Anthropic, and Ollama (local)

### Fixed

- Deep dive badge text wrapping
- Organize confidence thresholds to reduce folder sprawl
- Video embed height for portrait aspect ratios
- Multi-URL summarization (all URLs now processed)
- Organize scoped to current note after summarize
- Toast width jitter from animated ellipsis
- UI hang when summarizing URLs with existing summary notes
- Folder picker sorting (exact match ranks first)
