# Project Status

**Last updated**: 2026-03-19
**Version**: 0.3.2
**Branch**: `main`
**Phase**: 11 modules (10 feature + 1 UI-only transcription); time-range clipping, Instagram Reels, receipt OCR templates, and mobile safety recently shipped

---

## Feature Completion Matrix

| Feature | Core Logic | UI | Tests | Status |
|---------|:---:|:---:|:---:|--------|
| **Elaboration** -- detection and proposals | Yes | Yes | Partial | **Working** |
| **Elaboration** -- image analysis for proposals | Yes | -- | Yes | **Working** |
| **Elaboration** -- unified sidebar review | Yes | Yes | No | **Working** |
| **Audio** -- Whisper API transcription | Yes | Yes | No | **Working** |
| **Audio** -- Deepgram transcription | Yes | Yes | No | **Working** |
| **Audio** -- local Whisper | -- | -- | No | Not started (throws) |
| **Audio** -- note scanning for embeds | Yes | -- | Yes | **Working** |
| **Video** -- URL detection (YT + TikTok + Instagram) | Yes | -- | Yes | **Working** |
| **Video** -- yt-dlp download + transcribe | Yes | Yes | No | **Working** |
| **Video** -- TikTok URL normalization | Yes | -- | Yes | **Working** |
| **Video** -- note scanning for URLs | Yes | -- | Yes | **Working** |
| **Video** -- local file transcription | -- | -- | No | Not started (stub) |
| **Video** -- frame extraction | -- | -- | No | Not started (placeholder) |
| **Image** -- OCR via multi-modal AI | Yes | -- | Yes | **Working** |
| **Image** -- batch extraction with checkpoints | Yes | -- | No | **Working** |
| **Image** -- note scanning for embeds | Yes | -- | Yes | **Working** |
| **Transcription** -- unified modal (file + URL) | Yes | Yes | No | **Working** |
| **Transcription** -- note media modal (scan + select) | Yes | Yes | No | **Working** |
| **Transcription** -- duration detection (ffprobe/yt-dlp) | Yes | -- | Yes | **Working** |
| **Transcription** -- time-range slider (dual-handle) | Yes | Yes | No | **Working** |
| **Transcription** -- time-range clipping (audio/video) | Yes | Yes | No | **Working** (desktop only) |
| **Enrichment** -- metadata classification (vocabulary-based) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- topic extraction (AI topics to links) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- link resolution (graph + topic merge) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- external refs + frontmatter | Yes | Yes | No | **Working** |
| **Enrichment** -- vault-wide scan (4-phase) | Yes | Yes | No | **Working** |
| **Enrichment** -- undo | Yes | -- | Yes | **Working** |
| **Summarize** -- URL summarization (inline) | Yes | Yes | No | **Working** |
| **Summarize** -- transcription summarization | Yes | Yes | No | **Working** |
| **Summarize** -- enrichment link -> standalone note | Yes | -- | Yes | **Working** |
| **Summarize** -- content-aware templates (recipe detection) | Yes | -- | Yes | **Working** |
| **Summarize** -- receipt content template for OCR | Yes | -- | No | **Working** |
| **Summarize** -- vault-wide scan | Yes | Yes | No | **Working** |
| **Tidy** -- spelling/formatting | Yes | -- | Yes | **Working** |
| **Tidy** -- undo | Yes | -- | Yes | **Working** |
| **Organize** -- content analysis (AI) | Yes | -- | Yes | **Working** |
| **Organize** -- directory matching (existing dirs) | Yes | -- | Yes | **Working** |
| **Organize** -- new directory proposals | Yes | Yes | No | **Working** |
| **Organize** -- undo | Yes | -- | Yes | **Working** |
| **Deep Dive** -- topic extraction from notes | Yes | -- | Yes | **Working** |
| **Deep Dive** -- recursive note generation (BFS) | Yes | -- | No | **Working** |
| **Deep Dive** -- local quality scoring | Yes | -- | Yes | **Working** |
| **Deep Dive** -- sidebar review (unified view) | Yes | Yes | No | **Working** |
| **Deep Dive** -- cascade rejection | Yes | -- | No | **Working** |
| **Title** -- untitled note detection | Yes | -- | No | **Working** |
| **Title** -- content-mismatch detection (AI) | Yes | -- | No | **Working** |
| **Title** -- proposal review + file rename | Yes | Yes | No | **Working** |
| **Shared** -- AIClient (3 providers, multi-modal) | Yes | -- | No | **Working** |
| **Shared** -- NotificationManager | Yes | -- | Yes | **Working** |
| **Shared** -- validation and sanitization | Yes | -- | Yes | **Working** |
| **Shared** -- callout registry (7 types) | Yes | -- | Yes | **Working** |
| **Shared** -- checkpoint/resume framework | Yes | Yes | Yes | **Working** |

---

## Module Summary (11 modules)

