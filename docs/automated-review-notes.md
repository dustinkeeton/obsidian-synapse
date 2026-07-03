# Automated plugin-review notes

Reviewer-facing companion to [`audit-community-guidelines.md`](./audit-community-guidelines.md).
That file maps Synapse to Obsidian's *written* guidelines; this file triages the
**automated** lint/behavior review that runs on every GitHub release, and collects
the justifications a community-directory reviewer (#389) most commonly asks for.

Every finding falls into one of four buckets: **fix**, **document-as-intended**,
**rebut (false positive)**, or **artifact of untyped analysis**. In-code comments
are the source of truth for the design decisions below — this file links to them
rather than restating them.

---

## 1. Declared desktop-only Node usage

Synapse ships `isDesktopOnly: false` (`manifest.json`) so the bundle must load on
Obsidian mobile, yet the transcription pipeline needs privileged desktop access to
drive `yt-dlp` / `ffmpeg` / `ffprobe`. Every Node builtin is reached through one
sanctioned layer — `src/shared/node-loader.ts` — never a top-level import:

- **Lazy, function-body-only builtin access.** `loadNodeModules()`
  (`src/shared/node-loader.ts:65`) resolves `os` / `path` / `fs` /
  `child_process` inside the function body, behind `assertDesktop()`
  (`src/shared/node-loader.ts:45`, `Platform.isDesktop`). A top-level import would
  evaluate at module load and crash on mobile before any guard could run. The
  `scripts/check-top-level-requires.mjs` CI gate enforces that no such top-level
  access re-enters, and esbuild marks the builtins `external`.

- **Temp-file filesystem I/O, cleaned up in `finally`.** All scratch media
  (downloaded video, extracted/clipped/combined audio, probe inputs) is written
  under `os.tmpdir()` only — never inside the vault — and removed on both success
  and failure. See the temp paths at `src/video/audio-extractor.ts:174` and the
  cleanup at `src/audio/index.ts:464` (`finally { … fs.promises.unlink … }`) and
  `src/transcription/duration-detector.ts:107`. All *vault* file access elsewhere
  goes through the Obsidian Vault API.

- **Subprocess execution is `execFile`-only.** Tools are spawned with `execFile`
  and an explicit **argument array** (`src/video/audio-extractor.ts:436`,
  `src/transcription/duration-detector.ts:94` and `:145`) — never a shell command
  string, and never `shell: true`. There is no shell interpolation of URLs, paths,
  or titles. URLs and paths are sanitized first via `sanitizeUrl`
  (`src/shared/validation.ts:10`) / `sanitizePath` (`src/shared/validation.ts:50`),
  and the binaries that run are exactly the `yt-dlp path` / `ffmpeg path` set in
  settings.

- **Narrowed subprocess environment.** `shellEnv()`
  (`src/shared/node-loader.ts:96`) builds an **allowlist** — an augmented `PATH`,
  plus `HOME`, `TMPDIR`, and proxy vars only when present — and deliberately does
  **not** spread `process.env` into the child. Subprocesses inherit only what they
  need to locate and run the tools (and to work behind a corporate proxy).

- **Clipboard is write-only.** Synapse never *reads* the clipboard. The only
  clipboard calls are `navigator.clipboard.writeText`: copying a redacted error
  string on error-toast dismiss (`src/shared/notifications.ts:505`) and copying an
  install command from the video settings (`src/video/settings-section.ts:70`).

- **No system-identity reads.** No `os.hostname()`, `os.userInfo()`, or
  `os.networkInterfaces()` anywhere in `src`; the only `os.*` call is
  `os.tmpdir()`. (See the rebuttal in §3.)

The user-facing summary of this access lives in the README "Privacy and network
use" section; this list is the reviewer-facing counterpart.

---

## 2. Documented-as-intended (wontfix)

- **`require()` of `os` / `path` / `fs` / `child_process`
  (`src/shared/node-loader.ts:72`–`75`).** This *is* the mobile-safety design, not
  an oversight: lazy, function-body-only, `assertDesktop()`-gated, and CI-enforced
  by `scripts/check-top-level-requires.mjs`. Converting to top-level ESM imports
  would crash the mobile bundle. Rationale in full at the file header
  (`src/shared/node-loader.ts:1`–`17`) and the inline disable justification at
  `:67`.

- **`:has()` CSS selectors (`styles.css:502`–`519`, `:588`–`592`).** Obsidian
  places the plugin's `synapse-notice*` classes on the **inner** `.notice-message`
  element, not the outer `.notice` (mechanism from #361). Each toast rule therefore
  needs a `.notice:has(.synapse-notice…)` branch to style the real `.notice`
  container at (0,2,0) specificity — beating core padding/background without
  `!important`. The selectors scope to a handful of `.notice` elements, not a broad
  document match, so the invalidation cost is negligible. Removing them regresses
  toast styling. Rationale in full at `styles.css:490`–`501`.

---

## 3. Rebuttals (false positives)

- **"Reads system identity information (hostname, user info, environment
  variables)."** Verifiable by grep: `src` contains no `os.hostname()`,
  `os.userInfo()`, or `os.networkInterfaces()` call. The sole `os.*` usage is
  `os.tmpdir()` (temp scratch paths). Every `hostname` occurrence in `src` is
  `URL.hostname` — localhost/loopback checks for AI endpoints (e.g.
  `src/shared/ai-client.ts:552`, `src/shared/provider-metadata.ts:65`) and platform
  host matching, not machine identity. Environment access is the narrowed
  `shellEnv()` allowlist (§1), never a bulk `process.env` read for fingerprinting.

- **`globalThis` warnings.** All `globalThis` usage in `src` is confined to
  `src/__test-utils__/setup.ts` (vitest scaffolding that mirrors Obsidian's
  window-scoped globals for the Node test environment) and to `*.test.ts` files.
  None of it is shipped: the esbuild entry point is `src/main.ts`
  (`esbuild.config.mjs`), which never imports test infrastructure, and the repo's
  own `obsidianmd/*` lint scope explicitly ignores `**/*.test.ts` and
  `src/__test-utils__/**` (`eslint.config.mjs`). Shipped code uses `window` /
  `activeWindow` throughout.

---

## 4. `no-unsafe-*` cascade — artifact of untyped analysis

The bulk of the source-code review (all `@typescript-eslint/no-unsafe-assignment`
/ `-call` / `-member-access` / `-argument` / `-return`, the "unnecessary
assertion" hits in `node-loader.ts`, and "`error` type acts as `any`") does **not**
reproduce under type-aware analysis. `npm run lint` — the repo's own type-aware
config (`eslint.config.mjs`, `projectService` + `tsconfigRootDir`) with the entire
`no-unsafe-*` family already at `error` (#296/#321) — exits **0** on `main`.

The findings appear only when the review harness analyzes without the repo's type
information: Node builtin handles from `require()` then resolve to TypeScript's
intrinsic `error` type and cascade `any`-unsafety through every downstream consumer
of `node-loader` / ffmpeg / yt-dlp output. Under type-aware analysis those same
expressions are fully typed (e.g. the `as typeof import('os')` handles in
`node-loader.ts`, `asYtDlpDumpJson()` in `src/video/audio-extractor.ts`, and the
`isRecord` / `parseJson` guards in `src/shared/json-utils.ts`).

A reproduction of the harness (the full `eslint-plugin-obsidianmd` recommended
preset, including its bundled `typescript-eslint` type-checked layer, run once with
and once without the repo's type info) and the per-rule enumeration is recorded in
the issue-comment triage on #454. Bottom line: after excluding untyped-analysis
artifacts (all `no-unsafe-*`), test-only findings (`globalThis`), and the one
genuine fix (`querySelectorAll` → Obsidian's typed `findAll`, `src/summarize/index.ts`),
the only review findings that survive a correctly-scoped, type-aware pass of
shipped code are the intentional builtin `require()`s at `src/shared/node-loader.ts:72`–`75`
documented in §2.
