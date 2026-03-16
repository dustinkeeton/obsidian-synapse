# Project Status

**Last updated**: 2026-03-16
**Phase**: 8 feature modules implemented; deep-dive and organize modules newly added

---

## Feature Completion Matrix

| Feature | Core Logic | UI | Tests | Status |
|---------|:---:|:---:|:---:|--------|
| **Elaboration** -- detection and proposals | Yes | Yes | Partial | **Working** |
| **Elaboration** -- unified sidebar review | Yes | Yes | No | **Working** |
| **Audio** -- Whisper API transcription | Yes | Yes | No | **Working** |
| **Audio** -- Deepgram transcription | Yes | Yes | No | **Working** |
| **Audio** -- local Whisper | -- | -- | No | Not started (throws) |
| **Video** -- URL detection (YT + TikTok) | Yes | -- | Yes | **Working** |
| **Video** -- yt-dlp download + transcribe | Yes | Yes | No | **Working** |
| **Video** -- local file transcription | -- | -- | No | Not started (stub) |
| **Video** -- frame extraction | -- | -- | No | Not started (placeholder) |
| **Enrichment** -- metadata classification (vocabulary-based) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- topic extraction (AI topics to links) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- link resolution (graph + topic merge) | Yes | Yes | Yes | **Working** |
| **Enrichment** -- external refs + frontmatter | Yes | Yes | No | **Working** |
| **Enrichment** -- vault-wide scan (4-phase) | Yes | Yes | No | **Working** |
| **Enrichment** -- undo | Yes | -- | Yes | **Working** |
| **Summarize** -- URL summarization (inline) | Yes | Yes | No | **Working** |
| **Summarize** -- transcription summarization | Yes | Yes | No | **Working** |
| **Summarize** -- enrichment link -> standalone note | Yes | -- | Yes | **Working** |
| **Summarize** -- vault-wide scan | Yes | Yes | No | **Working** |
| **Tidy** -- spelling/formatting | Yes | -- | Yes | **Working** |
| **Tidy** -- undo | Yes | -- | Yes | **Working** |
| **Organize** -- content analysis (AI) | Yes | -- | Yes | **Working** |
| **Organize** -- directory matching (existing dirs) | Yes | -- | Yes | **Working** |
| **Organize** -- new directory proposals | Yes | Yes | No | **Working** |
| **Organize** -- sidebar review (unified view) | Yes | Yes | No | **Working** |
| **Organize** -- undo | Yes | -- | Yes | **Working** |
| **Organize** -- vault scan (directory) | Yes | Yes | No | **Working** |
| **Deep Dive** -- topic extraction from notes | Yes | -- | Yes | **Working** |
| **Deep Dive** -- recursive note generation (BFS) | Yes | -- | No | **Working** |
| **Deep Dive** -- local quality scoring | Yes | -- | Yes | **Working** |
| **Deep Dive** -- sidebar review (unified view) | Yes | Yes | No | **Working** |
| **Deep Dive** -- cascade rejection | Yes | -- | No | **Working** |
| **Deep Dive** -- auto-enrich/organize on accept | Yes | -- | No | **Working** |
| **Shared** -- AIClient (3 providers) | Yes | -- | No | **Working** |
| **Shared** -- NotificationManager | Yes | -- | Yes | **Working** |
| **Shared** -- validation and sanitization | Yes | -- | Yes | **Working** |

---

## Module Summary (8 modules)

| Module | Path | Purpose | Proposal Type |
|--------|------|---------|---------------|
| Elaboration | `src/elaboration/` | Detect stub notes, generate content proposals | Sidebar (editable) |
| Audio | `src/audio/` | Transcribe audio files via Whisper/Deepgram | None (inline) |
| Video | `src/video/` | Download + transcribe YouTube/TikTok videos | None (inline) |
| Enrichment | `src/enrichment/` | Tags, links, refs, frontmatter suggestions | Sidebar (checkboxes) |
| Summarize | `src/summarize/` | URL and transcription summarization | None (inline or standalone note) |
| Tidy | `src/tidy/` | Spelling/formatting fixes | None (immediate apply + undo) |
| Organize | `src/organize/` | AI-powered directory structuring | Sidebar (new dirs only) |
| Deep Dive | `src/deep-dive/` | Recursive topic extraction + child note generation | Sidebar (tree view) |

