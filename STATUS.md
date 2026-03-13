# Project Status

**Last updated**: 2026-03-13
**Phase**: All five feature modules implemented; enrichment, tidy, and unified view are new since last status update

---

## Feature Completion Matrix

| Feature | Core Logic | UI | Security | Tests | Status |
|---------|:---:|:---:|:---:|:---:|--------|
| Elaboration — detection & proposals | Yes | Yes | Yes | No | **Working** |
| Elaboration — review (unified sidebar) | Yes | Yes | — | No | **Working** |
| Audio — Whisper API transcription | Yes | Yes | Yes | No | **Working** |
| Audio — Deepgram transcription | Yes | Yes | Yes | No | **Working** |
| Audio — inline note transcription | Yes | Yes | Yes | No | **Working** |
| Audio — local Whisper | — | — | — | No | Not started (throws) |
| Audio — post-processing | Yes | — | Yes | No | **Working** |
| Video — URL detection (YT + TikTok) | Yes | — | Yes | Yes | **Working** |
| Video — yt-dlp download + transcribe | Yes | Yes | Yes | No | **Working** |
| Video — download + embed in note | Yes | — | Yes | No | **Working** |
| Video — local file transcription | — | — | — | No | Not started (stub) |
| Video — frame extraction | — | — | — | No | Not started (placeholder) |
| Enrichment — tag scoring | Yes | Yes | Yes | No | **Working** |
| Enrichment — internal link resolution | Yes | Yes | Yes | No | **Working** |
| Enrichment — external refs + frontmatter | Yes | Yes | Yes | No | **Working** |
| Enrichment — undo | Yes | — | — | Yes | **Working** |
| Tidy — spelling/formatting | Yes | — | Yes | Yes | **Working** |
| Tidy — undo | Yes | — | — | Yes | **Working** |
| Unified proposal sidebar | Yes | Yes | — | No | **Working** |
| Shared — AIClient (3 providers) | Yes | — | Yes | No | **Working** |
| Shared — NotificationManager | Yes | — | — | Yes | **Working** |
| Shared — validation & sanitization | Yes | — | Yes | Yes | **Working** |
| Shared — frontmatter utils | Yes | — | — | Yes | **Working** |
| Test infrastructure (Vitest + mocks) | Yes | — | — | — | **Working** |

---

## What's Working

- **Full plugin lifecycle**: load, settings, conditional module init, unload
- **Five feature modules**: elaboration, audio, video, enrichment, tidy — all functional
- **Unified sidebar**: Single view for elaboration + enrichment proposals with inline review
- **Cross-module automation**: Elaboration accept → auto-enrich; transcription complete → auto-enrich
- **Centralized notifications**: Progress tracking, cancellation, confirmation dialogs
- **Security layer**: Input validation, output sanitization, subprocess hardening, key redaction
- **Three AI providers**: OpenAI, Anthropic, Ollama with model dropdowns
- **Three transcription providers**: Whisper API, Deepgram (local Whisper stubbed)
- **Video support**: YouTube + TikTok (all URL formats), download + embed option

## What's Not Implemented

- **Local Whisper transcription**: Provider defined but throws "not implemented"
- **Local video file transcription**: Command shows "coming soon" notice
- **Frame extraction**: `FrameExtractor` class is a placeholder
- **Platform filtering**: `supportedPlatforms` toggles exist in settings but are not enforced

## Known Issues

- **Ribbon icons always visible**: Registered unconditionally; Obsidian has no `removeRibbonIcon` API
- **`video.tempFolder` unused**: Audio extraction uses `os.tmpdir()` instead; setting remains for future frame extraction

## Test Coverage

| Module | Test Files | Coverage Area |
|--------|-----------|---------------|
| video/url-detector | `url-detector.test.ts` | YouTube + TikTok URL patterns (26 cases) |
| video/note-scanner | `note-scanner.test.ts` | Note video URL scanning |
| shared/validation | `validation.test.ts` | URL, path, AI response sanitization |
| shared/notifications | `notifications.test.ts` | NotificationManager operations |
| shared/frontmatter | `frontmatter-utils.test.ts` | Frontmatter parse/serialize/merge |
| enrichment/weight-calc | `weight-calculator.test.ts` | Proximity weight algorithm |
| enrichment/vault-analyzer | `vault-analyzer.test.ts` | Tag index and link graph |
| enrichment/store | `enrichment-store.test.ts` | Proposal CRUD |
| tidy/store | `tidy-store.test.ts` | Snapshot CRUD |
| tidy/module | `tidy-module.test.ts` | Tidy pipeline |

## Recent Changes (since last update)

- Added enrichment module with proximity-weighted tag scoring, link resolution, and AI suggestions
- Added tidy module with immediate-apply workflow and undo via snapshots
- Unified elaboration + enrichment proposals into single sidebar view
- Replaced modals with inline review panes and clickable note links
- Added centralized `NotificationManager` with cancellation and two-phase vault scan
- Wired cross-module callbacks (elaboration/transcription → auto-enrich)
- Added video download-to-vault and embed-in-note settings
- Removed unused output folder settings from audio and video

## External Dependencies

| Dependency | Required For | Status |
|------------|-------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved |
| ffmpeg | Audio extraction from video | User-installed; PATH auto-resolved |
| OpenAI API key | Whisper transcription, GPT models | User-configured |
| Anthropic API key | Claude models | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |
