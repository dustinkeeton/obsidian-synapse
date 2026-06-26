# Project Status

**Last updated**: 2026-06-25
**Version**: 1.0.6
**Branch**: `chore/codebase-audit-2026-06-25`
**Health**: Green — `tsc` clean, **1692/1692 tests passing (123 files)**, dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

---

## At a Glance

- **17 modules** under `src/` plus top-level `main.ts`, `settings.ts`, `settings-tab.ts`, `onboarding.ts`, `brand-icons.ts`, `changelog.ts`/`changelog-modal.ts`, and `properties-fold.ts`.
- **Fire Synapse pipeline** runs features in order: elaboration → summarize → enrichment → REM → tidy → organize.
- **Intake folder** auto-processes dropped notes/URLs through that same pipeline.
- All AI output is reviewed in one **unified proposal sidebar**; per-feature **auto-accept** (#228) is available and defaults off. A second **Synapse actions sidebar** (#289) gives touch-friendly buttons for every enabled command.
- **REM** now runs semantic matching **always-on**, down-weighting literal title matches (#380); **elaboration** uses the note title as a signal with anti-fabrication guards (#387).
- **Summarize** can include a note's own prose and emit one combined summary (#367, both default on).
- An **in-app update check** (#365) and a **"What's new" changelog modal** (#375) keep users current; **on-brand icons** appear throughout (1.0.5).

---

## Module Status (17 modules)

| Module | Path | Role | Status |
|--------|------|------|--------|
| elaboration | `src/elaboration/` | Detect stubs, propose content (image-aware); title signal + anti-fabrication guards (#387) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); auto-lyrics (#234) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram; dependency onboarding notice (#382) | Working (desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models, auto-downscale, batch + checkpoints | Working |
| transcription | `src/transcription/` | Unified transcription/OCR UI + time-range clipping | Working (desktop-only clipping) |
| enrichment | `src/enrichment/` | Tags, links, refs, frontmatter | Working |
| summarize | `src/summarize/` | URL/transcription/audio + note prose; per-item or combined (#367) | Working |
| tidy | `src/tidy/` | Spelling/formatting fixes (+ undo) | Working |
| organize | `src/organize/` | AI directory structuring, folder coalescing (#172) | Working |
| deep-dive | `src/deep-dive/` | Recursive topic extraction + child notes | Working |
| title | `src/title/` | Untitled/mismatch detection → rename | Working |
| rem | `src/rem/` | In-place `[[wikilink]]` discovery; always-on semantic matching (#380) | Working |
| intake | `src/intake/` | Watch folder, auto-process notes (#111) | Working (media branch stubbed, #112) |
| pipeline | `src/pipeline/` | Fire Synapse ordered multi-phase runner | Working |
| commands | `src/commands/` | Command registry + registrar + drift audit | Working |
| shared | `src/shared/` | AIClient, validation, checkpoints, callouts, URL detection, exclusions, node-loader, credential validation, secret redaction, update checker | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar + Synapse actions sidebar | Working |

Top-level helpers: `onboarding.ts` (first-run welcome, #89), `brand-icons.ts` (Synapse SVG icons), `changelog.ts`/`changelog-modal.ts` ("What's new" modal, #375), `properties-fold.ts` (auto-fold Properties, #381).

---

## Current Focus

- **Codebase audit (2026-06-25)** — refreshed all 18 `AGENTS.md` files and these human docs against the live code. Two small fixes: secret redaction now also guards the per-operation error `console.error` sink (so the single redaction source covers *every* error path in `notifications.ts`), and one command name was normalized for palette consistency. `tsc` clean, 1692 tests green, graph acyclic, no critical/high security findings.
- **Recent feature work (1.0.4–1.0.6 and since)**: combined / note-content summaries (#367); in-app update check (#365); "What's new" changelog modal (#375); auto-fold Properties (#381); video-dependency onboarding notice (#382); always-on REM semantic matching (#380); elaboration title signal + anti-fabrication guards (#387); persistent copy-on-dismiss error notices + softer color (1.0.6); on-brand icon system (1.0.5).

---

## Security Posture

- The full audit found **no critical or high vulnerabilities**; the codebase is security-mature.
- API keys live in `data.json`, which is **gitignored and never committed** — no secrets in the repo.
- Subprocess calls use `execFile` with argument arrays (no shell); API auth is header-based and HTTPS-only; AI responses are sanitized before being written to notes.
- Secret redaction has a single source of truth (`shared/redact.ts`), now used on **every error path** — the AI client, credential validation, and all of `notifications.ts` (the error toast, `notifyError`, and the per-operation error `console.error`). Covers OpenAI/Anthropic `sk-`, `key-`, Deepgram `dg-`, `Bearer`/`Token`, `anthropic-`, and Google `AIza` keys.
- Credential validation (#335) probes each provider with one minimal GET; results route through redaction and are **ephemeral** (never persisted).
- Multipart Whisper bodies sanitize vault-derived field/file names (`sanitizeMultipartHeaderValue`); Gemini audio places its instruction in `system_instruction` (prompt-injection hardening).
- Desktop-only Node access is gated behind `assertDesktop()`/`loadNodeModules()` (`shared/node-loader.ts`), keeping `isDesktopOnly: false` mobile-safe. Notification ellipsis timers are torn down on unload.
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (an SSRF surface) — accepted because URLs are author-supplied within the user's own vault.
- **Not yet wired**: an `ensureWithinVault` helper exists but is **not** yet enforced on write paths.

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
| `audio → video` type-only back-edge | Low | No runtime cycle; cleanup = move `AudioExtractor` into `shared/` |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change (#380) |

---

## External Dependencies

| Dependency | Required for | Status |
|------------|--------------|--------|
| yt-dlp | Video download | User-installed; PATH auto-resolved (desktop only) |
| ffmpeg / ffprobe | Audio extraction, duration, clipping | User-installed; PATH auto-resolved (desktop only) |
| OpenAI API key | Whisper, GPT models (incl. vision) | User-configured |
| Anthropic API key | Claude models (incl. vision) | User-configured |
| Gemini API key | Gemini models + Gemini audio transcription (optional) | User-configured |
| Deepgram API key | Deepgram transcription (optional) | User-configured |

No npm runtime dependencies.

---

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | esbuild watch (development) |
| `npm run build` | `tsc -noEmit -skipLibCheck` + esbuild production bundle |
| `npm test` | Vitest — **1692/1692 passing** (123 files) |
| `npm run test:coverage` | Vitest with coverage |
