# Project Status

**Last updated**: 2026-06-20
**Version**: 1.0.3
**Branch**: `main`
**Health**: Green — `tsc` clean, **1511/1511 tests passing (114 files)**, dependency graph acyclic, no critical/high security findings.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

---

## At a Glance

- **17 modules** under `src/` plus top-level `main.ts`, `settings.ts`, `settings-tab.ts`, and `onboarding.ts`.
- **Fire Synapse pipeline** runs features in order: elaboration → summarize → enrichment → REM → tidy → organize.
- **Intake folder** auto-processes dropped notes/URLs through that same pipeline.
- All AI output is reviewed in one **unified proposal sidebar**; per-feature **auto-accept** (#228) is available and defaults off.
- A second **Synapse actions sidebar** (#289) gives mobile users touch-friendly buttons for every enabled command.
- **Path exclusions** are centralized in one `exclusions` list (#307); **first-run onboarding** (#89) and **guided key validation** (#335) ease setup.

---

## Module Status (17 modules)

| Module | Path | Role | Status |
|--------|------|------|--------|
| elaboration | `src/elaboration/` | Detect stub notes, propose content (image-aware) | Working |
| audio | `src/audio/` | Transcribe audio (Whisper / Deepgram / Gemini); auto-lyrics (#234) | Working (local-whisper not impl.) |
| video | `src/video/` | Download + transcribe YouTube/TikTok/Instagram | Working (desktop only; local file + frames not impl.) |
| image | `src/image/` | OCR via vision models, auto-downscale, batch + checkpoints | Working |
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
| shared | `src/shared/` | AIClient, validation, checkpoints, callouts, URL detection, exclusions, node-loader, credential validation | Working (base layer) |
| views | `src/views/` | Unified proposal sidebar + Synapse actions sidebar | Working |

Top-level `onboarding.ts` is a small pure module powering the first-run welcome (#89).

---

## Current Focus

- **Codebase audit (2026-06-20)** — architecture, security, and Obsidian-guideline compliance verified clean. The graph is acyclic and the code is security-mature; the one fix was a lifecycle leak: in-flight notification ellipsis timers are now torn down on unload via `NotificationManager.dispose()`. Companion hygiene: barrel-import normalization, `.gitignore` credential hardening, and a refresh of the machine-readable `AGENTS.md` docs.
- **Recent feature work (1.0.x)**: centralized path exclusions + migration (#307); guarded desktop-only Node loader (#299); Synapse actions sidebar for mobile (#289); first-run onboarding (#89); guided API-key validation, OAuth deferred (#335); transcription credentials hoisted to AI Configuration (#332); content-type registry + lyrics auto-format (#233/#234); "Review" action on proposal toasts (#340); semantic theme color tokens (#342).

---

## Security Posture

- The full audit found **no critical or high vulnerabilities**; the codebase is security-mature.
- API keys live in `data.json`, which is **gitignored and never committed** — no secrets in the repo.
- Subprocess calls use `execFile` with argument arrays (no shell); API auth is header-based and HTTPS-only; AI responses are sanitized before being written to notes.
- Secret redaction has a single source of truth (`shared/redact.ts`), used by the AI client and `api-utils:notifyError` — covers OpenAI/Anthropic `sk-`, `key-`, Deepgram `dg-`, `Bearer`/`Token`, `anthropic-`, and Google `AIza` keys.
- Credential validation (#335) probes each provider with one minimal GET; results route through redaction and are **ephemeral** (never persisted).
- Multipart Whisper upload bodies sanitize vault-derived field/file names (`sanitizeMultipartHeaderValue`) to block header/multipart injection; Gemini audio places its instruction in `system_instruction` (prompt-injection hardening).
- Desktop-only Node access is gated behind `assertDesktop()`/`loadNodeModules()` (`shared/node-loader.ts`), keeping `isDesktopOnly: false` mobile-safe.
- Notification ellipsis timers are now torn down on unload (no orphaned `setInterval` after disable/reload).
- **Accepted risk**: `sanitizeUrl` permits arbitrary hosts (an SSRF surface on user-supplied URLs) — accepted because URLs are author-supplied within the user's own vault.
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
| `npm test` | Vitest — **1511/1511 passing** (114 files) |
| `npm run test:coverage` | Vitest with coverage |
