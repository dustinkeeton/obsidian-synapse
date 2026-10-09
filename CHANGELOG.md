# Changelog

All notable changes to Synapse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-09

### Added

- An optional System 1 decision lane answers Synapse's classification questions — tag vocabulary, frontmatter values, organize placement, and REM links — with TypeSafe Jev, a typed decision model, instead of a generative prompt. Confident answers skip the generative AI call entirely; uncertain ones fall back to your AI provider. It is off by default; turn it on under **System 1 decisions** in AI configuration with a TypeSafe API key, and set its **Confidence floor** there. Finish messages say when a result was decided by the lane, and the lane can only pick folders, tags, and values that already exist in your vault
- A new **Voice** setting in AI configuration controls whose voice generated prose uses in elaborations, deep dives, and summaries. The default, Neutral, never writes as you; you can also match the note's existing voice, write in first person, or describe a custom voice. Quoted or transcribed material — transcripts, quotes, lyrics, code — always keeps its original wording
- **Undo last organize run** moves every note from the most recent organize run back to where it was, after asking you to confirm. Notes that were deleted or whose original location is now taken are listed for you to handle instead of being overwritten
- Summarize now embeds media it downloads in the note it summarized, above the summary, just as Transcribe does. It follows the existing **Embed video in note** setting and never adds a second copy of an embed the note already has
- The About section of settings has been redesigned: it shows the version and license with a **What's new** button, adds GitHub Sponsors and Buy Me a Coffee buttons for supporting development, and moves **Reset all settings** into a clearly marked danger zone

### Changed

- Organize now proposes every move, including moves into folders that already exist, instead of moving notes directly. Notes only move without review when **Auto-accept** is on for organize. Proposal cards read **Move to** for an existing folder and **New folder** for a new one, and scan summaries count each kind
- Organize only proposes a new folder when it is confident the note should start one, and it can now decide to leave a note where it is
- REM proposes fewer, better links. A link must point to a note on the same subject, not just the same broad field, and it must be anchored to a specific place in your note. Notes you already link to are no longer suggested again. With the System 1 lane on, REM uses the lane alone; if the lane fails for a note, that note is skipped rather than falling back to the generative path

### Fixed

- The auto-accept description for elaboration now says accepting rewrites the note body, matching what it does
- REM no longer hangs on a candidate with an empty matched concept


### Added

- Synapse can now illustrate your notes. The new **Illustrate current note** and **Scan folder for notes to illustrate** commands read a note and propose up to a few spots that would benefit from a visual, then find openly licensed photos for them on Wikimedia Commons and Openverse — no API key needed. Each proposal shows the image, its license, and attribution before you accept; accepting downloads the photo into your attachment folder and inserts it with a caption (or embeds the remote image instead, if you turn off **Download photos into the vault**). An allowed-licenses list (CC0, public domain, CC BY, and CC BY-SA by default) keeps anything else out, and Illustrate can also run automatically after other actions
- Illustrate can draw Mermaid diagrams and charts for a note as well. Charts are built only from numbers already in the note. Turn on **Propose Mermaid diagrams and charts** in the Illustrate settings to enable it; by default Illustrate proposes photos only
- A development build of the plugin now announces itself at the top of the settings tab, with the branch, commit, and build time it came from, so a dev build is never mistaken for a release

### Changed

- Accepting an elaboration now rewrites the note body in place instead of appending a callout below it. The rewrite keeps your frontmatter byte for byte and preserves every sentence, embed, wikilink, and URL you wrote, expanding around them. If the note changed after the proposal was made, you are asked before anything is replaced
- Synapse callouts are now written as native Obsidian callout types (summary, info, quote) carrying a `synapse-*` identity, so your theme's own styling for those base types applies to them and Synapse only adds its icon. Existing callouts keep working
- The privacy section of the README now describes the once-a-day update check (on by default, off under **Notify me about Synapse updates**) and lists every host Synapse contacts, including GitHub, Reddit, Wikimedia Commons, and Openverse

### Fixed

- URLs with parentheses, such as Wikipedia pages like `Doom_(1993_video_game)`, are no longer cut off at the closing parenthesis when Synapse fetches them during elaboration, enrichment, summarize, or intake
- Image analysis no longer swaps your configured AI model for the vision model while it runs, so another AI call made at the same time can no longer pick up the wrong model or a wrong cached response
- The per-section **Reset** buttons and **Reset all settings** now use Obsidian's own destructive-button styling, matching the app's built-in Uninstall and Disable controls

### Security

- Links and image URLs returned by the Illustrate photo providers are written into your note only when they are plain `http(s)` addresses; anything else is dropped
- When a Reddit share link resolves to its canonical post, the follow-up fetch is only made if that address is still on Reddit
- Illustrate photo searches now time out after 30 seconds instead of hanging a scan if a provider stalls
- Temporary audio created for a time-range clip is removed even when the clip or transcription fails
- The release workflows validate the version string before using it, instead of interpolating it into the shell

## [1.2.0] - 2026-09-17

### Added

- Operations now tell you when a result came from cache. If a transcript was reused from the transcript cache, or any AI call behind a summary, tidy, elaboration, or enrichment was replayed from the AI response cache, the finish message says so — with one aggregated line for batch runs. A fresh run reads exactly as it did before

### Changed

- "Fetch a fresh transcript" is now genuinely fresh: it bypasses the AI response cache for the re-fetched transcript's post-processing too, not just the transcript download

### Fixed

- Transcribing media with no speech no longer fabricates a transcript and writes it into your note. Silent, music-only, or annotation-only audio (`[Music]`, applause) is now recognized as "no speech" at the provider, skipped by AI post-processing, and kept out of the transcript cache. Single-file runs finish with "No speech detected — nothing to transcribe"; batch runs notify per silent item and still insert the rest
- Per-note action buttons in the Synapse sidebar now run on the first click instead of needing a second one to focus the note

