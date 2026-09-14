# Project Status

**Last updated**: 2026-09-14
**Version**: 1.0.13
**Health**: Green — `tsc` clean, **2007/2007 tests passing (150 files)**, lint clean, dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

---

## At a Glance

- **17 modules** under `src/` plus top-level `main.ts`, `settings.ts`, `settings-tab.ts`, `onboarding.ts`, `brand-icons.ts`, `changelog.ts`/`changelog-modal.ts`, and `properties-fold.ts`.
- **No source changes since 2026-08-17.** PRs #491–#493 (2026-09-13/14) were tooling only: vitest devDep bump, wafflestack 0.8.0 → 0.15.0, and pruning non-development files (`START.md`, `docs/PRD-MVP.md`, generated `.waffle` overviews) from the public tree.
- **YouTube transcribes from captions on every platform** (#184, 1.0.13): a tiered `UrlTranscriptionRouter` tries free HTTP captions first, then desktop yt-dlp/ffmpeg. Caption transcripts get speaker turns, linked chapter headings, and pause paragraphs with no AI cost (#469). The Transcribe ribbon and commands are registered on desktop **and** mobile.
- **Intake media branch is real** (#112 closed): a bare video URL dropped in the inbox is transcribed, run through the full pipeline, and stamped; on failure the note stays un-stamped so a synced desktop vault retries. Opt-in `intake.adoptSharedCaptures` (#455) pulls share-sheet captures from the vault root into the inbox.
- **August fixes**: one shared `NoteOperationQueue` (#483) serializes every read → AI → write cycle on the same note, ending the transcribe-then-elaborate race; title renames now rewrite inbound `[[wikilinks]]` with display text preserved byte-for-byte (#485).
- **Time-range choice is a modal** (#464): dismissing it cancels — it never silently transcribes the whole file.
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → tidy → organize; the **intake folder** auto-feeds it. All AI output lands in one **unified proposal sidebar**; a **Synapse actions sidebar** (#289) gives touch-friendly buttons.

---

## Module Status (17 modules)

| Module | Path | Role | Status |
|--------|------|------|--------|
| elaboration | `src/elaboration/` | Detect stubs, propose content (image-aware); title signal + anti-fabrication guards (#387) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); auto-lyrics (#234); token guard on post-processing (#468) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram via yt-dlp/ffmpeg; `captionsFirst` toggle (#184) | Working (download tier desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models, auto-downscale, batch + checkpoints | Working |
| transcription | `src/transcription/` | Unified modals, time-range modal (#464), URL tier router + YouTube caption fetcher (#184) | Working (clipping desktop only) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter | Working |
| summarize | `src/summarize/` | URL/transcription/audio + note prose; per-item or combined (#367) | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring, folder coalescing (#172) | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes | Working |
| title | `src/title/` | Untitled/mismatch detection → rename; collision handling (#408); backlink remediation (#485) | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery; always-on semantic matching (#380) | Working |
| intake | `src/intake/` | Watch folder, auto-process notes (#111); media-URL transcription (#112); shared-capture adoption (#455) | Working |
| pipeline | `src/pipeline/` | Fire Synapse ordered multi-phase runner | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient (+ cache/coalescing), `NoteOperationQueue` (#483), validation, checkpoints, callouts, URL detection, exclusions, node-loader, credential validation, secret redaction, settings migrations + reset, untrusted-content fence, review-action gate, update checker | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar + Synapse actions sidebar | Working |

---

## Current Focus

- **Codebase audit (2026-09-14)** — architecture and security re-verified clean; machine docs (`AGENTS.md`, `docs/agent/*`) and these human docs regrounded against 1.0.13 and the August fixes. No shipped code changed.
- **Shipped since the last audit (2026-07-03)**: release **1.0.12** (sentence-case notices, lint-enforced redaction) and **1.0.13** (caption-first URL transcription on every platform #461/#463, deterministic caption formatting #469, time-range modal #464, post-processing token guard + filler removal off by default #468, mobile share-sheet intake #455). Post-release fixes: TikTok slideshow false positive (#480), README banner wordmark (#481), per-note operation queue (#483), backlink remediation on rename (#485).
- **Open follow-ups**: chunked post-processing for long transcripts (#467); server-side extractor for non-YouTube URLs on mobile (#181); transcription UX review (#465).

---

## Security Posture

- **No critical or high vulnerabilities**; API keys live in gitignored `data.json` and never reach the repo.
- **Redaction is lint-enforced** (#418): `synapse/no-unredacted-console` fails CI on any console sink that is not already a redacted string. `redactSecrets`/`redactError` in `shared/redact.ts` are the single source.
- **Subprocesses** use `execFile` with argument arrays and an allowlisted env; **Node access** is behind `assertDesktop()`/`loadNodeModules()` so `isDesktopOnly: false` stays mobile-safe.
- **Fetched content is fenced** against prompt injection (`wrapUntrusted`, #398); YouTube caption fetches go through `sanitizeUrl` and Obsidian `requestUrl` with a 30 s timeout.
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (author-supplied URLs in the user's own vault).
- **Not yet wired**: `ensureWithinVault` exists but is not enforced on write paths.

---

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Non-YouTube URLs on mobile | Medium | TikTok/Instagram need yt-dlp; on mobile the note stays un-stamped for desktop sync until #181 ships |
| Long-transcript post-processing | Medium | Transcripts over `ai.maxTokens` keep raw text instead of cleanup (#468); chunking is #467 |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `local-whisper` hidden from the dropdown and throws; "coming soon" command; `FrameExtractor` placeholder |
| `ensureWithinVault` not wired to writes | Low | Helper exists; no write-boundary enforcement yet |
| Ribbon icons always visible; image checkpoint resume is a no-op | Low | No `removeRibbonIcon` API; resume discards + asks to re-run (same as deep-dive) |
| Type-only back-edges | Low | `audio → video` (`AudioExtractor`) and `shared/settings-section.ts → main`; erased at compile time, no runtime cycle |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change (#380) |

---

## External Dependencies (no npm runtime dependencies)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTP) | YouTube caption tier — no install needed | Works on every platform |
| yt-dlp | Video download (captionless YouTube, TikTok, Instagram, time-range clips) | User-installed; PATH auto-resolved (desktop only) |
| ffmpeg / ffprobe | Audio extraction, duration, clipping | User-installed; PATH auto-resolved (desktop only) |
| OpenAI / Anthropic / Gemini API keys | Chat models (incl. vision); Whisper + Gemini audio transcription | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |

---

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **2007/2007 passing** (150 files) |
| `npm run lint` | ESLint — `obsidianmd/*` store-review mirror + `synapse/no-unredacted-console` (#418) |
