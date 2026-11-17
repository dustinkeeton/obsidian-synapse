# Project Status

**Last updated**: 2026-11-17
**Version**: 1.5.0 (released 2026-11-09)
**Health**: Green with one caveat — **3303/3303 tests passing (225 files)**; `tsc`, lint, build, `version-bump --check`, and `check-top-level-requires` clean; dependency graph acyclic; no critical/high findings in shipped code. `npm audit` reports **0 production vulnerabilities** but **12 high in the dev toolchain** (a `picomatch` ReDoS reached through `typescript-eslint`, `vite`, and `vitest`). Synapse ships no npm runtime dependency, so none reaches users.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

## At a Glance

- **25 modules** under `src/` plus `main.ts` (306 lines, lifecycle glue only) and `settings.ts`. `modules/registry.ts` constructs, loads, and unloads every feature.
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → illustrate → tidy → organize; the **intake folder** auto-feeds it. All proposals land in one **unified proposal sidebar**.
- **Settings schema is at v8** (`CURRENT_SETTINGS_VERSION`, `shared/settings-migrations.ts:25`).
- **Latest release, 1.5.0 (2026-11-09)**: an **In progress** section in the review pane (#577), top-level-only folder scans (#589), deep-dive auto-REM (#581), no links to missing notes, updated model lists.

## Merged Since 1.5.0 (unreleased)

| Change | What a user sees |
|--------|------------------|
| Per-feature models (#619, closes #596) | Each AI feature can pick its own provider, model, and **effort** (Default / Low / Medium / High / Max). One key per vendor, shared by chat and transcription. Temperature and max-tokens settings are gone |
| One AI request standard (#619) | No provider gets `temperature`/`top_p`/`top_k`; a reply cut off at its limit fails instead of being saved; reasoning models get a 10-minute timeout |
| Prompt-injection guard everywhere (#620) | Every AI feature now fences note text, transcripts, and metadata as data, and every request carries a "data, never instructions" rule |
| REM fixes (#606, #612) | The review sidebar no longer goes stale when REM is off. REM skips Synapse callouts, never links a note to itself or to an `Untitled` note, and keeps decimals like `Y14.5` in one sentence |
| No self-links in Related Notes (#610) | Enrichment never lists the note itself |
| Deep-dive links survive name clashes (#611) | Nav, syllabus, and `parent:` links are folder-qualified when another note shares the name |

**Release-note items from #619**: titles and elaboration proposals already rejected may be proposed once more; a separate Whisper or Gemini key from the same vendor as the default provider is dropped in favor of the main key.

## Current Focus

- **Release-readiness audit (2026-11-17, branch `release-readiness-audit`, uncommitted)** — small hardening found in the pass:
  - **CI runs read-only**: `ci.yml` now declares `permissions: contents: read`, like `waffle-doctor.yml`.
  - **Deep-dive run ids are checked** before they become a file name (`deep-dive/deep-dive-store.ts:32`).
  - **Gemini model ids are URL-encoded** in the transcription request too (`audio/transcriber.ts:480`), matching the chat client.
  - **One settings-reveal helper**: summarize's "Open settings" action now calls `revealSettingsSection` in `shared/settings-section.ts`.
- **Open follow-ups**: organize moves leave folder-qualified links dangling (#613); AI streaming (#614), OpenAI Responses API (#615), structured output (#616), Ollama capability discovery (#617), Gemini continuation (#618); auto-enrich once per chain (#536); self-hosted mobile extraction tier (#181, #182); UX review (#465); toast cancel progress (#269).

## Module Status (20 modules; five thin folders omitted)

| Module | Role | Status |
|--------|------|--------|
| modules | Feature-module registry: construct / gated load / reverse unload (#504) | Working |
| checkpoints | Startup interrupted-operation prompt, `manage-checkpoints`, sidebar resume/discard | Working |
| elaboration | Stub detection → full-body rewrite proposal (image-aware, backlink context) | Working |
| audio | Transcription (Whisper / Deepgram / Gemini) as the first per-feature model row (#619); sectioned post-processing | Working (local-whisper not impl.) |
| video | yt-dlp/ffmpeg download + transcription; `captionsFirst` | Working (desktop only; frames not impl.) |
| image | OCR via vision models, auto-downscale, batch | Working (resume asks for a re-run) |
| transcription | Unified modals, time-range clipping, URL tier router over the transcript cache | Working (clipping desktop only) |
| enrichment | Tags, links, refs, frontmatter; System 1 seats; no self-links (#610) | Working |
| summarize | URL / transcript / audio / note-prose summaries; media URLs transcribe-only | Working |
| tidy | Spelling and formatting fixes (+ undo) | Working |
| organize | Folder proposals, run-level undo; `suggestDirectory` for deep-dive | Working (#613 open) |
| deep-dive | Recursive child notes; auto-REM; resumable; qualified nav links (#611) | Working |
| title | Untitled/mismatch rename; collisions; backlink remediation | Working |
| rem | In-place `[[wikilink]]` discovery; callout skip + no self-targets (#612) | Working |
| illustrate | Licensed photos, optional Mermaid diagrams / charts; one image per note | Working (opt-in, off) |
| intake | Watch folder, media-URL transcription, shared-capture adoption | Working |
| pipeline | Fire Synapse runner + post-op hooks | Working |
| commands | Command registry, registrar, drift audit | Working |
| shared | AI client + per-feature config (`ai-config.ts`, #619), `safeRequest`, System 1 client, queue, caches, link guard, migrations (v8) | Working (base layer) |
| views | Unified proposal sidebar (7 kinds + In progress) + actions sidebar | Working |

## Security Posture

- **No critical or high vulnerabilities in shipped code**; API keys live in gitignored `data.json`.
- **Every AI request is injection-hardened** (#620): input fenced by `wrapUntrusted` with an unguessable per-block id, plus a policy rule on the first system message. A guard test fails any AI-calling file that fences less often than it calls.
- **Gap: the System 1 lane sends text unfenced** (off by default). It can only pick existing options, but injected text could bias which one.
- **Outbound requests time out**: AI chat 2 min, or 10 min for a reasoning model at any effort except Low; captions, fetchers, Illustrate 30 s; credential probes and update check 10 s.
- **Stored data is re-checked**: proposal/snapshot paths (`assertVaultRelativePath`), checkpoint ids, and now deep-dive run ids.
- **CI is least-privilege**: actions pinned to commit SHAs; `ci.yml` and `waffle-doctor.yml` read-only; only release and tag workflows can write.
- **Accepted risk**: links the user wrote may point at any host, local ones included. **Not yet wired**: `ensureWithinVault` on general write paths.

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| #619 and #620 not yet checked in the Obsidian app | Medium | Both PRs report CI green but no live-app test; worth doing before 1.6.0 |
| Organize moves break folder-qualified links | Medium | `vault.rename` does not update links (#613) |
| Non-YouTube URLs on mobile | Medium | Need yt-dlp; waits for the self-hosted tier (#181, ADR 001) |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `video.frameExtraction` settings exist, unread |
| Dev-toolchain advisories | Low | 12 high via `picomatch`; dev-only, not shipped |
| No-speech edge cases (#524) | Low | Heuristic beyond `whisper-1` |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change |

## External Dependencies (no npm runtime dependencies)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTPS) | YouTube caption tier | Every platform, no install |
| yt-dlp, ffmpeg / ffprobe | Video download, extraction, clipping | User-installed; desktop only |
| OpenAI / Anthropic / Gemini / Deepgram keys | Chat, vision, transcription — one key per vendor (`ai.providerKeys`) | User-configured |
| Ollama | Local chat models | HTTPS, or HTTP on localhost |
| Wikimedia Commons / Openverse | Illustrate photo search, keyless | Opt-in |
| TypeSafe (`api.typesafe.ai`) | System 1 decision lane | Opt-in, off by default |
