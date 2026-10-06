# Project Status

**Last updated**: 2026-10-06
**Version**: 1.1.0 (released 2026-09-15)
**Health**: Green — `tsc` clean, **2668/2668 tests passing (196 files)**, lint clean, dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

---

## At a Glance

- **24 modules** under `src/` (including the thin `settings-ui/`, `onboarding/`, `brand-icons/`, `changelog/`, and `properties-fold/` folders) plus top-level `main.ts` and `settings.ts`. New since 1.0.13: `modules/` (feature-module registry, #504) and `checkpoints/` (checkpoint recovery UX, #496). **`main.ts` is lifecycle glue** (295 lines, down from 1018): the registry constructs, loads, and unloads every feature module, and every module constructor takes one `ModuleDeps` bundle first.
- **1.1.0 (2026-09-15)**: long transcripts are post-processed in sections instead of skipped (#467); intake catches up on un-stamped notes at startup (#462); elaboration prompts include backlinks and tags (#500); transcripts persist in a vault-file cache and media URLs are never page-summarized (#488); a per-provider "Transcription model" dropdown (#521); refreshed OpenAI/Anthropic model lists and a fix for OpenAI reasoning models (#308/#519); hardened YouTube caption path (#501).
- **Post-release changes (2026-09-17 → 2026-10-06)**: media with no speech writes nothing and says so (#524); every finish message reports when a cached transcript or AI response was used (#527); per-note buttons in the actions sidebar run on the first click (#352); **accepting an elaboration now replaces the note body in place** instead of appending a callout — frontmatter kept byte-for-byte, confirm modal if the note changed since the proposal (#552).
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → tidy → organize; the **intake folder** auto-feeds it. All AI output lands in one **unified proposal sidebar**; a **Synapse actions sidebar** (#289) gives touch-friendly buttons.

---

## Module Status (19 modules; the five thin folders above are omitted)

| Module | Path | Role | Status |
|--------|------|------|--------|
| modules | `src/modules/` | Ordered feature-module factory list; construct / settings-gated load / reverse unload (#504) | Working |
| checkpoints | `src/checkpoints/` | Startup interrupted-operation prompt, `manage-checkpoints`, sidebar resume/discard (#496) | Working |
| elaboration | `src/elaboration/` | Detect stubs, propose a full-body rewrite (image-aware); accept replaces the body under preserved frontmatter, stale-body confirm (#552); backlink + tag context under a 6000-char budget (#500); anti-fabrication guards (#387) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); per-provider model registry (#521); sectioned post-processing (#467); no-speech outcome (#524) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram via yt-dlp/ffmpeg; `captionsFirst` toggle (#184) | Working (download tier desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models, auto-downscale, batch + checkpoints | Working |
| transcription | `src/transcription/` | Unified modals, time-range modal (#464), URL tier router over the transcript cache (#184/#488), hardened caption fetch (#501) | Working (clipping desktop only) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter | Working |
| summarize | `src/summarize/` | URL/transcription/audio + note prose; per-item or combined (#367); media URLs are transcribe-only (#488) | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring, folder coalescing (#172) | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes | Working |
| title | `src/title/` | Untitled/mismatch detection → rename; collision handling (#408); backlink remediation (#485) | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery; always-on semantic matching (#380) | Working |
| intake | `src/intake/` | Watch folder (#111); media-URL transcription (#112); shared-capture adoption (#455); startup catch-up scan (#462) | Working |
| pipeline | `src/pipeline/` | Fire Synapse runner + post-op hook builders (enrich → title check, auto-organize) | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient (+ cache/coalescing + `onCacheHit`), `NoteOperationQueue`, `TranscriptCache`, cache-hit wording, no-speech outcome, `ModuleDeps` contract, validation, checkpoints, callouts, redaction, settings migrations (v3) + reset | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar + Synapse actions sidebar; direct `editorCallback` dispatch (#352) | Working |

---

## Current Focus

- **Elaboration rewrite (2026-10-06, #552 / PR #553)** — accept is a full-body rewrite under preserved frontmatter with a stale-body confirm; batch auto-accept skips a changed note and leaves the proposal pending. The `synapse-elaboration` callout survives only to render notes written before the change. Machine and human docs regrounded in the same pass.
- **Open follow-ups**: self-hosted extraction tier for non-YouTube URLs on mobile (#181, ADR 001 accepted; #182 override + connectivity status); holistic UX review (#465); operation-toast cancel progress (#269).

---

## Security Posture

- **No critical or high vulnerabilities**; API keys live in gitignored `data.json` and never reach the repo.
- **Redaction is lint-enforced** (#418): `synapse/no-unredacted-console` fails CI on any console sink that is not already a redacted string. `redactSecrets`/`redactError` in `shared/redact.ts` are the single source.
- **Caption path hardened** (#501): caption tracks fetch only over `https:` from `youtube.com`/`googlevideo.com`; player JSON is capped at 8 MiB and the track body at 16 MiB before parsing; chapter titles and cue text are escaped so a crafted caption cannot inject links, embeds, or tags.
- **Subprocesses** use `execFile` with argument arrays, an allowlisted env, and `--` before the URL positional; **Node access** is behind `assertDesktop()`/`loadNodeModules()` so `isDesktopOnly: false` stays mobile-safe.
- **Fetched content is fenced** against prompt injection (`wrapUntrusted`, #398) — now including elaboration's related-notes block (#500).
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (author-supplied URLs in the user's own vault).
- **Not yet wired**: `ensureWithinVault` exists but is not enforced on write paths.

---

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Non-YouTube URLs on mobile | Medium | TikTok/Instagram need yt-dlp; on mobile the note stays un-stamped for desktop sync until the self-hosted tier (#181, ADR 001) ships |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `local-whisper` hidden from the dropdown and throws; "coming soon" command; `FrameExtractor` placeholder |
| No-speech detection is heuristic beyond `whisper-1` | Low | `no_speech_prob` exists only in `whisper-1` `verbose_json`; other models rely on the blank/annotation-only check. The 0.8 and 10-character thresholds are conservative constants, not measured (#524) |
| Silent intake video gets a second notice | Low | Intake stamps the note after a no-speech result; summarize then retries the same URL and shows the same notice (no negative cache entry, #524) |
| `ensureWithinVault` not wired to writes | Low | Helper exists; no write-boundary enforcement yet |
| Ribbon icons always visible; image checkpoint resume is a no-op | Low | No `removeRibbonIcon` API; resume discards + asks to re-run (same as deep-dive) |
| Back-edges from the base layer | Low | Type-only: `audio → video` (`AudioExtractor`), `shared/settings-section.ts → main`. Runtime: `shared/settings-reset.ts → settings` (`DEFAULT_SETTINGS`); acyclic because `settings.ts` reaches `shared` only via `settings-migrations.ts` |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change (#380) |

---

## External Dependencies (no npm runtime dependencies)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTP) | YouTube caption tier — no install needed | Works on every platform |
| yt-dlp | Video download (captionless YouTube, TikTok, Instagram, time-range clips) | User-installed; PATH auto-resolved (desktop only) |
| ffmpeg / ffprobe | Audio extraction, duration, clipping | User-installed; PATH auto-resolved (desktop only) |
| OpenAI / Anthropic / Gemini API keys | Chat models (incl. vision); Whisper + Gemini audio transcription | User-configured |
| Deepgram API key | Deepgram transcription (optional; now pinned to `nova-3-general`, #521) | User-configured |

---

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **2668/2668 passing** (196 files) |
| `npm run lint` | ESLint — `obsidianmd/*` store-review mirror + `synapse/no-unredacted-console` (#418) |
