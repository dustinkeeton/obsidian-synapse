# Project Status

**Last updated**: 2026-03-13
**Phase**: Core features complete; enrichment redesigned with vocabulary-based classification and topic extraction

---

## Feature Completion Matrix

| Feature | Core Logic | UI | Tests | Status |
|---------|:---:|:---:|:---:|--------|
| Elaboration -- detection and proposals | Yes | Yes | Partial | **Working** |
| Elaboration -- unified sidebar review | Yes | Yes | No | **Working** |
| Audio -- Whisper API transcription | Yes | Yes | No | **Working** |
| Audio -- Deepgram transcription | Yes | Yes | No | **Working** |
| Audio -- local Whisper | -- | -- | No | Not started (throws) |
| Video -- URL detection (YT + TikTok) | Yes | -- | Yes | **Working** |
| Video -- yt-dlp download + transcribe | Yes | Yes | No | **Working** |
| Video -- local file transcription | -- | -- | No | Not started (stub) |
| Video -- frame extraction | -- | -- | No | Not started (placeholder) |
| Enrichment -- metadata classification (vocabulary-based) | Yes | Yes | Yes | **Working** |
| Enrichment -- topic extraction (AI topics to links) | Yes | Yes | Yes | **Working** |
| Enrichment -- link resolution (graph + topic merge) | Yes | Yes | Yes | **Working** |
| Enrichment -- external refs + frontmatter | Yes | Yes | No | **Working** |
| Enrichment -- vault-wide scan (4-phase) | Yes | Yes | No | **Working** |
| Enrichment -- undo | Yes | -- | Yes | **Working** |
| Tidy -- spelling/formatting | Yes | -- | Yes | **Working** |
| Tidy -- undo | Yes | -- | Yes | **Working** |
| Shared -- AIClient (3 providers) | Yes | -- | No | **Working** |
| Shared -- NotificationManager | Yes | -- | Yes | **Working** |
| Shared -- validation and sanitization | Yes | -- | Yes | **Working** |

---

## Current Focus

- **Enrichment redesign** (just completed): tags are now metadata classifiers via user-defined vocabulary; topics extracted by AI become `[[internal links]]`. TagScorer replaced by MetadataClassifier + TopicExtractor.
- **Git workflow and teams infrastructure**: protected main branch, feature branches, bot identity, multi-agent coordination via `.claude/agents/`.
- **Branch**: `chore/teams-and-git-workflow`

## Recent Changes

- Replaced `TagScorer` with `MetadataClassifier` (vocabulary-based) and `TopicExtractor` (AI topics to links)
- Added vault-wide enrichment scan command with 4-phase flow (scan, confirm, generate, resolve cross-note topics)
- New-note suggestions only created when 2+ notes independently reference same unmatched topic
- Lowered proximity scoring weights -- topical relevance now dominates link suggestions
- Established git workflow: protected main, feature branches, `bot@wafflenet.io` identity
- Created teams infrastructure with 7 agent definitions under `.claude/agents/`
- Added on-demand folder creation in store `save()` methods via `ensureFolder`

## Known Issues

- **Ribbon icons always visible**: registered unconditionally; Obsidian has no `removeRibbonIcon` API
- **`video.tempFolder` unused**: audio extraction uses `os.tmpdir()` instead; setting remains for future frame extraction
- **`supportedPlatforms` toggles not enforced**: settings exist but video module does not filter by them

## External Dependencies

| Dependency | Required For | Status |
|------------|-------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved |
| ffmpeg | Audio extraction from video | User-installed; PATH auto-resolved |
| OpenAI API key | Whisper transcription, GPT models | User-configured |
| Anthropic API key | Claude models | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |
