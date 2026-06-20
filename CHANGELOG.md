# Changelog

All notable changes to Synapse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
