# Project Status

**Last updated**: 2026-11-09
**Version**: 1.4.1 (released 2026-10-09)
**Health**: Green — **3146/3146 tests passing (221 files)**; `tsc`, lint, build, `version-bump --check`, and `check-top-level-requires` clean; `npm audit` reports 0 vulnerabilities; dependency graph acyclic; no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

## At a Glance

- **25 modules** under `src/` (including the thin `settings-ui/`, `onboarding/`, `brand-icons/`, `changelog/`, and `properties-fold/` folders) plus top-level `main.ts` (306 lines — lifecycle glue only; `modules/registry.ts` constructs, loads, and unloads every feature with one `ModuleDeps` bundle first) and `settings.ts`.
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → illustrate → tidy → organize; the **intake folder** auto-feeds it. All proposals land in one **unified proposal sidebar**; a **Synapse actions sidebar** (#289) gives touch-friendly buttons.
- **Latest release, 1.4.1 (2026-10-09)**: REM accept re-checks each link position against the live note and skips what it cannot find (#575). 1.4.0 added the opt-in **System 1 decision lane** (#558), proposal-only organize moves with **Undo last organize run**, and the **Voice** setting (#540).

## Merged Since 1.4.1 (unreleased)

| Change | What a user sees |
|--------|------------------|
| No links to missing notes (#581) | AI-written or fetched text never leaves a `[[link]]` to a note that doesn't exist. Deep-dive notes are plain prose and get REM-scanned on accept (`deepDive.autoRemOnAccept`, default on), quietly (#585) |
| One image per note (#583) | Illustrate places each image at most once per note and skips a photo already in the note |
| Top-level-only folder scans (#589) | A second picker row scans the vault root's top level; Shift+Enter or Shift+click scans a folder without its subfolders |
| Deep dives survive a dropped connection (#595) | A run cut off mid-generation keeps its remaining queue and resumes from its checkpoint; dropped requests retry once Obsidian is back in the foreground |
| Latest models everywhere (#597) | Model lists re-verified against vendor docs; a saved retired model id is repointed automatically (settings v4); new installs default to Anthropic `opus`; Whisper/Gemini transcription borrow the shared AI key only when it is that vendor's |
| Running work shows in the review pane (#577) | An **In progress** section lists each running proposal-producing operation with live progress; toast-backed runs get a **Cancel** button |

## Current Focus

- **Pre-release audit of the whole codebase (2026-11-09, branch `release-codebase-audit`)** — closed the defense-in-depth gaps listed under Security Posture, moved each module's shared type contracts into its `types.ts`, and regrounded the machine docs and these human docs. A follow-up round the same day closed what the audit left open: four dead files removed (the frame-extractor placeholder and three unregistered legacy review surfaces), the note scanners moved to `shared/` so `video → audio` is the only feature → feature runtime import (the re-rendered system diagram, `docs/diagrams/synapse-system.html`, says so), CI actions pinned to commit SHAs, and dev-dependency advisories cleared.
- **Open follow-ups**: live before/after cost measurement of the System 1 lane on a real vault; run auto-enrich once after a note's operation chain (#536); feature flags for unreleased work on main (#545); self-hosted extraction tier for non-YouTube URLs on mobile (#181, ADR 001 accepted; #182 override + connectivity status); holistic UX review (#465); operation-toast cancel progress (#269).

## Module Status (20 modules; the five thin folders above are omitted)

| Module | Path | Role | Status |
|--------|------|------|--------|
| modules | `src/modules/` | Ordered feature-module factory list; construct / settings-gated load / reverse unload (#504) | Working |
| checkpoints | `src/checkpoints/` | Startup interrupted-operation prompt, `manage-checkpoints`, sidebar resume/discard (#496) | Working |
| elaboration | `src/elaboration/` | Detect stubs, propose a full-body rewrite (image-aware); accept replaces the body under preserved frontmatter, stale-body confirm (#552); backlink + tag context (#500) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); per-provider model registry (#521); sectioned post-processing (#467); no-speech outcome (#524) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram via yt-dlp/ffmpeg; `captionsFirst` toggle (#184) | Working (download tier desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models (per-call model override), auto-downscale, batch + checkpoints | Working (checkpoint resume asks for a re-run) |
| transcription | `src/transcription/` | Unified modals, time-range modal (#464), URL tier router over the transcript cache (#184/#488), hardened caption fetch (#501) | Working (clipping desktop only) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter; vocabulary tags and frontmatter values can go through the System 1 lane (#558/#563) | Working |
| summarize | `src/summarize/` | URL/transcription/audio + note prose; per-item or combined (#367); media URLs are transcribe-only (#488); summarized content is fenced as untrusted | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring; every relocation a proposal; undo a whole run (#558/#565); `suggestDirectory` seam for deep-dive | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes as plain prose; auto-REM on accept (#581); resumes an interrupted run from its saved queue (#595) | Working |
| title | `src/title/` | Untitled/mismatch detection → rename; collision handling (#408); backlink remediation (#485) | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery; lane-only scoring when System 1 is on (#566); accept re-validates link positions (#575); silent post-op scans (#585) | Working |
| illustrate | `src/illustrate/` | AI-chosen spots get a licensed photo (Wikimedia Commons / Openverse) or, with `illustrate.mermaid` on, a diagram / chart; per-item review; one image per note (#583) | Working (opt-in, default off) |
| intake | `src/intake/` | Watch folder (#111); media-URL transcription (#112); shared-capture adoption (#455); startup catch-up scan (#462) | Working |
| pipeline | `src/pipeline/` | Fire Synapse runner + post-op hook builders (enrich → title check, deep-dive REM leg, illustrate leg, auto-organize) | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient (+ cache, per-call `model`), `safeRequest` (dropped-connection retry, #595), System 1 `DecisionClient`, `NoteOperationQueue`, `TranscriptCache`, callouts, scan scope (#589), in-progress registry (#577), link guard (#581), redaction, settings migrations (v4), checkpoints | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar (seven proposal kinds + In progress section, #577) + Synapse actions sidebar; direct `editorCallback` dispatch (#352) | Working |

## Security Posture

- **No critical or high vulnerabilities**; API keys live in gitignored `data.json` and never reach the repo.
- **Fetched content is fenced** against prompt injection (`wrapUntrusted`, #398). The 2026-11-09 audit closed the last two unfenced paths: everything summarize sends to the model, and the tweet text enrichment fetches. Audio post-processing also fences the transcript as text to edit, not instructions.
- **Illustrate distrusts what providers send** (2026-11-09): it percent-encodes `( ) < >` and whitespace in the `http(s)` URLs it writes, flattens link text and attribution to plain text, rejects a download that is not an image, and refuses to download from or fetch a loopback, private-network, link-local, or unqualified host (`sanitizePublicUrl`, a hostname check).
- **Stored paths are re-checked before use** (2026-11-09): deep-dive accept, organize accept, and organize undo validate the path saved in a proposal or snapshot (`assertVaultRelativePath`); title accept rejects a stored title that is a path.
- **Temp files are unguessable and always removed** (2026-11-09): OS-temp names carry a random (CSPRNG) suffix; video download and transcription unlink their temp audio/video on every exit path, as audio clipping already did.
- **Undocumented Obsidian APIs are feature-detected** (`app.commands`, `getBacklinksForFile`, the picker's `useSelectedItem`); each degrades instead of throwing.
- **Redaction is lint-enforced** (#418): `synapse/no-unredacted-console` fails CI on any console sink that is not already a redacted string. **CI actions are pinned** to commit SHAs.
- **Subprocesses** use `execFile` with argument arrays, an allowlisted env, and `--` before every URL. **Node access** is behind `assertDesktop()`/`loadNodeModules()` so `isDesktopOnly: false` stays mobile-safe.
- **Every outbound request has a timeout** (AI and System 1 decisions 2 min; captions, fetchers, Illustrate 30 s; credential probes and update check 10 s).
- **Opt-in network features**: the System 1 lane sends note text to TypeSafe; Illustrate sends an AI-proposed search query, never note text. Both are off by default.
- **Accepted risk**: links the user wrote into a note (fetched by summarize and elaboration) may point at any host, local ones included. **Not yet wired**: `ensureWithinVault` is not enforced on write paths.

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Non-YouTube URLs on mobile | Medium | TikTok/Instagram need yt-dlp; on mobile the note stays un-stamped for desktop sync until the self-hosted tier (#181, ADR 001) ships |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `local-whisper` hidden from the dropdown and throws; "coming soon" command; the `video.frameExtraction` settings exist but no feature reads them |
| No-speech edge cases (#524) | Low | Detection is heuristic beyond `whisper-1` (only its `verbose_json` carries `no_speech_prob`); a silent intake video gets a second notice when summarize retries the same URL |
| Legacy `[!synapse-*]` callouts are never migrated | Low | Read by the dual-format matcher and rewritten only when a feature touches the note (#554) |
| Ribbon icons always visible; image checkpoint resume is a no-op | Low | No `removeRibbonIcon` API; image resume discards + asks to re-run |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change (#380) |

## External Dependencies (no npm runtime dependencies)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTPS) | YouTube caption tier — no install needed | Works on every platform |
| yt-dlp, ffmpeg / ffprobe | Video download, audio extraction, duration, clipping | User-installed; PATH auto-resolved (desktop only) |
| OpenAI / Anthropic / Gemini API keys | Chat models (incl. vision); Whisper + Gemini audio transcription | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |
| Wikimedia Commons / Openverse (HTTP) | Illustrate photo search — keyless | Works on every platform; Illustrate is opt-in |
| TypeSafe API key (`api.typesafe.ai`) | System 1 decision lane (Jev) | User-configured; opt-in, off by default |

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development; stamps the dev-build banner, #542) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **3146/3146 passing** (221 files) |
| `npm run lint` | ESLint — `obsidianmd/*` store-review mirror + `synapse/no-unredacted-console` (#418) |