| Module | Path | Purpose | UI Surface |
|--------|------|---------|------------|
| Elaboration | `src/elaboration/` | Detect stub notes, generate content proposals (image-aware) | Sidebar (editable) |
| Audio | `src/audio/` | Transcribe audio files via Whisper/Deepgram | None (inline insert) |
| Video | `src/video/` | Download + transcribe YouTube/TikTok videos | None (inline insert) |
| Image | `src/image/` | OCR text extraction from vault images via vision models | None (inline insert) |
| Transcription | `src/transcription/` | Unified transcription UI modals (audio, video, image) | 2 modals |
| Enrichment | `src/enrichment/` | Tags, links, refs, frontmatter suggestions | Sidebar (checkboxes) |
| Summarize | `src/summarize/` | URL and transcription summarization | None (inline or standalone note) |
| Tidy | `src/tidy/` | Spelling/formatting fixes | None (immediate apply + undo) |
| Organize | `src/organize/` | AI-powered directory structuring | Sidebar (new dirs only) |
| Deep Dive | `src/deep-dive/` | Recursive topic extraction + child note generation | Sidebar (tree view) |
| Title | `src/title/` | Detect untitled/mismatched note titles, propose renames | Sidebar (accept = rename) |

---

## Current Focus

- **Documentation audit**: Updating AGENTS.md, DECISIONS.md, STATUS.md, ARCHITECTURE.md
- **Security pass**: Ongoing audit for input validation and credential handling
- **Hybrid extraction strategy**: Research complete (Issue #166); implementation planned for v0.7.0

## Recent Changes (v0.3.2 — 2026-03-19)

- Added receipt content template for OCR text extraction (#200)
- Moved top-level Node.js requires into lazy getters for mobile safety (#198)
- Added Instagram Reels URL detection for transcription pipeline (#197)
- Added duration-aware time-range slider for transcription clipping (#196)
- Added optional time-range clipping for audio/video transcription (#194)
- Broadened URL detection for YouTube and TikTok edge cases (#191)
- Bumped version to 0.3.2 (#199)

## Previous Milestones

### v0.3.1 (2026-03-19)
- Research: hybrid extraction strategy for cross-platform media support (#183)
- Display plugin version in settings header (#178)

### v0.3.0 (2026-03-19)
- Full codebase audit — fix imports, update docs (#173)
- Migrated settings headings from `createEl` to `setHeading()` (#171)
- Fixed resource cleanup: setTimeout handles and injected styles on unload (#170)

### v0.2.2 (2026-03-18)
- Image OCR module with multi-modal AIClient and vision model support (#162, #165)
- Image analysis in elaboration proposals (#163, #167)
- Image embed preservation in AI content (#161)

### v0.2.1 (2026-03-18)
- Title proposal module (#150, #157)
- TikTok URL normalization (#155, #156)
- Content-aware summary templates with recipe detection (#145, #148)
- Reject All button for proposals (#141)

---

## Known Issues

| Issue | Severity | Details |
|-------|----------|---------|
| Ribbon icons always visible | Low | Registered unconditionally; Obsidian has no `removeRibbonIcon` API |
| `video.tempFolder` unused | Low | Audio extraction uses `os.tmpdir()` instead; setting remains for future frame extraction |
| `supportedPlatforms` toggles not enforced | Low | Settings exist but video module does not filter by them |
| Local Whisper not implemented | Medium | `local-whisper` provider throws on use |
| Local video file transcription not implemented | Medium | Command shows "coming soon" notice |
| Frame extraction not implemented | Medium | `FrameExtractor` is a placeholder |
| Image checkpoint resume is no-op | Low | `resumeFromCheckpoint()` discards and asks user to re-run (same pattern as deep-dive) |

---

## External Dependencies

| Dependency | Required For | Status |
|------------|-------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved |
| ffmpeg | Audio extraction from video | User-installed; PATH auto-resolved |
| OpenAI API key | Whisper transcription, GPT models (incl. vision) | User-configured |
| Anthropic API key | Claude models (incl. vision) | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |

---

## Test Coverage

| Area | Test Files | Coverage |
|------|-----------|----------|
| Elaboration | `proposal-store.test.ts`, `scan-note.test.ts` | Store CRUD, scan integration |
| Audio | `note-scanner.test.ts` | Note scanning |
| Image | `extractor.test.ts`, `note-scanner.test.ts` | OCR extraction, note scanning |
| Enrichment | `vault-analyzer.test.ts`, `weight-calculator.test.ts`, `metadata-classifier.test.ts`, `topic-extractor.test.ts`, `link-resolver.test.ts`, `enrichment-store.test.ts` | Comprehensive |
| Summarize | `summarizer.test.ts`, `content-fetcher.test.ts`, `note-scanner.test.ts`, `summarize-module.test.ts` | Core logic |
| Tidy | `tidy-store.test.ts`, `tidy-module.test.ts` | Store + module |
| Organize | `content-analyzer.test.ts`, `directory-matcher.test.ts`, `organize-store.test.ts` | Core logic |
| Deep Dive | `deep-dive-store.test.ts`, `quality-scorer.test.ts`, `topic-analyzer.test.ts`, `syllabus-navigator.test.ts` | Store + scoring + nav |
| Video | `url-detector.test.ts`, `note-scanner.test.ts` | URL detection + scanning |
| Shared | `notifications.test.ts`, `validation.test.ts`, `frontmatter-utils.test.ts`, `callouts.test.ts`, `diagram-generator.test.ts`, `folder-picker-modal.test.ts`, `checkpoint-manager.test.ts` | Utilities + checkpoint |
