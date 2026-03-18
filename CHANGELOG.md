# Changelog

All notable changes to Synapse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

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
