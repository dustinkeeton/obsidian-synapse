# Project Status

**Last updated**: 2026-06-11
**Version**: 0.3.2
**Branch**: `main`
**Health**: Green — `tsc` clean, 1256/1256 tests passing (98 files), dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

---

## At a Glance

- **17 feature modules** under `src/` plus `main.ts`, `settings.ts`, `settings-tab.ts`.
- **Fire Synapse pipeline** runs features in order: elaboration → summarize → enrichment → REM → tidy → organize.
- **Intake folder** auto-processes dropped notes/URLs through that same pipeline.
- All AI output is reviewed in one **unified proposal sidebar**; per-feature **auto-accept** (#228) is available and defaults off.

---

## Module Status (17 modules)

| Module | Path | Role | Status |
|--------|------|------|--------|
| elaboration | `src/elaboration/` | Detect stub notes, propose content (image-aware) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram | Working (local file + frames not impl.) |
| image | `src/image/` | OCR via vision models, batch + checkpoints | Working |
| transcription | `src/transcription/` | Unified transcription/OCR UI + time-range clipping | Working (desktop-only clipping) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter | Working |
| summarize | `src/summarize/` | URL + transcription summaries, content templates | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring, folder coalescing (#172) | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes | Working |
| title | `src/title/` | Untitled/mismatch detection → rename | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery | Working |
| intake | `src/intake/` | Watch folder, auto-process notes (#111) | Working (media branch stubbed, #112) |
| pipeline | `src/pipeline/` | Fire Synapse ordered multi-phase runner | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient, validation, checkpoints, callouts, URL detection | Working (base layer) |
| views | `src/views/` | Unified proposal + checkpoint sidebar | Working |

---

## Current Focus

- **Codebase audit (2026-06-11)** — architecture, machine + human docs refreshed; security re-audit in final pass. Changes: secret redaction consolidated into one canonical `shared/redact.ts` (now covers Gemini `AIza` keys); multipart transcription bodies hardened against header injection from vault-derived file names; shared-utility imports normalized to the `../shared` barrel and the stale static `summarize → video` import removed (injection-only now).
- **Decycling** — `shared ⇄ video` cycle eliminated; graph is acyclic. One **type-only** `audio → video` back-edge remains (no runtime cycle; flagged for cleanup).

---

## Security Posture

- Full audit found **no critical or high vulnerabilities**; the codebase is security-mature.
- API keys live in `data.json`, which is **gitignored and never committed** — no secrets in the repo.
- Subprocess calls use `execFile` with argument arrays (no shell); API auth is header-based and HTTPS-only; AI responses are sanitized before being written to notes.
- Secret redaction now has a single source of truth (`shared/redact.ts`), used by both the AI client and `notifyError` — closes a drift where Gemini `AIza` keys could surface unredacted.
- Multipart Whisper upload bodies sanitize vault-derived field/file names (`sanitizeMultipartHeaderValue`) to block header/multipart injection.
- One low-severity hardening applied earlier: sanitize a vault-derived basename before a temp path in `duration-detector.ts`.
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (an SSRF surface on user-supplied URLs) — accepted because URLs are author-supplied within the user's own vault.
- **Not yet wired**: an `ensureWithinVault` helper exists but is **not** yet enforced on write paths — there is no active vault-boundary check on writes today.

---

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Local Whisper provider | Medium | `local-whisper` throws on use |
| Local video file transcription | Medium | Command shows "coming soon" |
| Video frame extraction | Medium | `FrameExtractor` is a placeholder |
| Intake media-transcription branch | Medium | Stubbed, no-ops with a notice (#112) |
| `ensureWithinVault` not wired to writes | Low | Helper exists; no write-boundary enforcement yet |
| Ribbon icons always visible | Low | Obsidian has no `removeRibbonIcon` API |
| Image checkpoint resume is a no-op | Low | Discards + asks user to re-run (same as deep-dive) |

---

## External Dependencies

| Dependency | Required for | Status |
|------------|--------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved |
| ffmpeg / ffprobe | Audio extraction, duration, clipping | User-installed; PATH auto-resolved |
| OpenAI API key | Whisper, GPT models (incl. vision) | User-configured |
| Anthropic API key | Claude models (incl. vision) | User-configured |
| Gemini API key | Gemini models + Gemini audio transcription (optional) | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |

---

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **1256/1256 passing** (98 files) |
| `npm run test:coverage` | Vitest with coverage |