## [1.1.0] - 2026-09-15

### Added

- Long transcripts are no longer skipped by post-processing. A transcript that exceeds the AI output budget is now cleaned up in sections and rejoined, so a two-hour caption dump gets the same punctuation and paragraphing as a short voice memo. Each section sees the tail of the one before it, so sentences that straddle a boundary come back whole
- Synapse now catches up on intake notes it never saw. Notes that synced in while Obsidian was closed — including a video URL handed off from your phone for the desktop to transcribe — and notes whose earlier processing failed are picked up on startup and processed oldest first, a few at a time
- Elaboration reads more of the surrounding vault. Alongside outbound links, a note's backlinks (with an excerpt of the line that links to it) and its tags — plus the titles of notes sharing those tags — now feed the prompt, so a stub that is linked from many notes is elaborated with the context that explains what it is for
- Transcripts are cached, so re-running a command on the same video or clip reuses the transcript instead of transcribing and paying for it again
- A "Transcription model" dropdown now sits next to the transcription provider, so you can pick the model your provider uses instead of being stuck on a hardcoded one

### Changed

- The Anthropic and OpenAI model lists have been refreshed to the current generation

### Fixed

- Selecting an OpenAI reasoning model (o3, o3-mini, o4-mini) no longer fails every request with "Unsupported parameter: 'max_tokens' is not supported with this model"
- A video or audio URL that can't be transcribed no longer gets a summary of the page's HTML instead. You now get the actual reason — captions unavailable, yt-dlp or ffmpeg missing, no path on mobile — with what to do about it, rather than a "summary" that describes the web page around the video

### Security

- The YouTube caption path is hardened against hostile responses: caption fetches are pinned to YouTube hosts over HTTPS, responses are size-bounded before parsing, and chapter titles and caption text are escaped so a crafted caption cannot inject links or embeds into your note

## [1.0.14] - 2026-09-14

### Fixed

- AI operations on the same note now run one at a time, so chaining commands like Transcribe then Elaborate on a note no longer interleaves: elaboration waits for the transcript to land instead of expanding an unreadable audio link, and you no longer get duplicate elaboration callouts or stale enrichment and title checks
- Accepting a title proposal now updates every note that links to the renamed note, so inbound wikilinks, heading and block references, embeds, and markdown links keep working. Each link's visible text is preserved exactly as it was, whether renamed outright, suffixed, or merged
- Real TikTok videos are no longer misreported as photo slideshows when the local ffprobe can't read their audio codec. When the post clearly has audio, Synapse now points you at the ffmpeg path setting or a yt-dlp update instead

## [1.0.13] - 2026-07-15

### Added

- YouTube videos now transcribe from their captions — free, near-instant, no yt-dlp or ffmpeg needed — and it works on mobile, where video transcription was previously unavailable. Videos without captions (and TikTok/Instagram) still use the desktop download pipeline automatically, and a "Prefer YouTube captions" toggle in the video settings restores the old always-download behavior
- Caption transcripts arrive formatted: speaker changes become their own paragraphs, the video's chapters become headings that link to that moment in the video, and natural pauses break up auto-generated captions — all derived from the captions themselves, with no AI cost
- Sharing a link into the vault from your phone now flows end to end: a bare video URL dropped in the intake folder is transcribed and run through the full pipeline, and an optional "Adopt shared captures" setting moves share-sheet captures from the vault root into the intake folder for you. When a video can't be transcribed on mobile, the note is left unprocessed so a synced desktop vault finishes it automatically

### Changed

- Choosing what to transcribe is now a proper dialog instead of a toast: the trim bar shows in/out handles on the timeline, dismissing the dialog cancels instead of silently transcribing the whole file, and manual start/end entry appears in the same dialog when the duration can't be detected
- "Remove filler words" is now off by default and explains its trade-off — it suits voice memos, but rewords interviews and talks you may want verbatim (existing vaults keep their saved setting)

### Fixed

- Transcribing videos found in a note now goes through the same caption-first routing as every other flow, so a captioned YouTube video no longer downloads or hits transcription size limits
- Long transcripts are no longer silently cut off by AI post-processing: when a transcript exceeds the configured token budget, Synapse keeps the complete raw text instead of a truncated cleanup

## [1.0.12] - 2026-07-03

### Changed

- Notification messages now consistently use sentence case

### Security

- Console error redaction is now an enforced contract: an automated guard blocks any future error-logging path from bypassing secret-key redaction, so the coverage added in recent releases can't quietly regress

## [1.0.11] - 2026-07-02

### Changed

- Synapse's icons wear the new Iris + Gold identity: glyph bodies still follow your theme's text color, now with at most a single gold accent per icon — brighter on dark themes, deepened on light ones — and the per-note actions icon becomes the S-Signal mark

### Security

- Secret-key redaction now covers the last remaining console error paths — plugin startup and settings-migration logs, the update checker, the credential Test button, image downscaling, and clipboard-copy failures — so an API key echoed into an error message can never reach the console unredacted

## [1.0.10] - 2026-07-01

### Added

- Each settings section now ends with a "Reset to defaults" row that restores just that section after a confirmation prompt; it's disabled, with an "Already at defaults" note, whenever the section already matches the shipped defaults
- A new "Reset all settings" button in Settings → About restores every section at once — after you confirm — while preserving your onboarding, update-check, and collapsed-section state

## [1.0.9] - 2026-06-30

### Changed

- Every folder-scan picker — across elaboration, organize, summarize, enrichment, REM link discovery, and the all-features run — now behaves identically and defaults to the vault root, so pressing Enter as the picker opens scans your entire vault

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
