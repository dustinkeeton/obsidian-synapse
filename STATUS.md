# Project Status

**Last updated**: 2026-10-09
**Version**: 1.4.0 (released 2026-10-09)
**Health**: Green — `tsc` clean, **2938/2938 tests passing (212 files)**, lint clean, dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

## At a Glance

- **25 modules** under `src/` (including the thin `settings-ui/`, `onboarding/`, `brand-icons/`, `changelog/`, and `properties-fold/` folders) plus top-level `main.ts` (302 lines — lifecycle glue only; `modules/registry.ts` constructs, loads, and unloads every feature with one `ModuleDeps` bundle first) and `settings.ts`.
- **1.4.0 (2026-10-09)**: an opt-in **System 1 decision lane** (#558, #563, #566) lets tag vocabulary, frontmatter values, directory placement, and REM link scoring ask TypeSafe's Jev model first (typed `choice`/`score` questions over options Synapse already holds); off by default via `ai.systemOne` because note text leaves the vault. With the lane on, **REM runs on the lane alone** and every link needs an anchor in the note. **Organize never moves a note without a proposal**, and **Undo last organize run** reverts a whole run. Also: a **Voice** setting for generated prose (#540), a redesigned settings **About** section (#529), and Summarize embeds a downloaded video once (#561).
- **1.3.0 (2026-10-06)**: **Illustrate** proposes licensed photos, plus opt-in Mermaid diagrams and charts (#213, #549); **accepting an elaboration replaces the note body in place** (#552); callouts are written as native base types (#554).
- **Unreleased — REM accept checks the note first (#575)**: accepting REM links re-checks each scan-time position against the note as it is now. A link whose text moved is re-found at the nearest whole-word match outside code, links, frontmatter, and summary callouts; one that cannot be found is skipped with a "Skipped N link(s)" notice. If nothing applies, the note is left untouched and the proposal stays pending.
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → illustrate → tidy → organize; the **intake folder** auto-feeds it. All proposals land in one **unified proposal sidebar**; a **Synapse actions sidebar** (#289) gives touch-friendly buttons.

## Module Status (20 modules; the five thin folders above are omitted)

| Module | Path | Role | Status |
|--------|------|------|--------|
| modules | `src/modules/` | Ordered feature-module factory list; construct / settings-gated load / reverse unload (#504) | Working |
| checkpoints | `src/checkpoints/` | Startup interrupted-operation prompt, `manage-checkpoints`, sidebar resume/discard (#496) | Working |
| elaboration | `src/elaboration/` | Detect stubs, propose a full-body rewrite (image-aware, vision model passed per call); accept replaces the body under preserved frontmatter, stale-body confirm (#552); backlink + tag context under a 6000-char budget (#500) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); per-provider model registry (#521); sectioned post-processing (#467); no-speech outcome (#524); clipping through a structural `AudioClipper` (no video import) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram via yt-dlp/ffmpeg; `captionsFirst` toggle (#184) | Working (download tier desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models (per-call model override), auto-downscale via `shared`, batch + checkpoints | Working |
| transcription | `src/transcription/` | Unified modals, time-range modal (#464), URL tier router over the transcript cache (#184/#488), hardened caption fetch (#501); contracts in `types.ts` | Working (clipping desktop only) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter; vocabulary tags and frontmatter values can go through the System 1 lane (#558/#563) | Working |
| summarize | `src/summarize/` | URL/transcription/audio + note prose; per-item or combined (#367); media URLs are transcribe-only (#488); link-only notes excluded (#544); downloaded video embedded once (#561) | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring, folder coalescing (#172); every relocation a proposal; undo a whole run (#558/#565); `suggestDirectory` seam for deep-dive | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes; auto-organize nesting via injected folder suggestion | Working |
| title | `src/title/` | Untitled/mismatch detection → rename; collision handling (#408); backlink remediation (#485) | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery; always-on semantic matching (#380); lane-only scoring when System 1 is on (#566); accept re-validates link positions against the live note (#575) | Working |
| illustrate | `src/illustrate/` | AI-chosen spots get a licensed photo (Wikimedia Commons / Openverse) or, with `illustrate.mermaid` on, a Mermaid diagram / chart from the note's own numbers; per-item review; post-op legs via `runAfter` (#213/#549) | Working (opt-in, default off) |
| intake | `src/intake/` | Watch folder (#111); media-URL transcription (#112); shared-capture adoption (#455); startup catch-up scan (#462) | Working |
| pipeline | `src/pipeline/` | Fire Synapse runner + post-op hook builders (enrich → title check, auto-organize, illustrate leg) | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient (+ cache/coalescing, `onCacheHit`, per-call `model`), `NoteOperationQueue`, `TranscriptCache`, callout registry with native bases (#554), insertion-point placement (#213), prose reduction (#544), build info (#542), image preprocessing, no-speech outcome, `ModuleDeps` contract, validation, checkpoints, redaction, settings migrations (v3) | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar (seven proposal kinds) + Synapse actions sidebar; direct `editorCallback` dispatch (#352) | Working |

## Current Focus

- **Docs refresh (2026-10-09)** — machine docs and these human docs updated for the 1.4.0 release and the REM stale-offset fix (#575). The interactive system diagram (`docs/diagrams/synapse-system.html`) shows TypeSafe.
- **Open follow-ups**: live before/after cost measurement of the System 1 lane on a real vault; run auto-enrich once after a note's operation chain (#536); feature flags for unreleased work on main (#545); self-hosted extraction tier for non-YouTube URLs on mobile (#181, ADR 001 accepted; #182 override + connectivity status); holistic UX review (#465); operation-toast cancel progress (#269).

## Security Posture

- **No critical or high vulnerabilities**; API keys live in gitignored `data.json` and never reach the repo.
- **Redaction is lint-enforced** (#418): `synapse/no-unredacted-console` fails CI on any console sink that is not already a redacted string. `redactSecrets`/`redactError` in `shared/redact.ts` are the single source.
- **Caption path hardened** (#501): caption tracks fetch only over `https:` from `youtube.com`/`googlevideo.com`; player JSON is capped at 8 MiB and the track body at 16 MiB; chapter titles and cue text are escaped.
- **Subprocesses** use `execFile` with argument arrays, an allowlisted env, and `--` before every URL positional (download and duration probe); the dependency probe runs the configured tool path through `sanitizePath`; clipped-audio temp files are removed on every exit path. **Node access** is behind `assertDesktop()`/`loadNodeModules()` so `isDesktopOnly: false` stays mobile-safe.
- **Outbound URLs are scheme-checked**: Illustrate writes only `http:`/`https:` provider URLs into a note; a Reddit share page can only redirect the follow-up fetch to Reddit. Illustrate sends an AI-proposed search query, never note text, and is off by default.
- **Release workflows** take tag/version strings through `env` with a strict `X.Y.Z` check instead of interpolating expressions into the shell.
- **Every outbound request has a timeout** (AI and System 1 decisions 2 min; captions, fetchers, Illustrate search and download 30 s; credential probes and update check 10 s), so a stalled host can never hang a scan.
- **System 1 lane is opt-in** (#558): off by default because note text is sent to TypeSafe; it runs inside the same seat code paths, so every exclusion rule applies, and it can only choose among options the vault already has.
- **Fetched content is fenced** against prompt injection (`wrapUntrusted`, #398), including elaboration's related-notes block (#500) and the note Illustrate analyzes.
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (author-supplied URLs in the user's own vault).
- **Not yet wired**: `ensureWithinVault` exists but is not enforced on write paths.

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Non-YouTube URLs on mobile | Medium | TikTok/Instagram need yt-dlp; on mobile the note stays un-stamped for desktop sync until the self-hosted tier (#181, ADR 001) ships |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `local-whisper` hidden from the dropdown and throws; "coming soon" command; `FrameExtractor` placeholder |
| No-speech detection is heuristic beyond `whisper-1` | Low | `no_speech_prob` exists only in `whisper-1` `verbose_json`; other models rely on the blank/annotation-only check. The 0.8 and 10-character thresholds are conservative constants, not measured (#524) |
| Silent intake video gets a second notice | Low | Intake stamps the note after a no-speech result; summarize then retries the same URL and shows the same notice (no negative cache entry, #524) |
| Legacy `[!synapse-*]` callouts are never migrated | Low | Read by the dual-format matcher and rewritten only when a feature touches the note (#554); `synapse-elaboration` survives only to render pre-#552 notes |
| `ensureWithinVault` not wired to writes | Low | Helper exists; no write-boundary enforcement yet |
| Ribbon icons always visible; image checkpoint resume is a no-op | Low | No `removeRibbonIcon` API; resume discards + asks to re-run (same as deep-dive) |
| Back-edges from the base layer | Low | Type-only: `shared/settings-section.ts → main` (the audio → video one is gone, replaced by `AudioClipper`). Runtime: `shared/settings-reset.ts → settings` (`DEFAULT_SETTINGS`); acyclic because `settings.ts` reaches `shared` only via `settings-migrations.ts` |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change (#380) |

## External Dependencies (no npm runtime dependencies)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTP) | YouTube caption tier — no install needed | Works on every platform |
| yt-dlp | Video download (captionless YouTube, TikTok, Instagram, time-range clips) | User-installed; PATH auto-resolved (desktop only) |
| ffmpeg / ffprobe | Audio extraction, duration, clipping | User-installed; PATH auto-resolved (desktop only) |
| OpenAI / Anthropic / Gemini API keys | Chat models (incl. vision); Whisper + Gemini audio transcription | User-configured |
| Deepgram API key | Deepgram transcription (optional; pinned to `nova-3-general`, #521) | User-configured |
| Wikimedia Commons / Openverse (HTTP) | Illustrate photo search — keyless | Works on every platform; Illustrate is opt-in |
| TypeSafe API key (`api.typesafe.ai`) | System 1 decision lane (Jev) | User-configured; opt-in, off by default |

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development; stamps the dev-build banner, #542) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **2808/2808 passing** (204 files) |
| `npm run lint` | ESLint — `obsidianmd/*` store-review mirror + `synapse/no-unredacted-console` (#418) |
