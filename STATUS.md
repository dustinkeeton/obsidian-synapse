# Project Status

**Last updated**: 2026-11-20
**Version**: 1.6.0 (released 2026-11-17); 1.7.0 in pre-release audit
**Health**: Green — **3494/3494 plugin tests passing (233 files)** and **32/32 MCP shim tests (5 files)**. `npm audit` reports **0 vulnerabilities** in the plugin (production and dev) and in `mcp/`. No critical or high finding in shipped code.

> Snapshot only. Decision history lives in `DECISIONS.md`; architecture in `ARCHITECTURE.md`.

## At a Glance

- **26 modules** under `src/` plus `main.ts` (329 lines, lifecycle glue only) and `settings.ts`. `modules/registry.ts` constructs, loads, and unloads every feature.
- **Fire Synapse pipeline** runs elaboration → summarize → enrichment → REM → illustrate → tidy → organize; the **intake folder** auto-feeds it. All proposals land in one **unified proposal sidebar**.
- **Agents can now drive Synapse** (epic #629, unreleased): a versioned API at `app.plugins.plugins.synapse.api` and a separate `synapse-mcp` server in `mcp/`. Neither opens a port.
- **Settings schema is at v8** (`CURRENT_SETTINGS_VERSION`, `shared/settings-migrations.ts:25`).

## Merged Since 1.6.0 (unreleased, planned for 1.7.0)

| Change | What it gives |
|--------|---------------|
| Public API (#623) | Modal-free verbs for an agent or script: elaborate, folder scans, deep dive, proposal list / accept / reject, `status()`, `capabilities()` |
| Jobs (#624) | Long verbs return a job id at once; `jobs.wait` / `get` / `cancel` follow it |
| Stop reasons + Continue (#625) | Proposals record why the model stopped and the tokens used; a deep dive that hit its note cap keeps its queue and can **Continue** |
| Agent-written text (#626) | Per-feature **Agents generate the text** setting: the agent answers model calls through `jobs.commit`, with the same checks and write path |
| Activity log (#627) | `.synapse/activity.jsonl`, redacted, readable through `events.since` |
| MCP server (#628) | `synapse-mcp`: one MCP tool per verb, over the Obsidian CLI |
| Rename following (#632) | Deep-dive records follow accepted notes, sources, roots and syllabi when they are renamed or moved |
| Accept results (#633) | Every module's accept reports applied / partial / skipped / conflict / failed and the paths it wrote |
| Test mock fix (#635) | The Obsidian test mock no longer leaks heap through `vi.fn` spies |

## Current Focus

- **Pre-release audit for 1.7.0 (2026-11-20, branch `audit-629`)** of the agent control surface:
  - **Committed**: agent-run elaboration and deep dive honor exclusion rules; job-operation lines are redacted; `maxNotes` is capped at 100 through the API.
  - **Three Low findings fixed (uncommitted)**: the MCP shim redacts its own error messages; unloading the plugin fails pending external requests and clears their timers; success messages and partial-accept reasons are redacted, and the MCP tool hints now mark `proposals_reject` destructive and generating tools open-world.
- **Open follow-ups**: organize moves leave folder-qualified links dangling (#613); AI streaming (#614), OpenAI Responses API (#615), structured output (#616), Ollama capability discovery (#617), Gemini continuation (#618); video description and uploader in notes (#631); auto-enrich once per chain (#536); self-hosted mobile extraction tier (#181, #182); UX review (#465); toast cancel progress (#269).

## Module Status (21 modules; five thin folders omitted)

| Module | Role | Status |
|--------|------|--------|
| api | Public API for agents: verbs, jobs, external billing, events (#623–#628) | Working (unstable until released) |
| modules | Feature-module registry: construct / gated load / reverse unload (#504) | Working |
| checkpoints | Startup interrupted-operation prompt, `manage-checkpoints`, sidebar resume/discard | Working |
| elaboration | Stub detection → full-body rewrite proposal (image-aware, backlink context) | Working |
| audio | Transcription (Whisper / Deepgram / Gemini); sectioned post-processing | Working (local-whisper not impl.) |
| video | yt-dlp/ffmpeg download + transcription; `captionsFirst` | Working (desktop only; frames not impl.) |
| image | OCR via vision models, auto-downscale, batch | Working (resume asks for a re-run) |
| transcription | Unified modals, time-range clipping, URL tier router over the transcript cache | Working (clipping desktop only) |
| enrichment | Tags, links, refs, frontmatter; System 1 seats | Working |
| summarize | URL / transcript / audio / note-prose summaries; media URLs transcribe-only | Working |
| tidy | Spelling and formatting fixes (+ undo) | Working |
| organize | Folder proposals, run-level undo; `suggestDirectory` for deep-dive | Working (#613 open) |
| deep-dive | Recursive child notes; auto-REM; resumable; continue capped runs; follows renames | Working |
| title | Untitled/mismatch rename; collisions; backlink remediation | Working |
| rem | In-place `[[wikilink]]` discovery | Working |
| illustrate | Licensed photos, optional Mermaid diagrams / charts | Working (opt-in, off) |
| intake | Watch folder, media-URL transcription, shared-capture adoption | Working |
| pipeline | Fire Synapse runner + post-op hooks | Working |
| commands | Command registry, registrar, drift audit | Working |
| shared | AI client + per-feature config, System 1 client, queue, caches, activity log, accept results, migrations (v8) | Working (base layer) |
| views | Unified proposal sidebar (7 kinds + In progress) + actions sidebar | Working |

## Security Posture

- **No critical or high vulnerabilities in shipped code**; API keys live in gitignored `data.json`.
- **The agent path opens no port.** An agent reaches Synapse only through Obsidian's CLI `eval`; the MCP shim sends arguments as JSON, never as code.
- **Agents get the same guards as a click**: argument schemas, feature gates, exclusion rules, the note queue, and redacted output.
- **External billing sends note text to the agent** instead of the provider, by design and only when chosen (`agentBilling`, off by default).
- **Every AI request is injection-hardened** (#620). **Gap**: the System 1 lane (off by default) sends text unfenced.
- **Accepted risk**: links the user wrote may point at any host, local ones included. **Not yet wired**: `ensureWithinVault` on general write paths.

## Known Gaps & Blockers

| Item | Severity | Notes |
|------|----------|-------|
| Agent control surface not yet released | Medium | API shape may still change; `API_VERSION` counts from the first release |
| Organize moves break folder-qualified links | Medium | `vault.rename` does not update links (#613) |
| Non-YouTube URLs on mobile | Medium | Need yt-dlp; waits for the self-hosted tier (#181, ADR 001) |
| Not implemented: local Whisper, local video files, frame extraction | Medium | `video.frameExtraction` settings exist, unread |
| No-speech edge cases (#524) | Low | Heuristic beyond `whisper-1` |
| `rem.titleMatchWeight` has no UI | Low | Edit `data.json` to change |

## External Dependencies (no npm runtime dependencies in the plugin)

| Dependency | Required for | Status |
|------------|--------------|--------|
| youtube.com (HTTPS) | YouTube caption tier | Every platform, no install |
| yt-dlp, ffmpeg / ffprobe | Video download, extraction, clipping | User-installed; desktop only |
| OpenAI / Anthropic / Gemini / Deepgram keys | Chat, vision, transcription — one key per vendor | User-configured |
| Ollama | Local chat models | HTTPS, or HTTP on localhost |
| Wikimedia Commons / Openverse | Illustrate photo search, keyless | Opt-in |
| TypeSafe (`api.typesafe.ai`) | System 1 decision lane | Opt-in, off by default |
| Obsidian 1.12+ CLI, Node 20+, `@modelcontextprotocol/sdk` | `synapse-mcp` only | Separate package; not in `main.js` |