---

## Current Focus

- **Deep-dive module** (just added): recursive topic exploration with BFS generation, quality scoring, cascade rejection, and auto-enrich/organize integration
- **Organize module** (just added): AI-powered semantic directory structuring with dual action model (instant move vs proposal for new directories)
- **Summarize module** (just added): URL and transcription summarization with standalone note creation for enrichment links
- **Documentation audit**: updating AGENTS.md (machine-readable) and human docs (this file)

## Recent Changes (2026-03-16)

- Added deep-dive module: recursive topic extraction, BFS note generation, local quality scorer, cascade rejection
- Added organize module: content analysis, directory matching, move snapshots, new-directory proposals
- Added summarize module: URL/transcription summarization, standalone notes for enrichment links
- Extended unified proposal view to 4 proposal types (elaboration, enrichment, organize, deep-dive)
- Color-coded proposal cards: blue (elaboration), green (enrichment), orange (organize), purple (deep-dive)
- Wired deep-dive -> enrichment and deep-dive -> organize callbacks in main.ts
- Added enrichment trigger types: `'deep-dive'` and `'summarization'`
- Updated AIClient with latest Anthropic model IDs (claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001)

## Previous Changes (2026-03-13)

- Replaced `TagScorer` with `MetadataClassifier` (vocabulary-based) and `TopicExtractor` (AI topics to links)
- Added vault-wide enrichment scan command with 4-phase flow
- Established git workflow: protected main, feature branches, `bot@wafflenet.io` identity
- Created teams infrastructure with agent definitions under `.claude/agents/`
- Added on-demand folder creation in store `save()` methods

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

---

## Data Storage Layout

```
.auto-notes/
├── proposals/              # Elaboration proposals (JSON)
├── enrichments/            # Enrichment proposals (JSON)
├── tidy-snapshots/         # Tidy undo snapshots (JSON)
├── organize/
│   ├── proposals/          # Organize proposals (JSON)
│   └── snapshots/          # Organize undo snapshots (JSON)
├── deep-dive/
│   ├── *.json              # Deep-dive proposals (JSON)
│   └── runs/               # Deep-dive run metadata (JSON)
└── temp/                   # Temporary video/audio files (auto-cleaned)
```

---

## External Dependencies

| Dependency | Required For | Status |
|------------|-------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved |
| ffmpeg | Audio extraction from video | User-installed; PATH auto-resolved |
| OpenAI API key | Whisper transcription, GPT models | User-configured |
| Anthropic API key | Claude models | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |

---

## Command Registry (30 commands)

| Module | Commands |
|--------|----------|
| Main | Open proposal review sidebar |
| Elaboration | Scan vault, Scan current note, Clear proposals |
| Audio | Transcribe audio, Transcribe from note |
| Video | Transcribe URL, Transcribe from note, Transcribe file (stub), Check dependencies |
| Enrichment | Enrich current note, Scan vault, Undo enrichment |
| Summarize | Summarize current note, Scan vault |
| Tidy | Tidy current note, Undo tidy |
| Organize | Organize current note, Scan directory, Undo organize |
| Deep Dive | Deep dive into note, Clear proposals |

---

## Test Coverage

| Area | Test Files | Coverage |
|------|-----------|----------|
| Elaboration | `proposal-store.test.ts` | Store CRUD |
| Enrichment | `vault-analyzer.test.ts`, `weight-calculator.test.ts`, `metadata-classifier.test.ts`, `topic-extractor.test.ts`, `link-resolver.test.ts`, `enrichment-store.test.ts` | Comprehensive |
| Summarize | `summarizer.test.ts`, `content-fetcher.test.ts`, `note-scanner.test.ts` | Core logic |
| Tidy | `tidy-store.test.ts`, `tidy-module.test.ts` | Store + module |
| Organize | `content-analyzer.test.ts`, `directory-matcher.test.ts`, `organize-store.test.ts` | Core logic |
| Deep Dive | `deep-dive-store.test.ts`, `quality-scorer.test.ts`, `topic-analyzer.test.ts` | Store + scoring |
| Video | `url-detector.test.ts`, `note-scanner.test.ts` | URL detection + scanning |
| Shared | `notifications.test.ts`, `validation.test.ts`, `frontmatter-utils.test.ts` | Utilities |
