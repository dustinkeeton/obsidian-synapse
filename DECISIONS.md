# Decision Log

Decisions listed in reverse chronological order.

---

## 2026-07-02: Brand refresh — Iris + Gold; glyphs may carry ONE gold gesture via a theme var

**Context**: The brand kit in `assets/brand/` was replaced (2026 Iris + Gold refresh): body color moves from violet `#8b5cf6` to Iris `#5A3EF0`, volt lime `#CCFF00` is retired, and the "impulse" — the one thing Synapse adds — is now always Gold `#FFD23F`. The in-app glyphs previously had a hard rule: pure `currentColor`, never a baked color (`brand-icons.test.ts` failed on any `#`). The new glyph grammar puts the single gold gesture *inside* the glyphs, which that rule forbade.

**Decision**: Glyph bodies stay `currentColor` (host UI supplies the ink), but each glyph may carry **one** gold gesture expressed only as `style="…var(--synapse-gold, #FFD23F)"`. The var is themed in `styles.css` (`body { --synapse-gold: #FFD23F }`, deepened to `#E8B419` on `.theme-light` for contrast on white). The test now strips the exact token `var(--synapse-gold, #FFD23F)` before asserting no `#` remains, so the canonical fallback is the *only* hex a glyph can bake. `synapse-main` stays impulse-free (neutral fallback); `synapse-actions` becomes the S-Signal at glyph weight (the brain mark is retired; the neuron remains the proposals mark).

**Alternatives considered**:
- **Keep glyphs pure `currentColor`** — rejected; the refresh's whole grammar is "gold = what Synapse adds", and a mono glyph set can't say that.
- **Bake `#FFD23F` directly** — rejected; light themes need the deepened `#E8B419`, and a literal hex can't retheme.

**Rationale**: The CSS var keeps one retunable source of truth per surface while the fallback keeps the assets self-contained (they render correctly outside Obsidian, e.g. on GitHub).

**Impact**: `assets/brand/*` (all marks + glyphs), `src/brand-icons.ts` (regenerated bodies), `brand-icons.test.ts` (color rule), `styles.css` (gold tokens), README hero (animated banner) + sponsor badges (Iris/Gold). No behavior change beyond visuals.

---

## 2026-06-29: Raw caught errors get the same redaction as strings (`redactError`)

**Context**: `redactSecrets()` — the single redaction source (`shared/redact.ts`) — only operates on **strings**. Several console sinks log a caught value directly (`console.warn('…failed', err)` / `console.error('…', err)`), handing the bare `Error` object — and its `.stack`, which embeds `.message` — to the console. A secret echoed into an error message by an upstream API or a thrown exception would reach the console **verbatim**, bypassing redaction. This audit found five such raw-error sinks across audio, rem, elaboration, and shared.

**Decision**: Add `redactError(value: unknown): string` to `shared/redact.ts` (exported via the `shared` barrel) as the **one sanctioned way** to render a caught value for a log sink. It prefers the error's `stack` (already includes message + call frames), falls back to `name: message`, stringifies non-Errors, then runs the result through `redactSecrets`. Route every raw-error console sink through it: `audio/index.ts`, `rem/semantic-matcher.ts`, `elaboration/image-analyzer.ts`, `elaboration/proposer.ts`, and both sinks in `shared/fire-and-forget.ts`.

**Alternatives considered**:
- **Stringify inline at each call site (`String(err)`), then `redactSecrets`** — rejected; that re-scatters the discipline `redact.ts` exists to centralize, and a missed `.stack` at one site silently re-opens the hole.
- **Make `redactSecrets` accept `unknown`** — rejected; it has one job (scrub a string) and many callers already pass known strings. A separate, clearly-named helper keeps each function's responsibility sharp.

**Rationale**: `redact.ts` is the single source of truth only if *every* path that can surface a secret goes through it. Error objects were the one class of value that slipped past — `redactError` closes that gap without spreading redaction logic into feature modules.

**Impact**: `shared/redact.ts` (+ `redact.test.ts`), `shared/index.ts` (barrel export), and the five sinks above. Defense-in-depth only — no success-path behavior change; redacted console output is the sole observable difference, and only when an error actually carries a key.

---

## 2026-06-28: Release/publish is already automatic; adopt the official Obsidian lint gate (#389)

**Context**: #389 asked how to "automate publishing" to the community store, and its body proposed building release/submission automation. Reassessed: Synapse is already in the store, and — confirmed against Obsidian's 2026 "future of plugins" announcement — once a plugin is listed, **every new GitHub release is auto-reviewed and delivered to users within ~24h**, with no per-release submission, no dashboard button, and no `obsidianmd/obsidian-releases` PR. Our pipeline (`version-bump.mjs` → `tag-on-version-bump.yml` → `release.yml`) already does everything after a version-bump commit; the only manual step is the bump itself.

**Decision**:
- **Don't build release-publishing automation** (or an `obsidian-releases` PR bot) — it's already automatic. Document the real flow in `docs/RELEASING.md` and fix the stale "not yet published" README copy instead.
- **Adopt `eslint-plugin-obsidianmd` as a blocking CI gate** (`eslint.config.mjs`) — the local mirror of the store's automated review, so a release is never silently pulled for a guideline violation. We lift **only** the `obsidianmd/*` rules from its `recommended` preset (33 rules), *not* the preset wholesale: it bundles `typescript-eslint/recommended-type-checked` + import/sdl/depend (100+ rules), which would balloon the green-gate — the same explicit-list reasoning behind the #296/#297 config. The two layers are orthogonal (`obsidianmd/*` vs `@typescript-eslint/*`) and coexist. Scoped to shipped `src` only (test infra isn't bundled/reviewed, per the #321 exemption).

**Alternatives considered**:
- **Adopt `obsidianmd.configs.recommended` as-is** — rejected; drags in a strict type-checked TS preset (hundreds of out-of-scope violations).
- **`obsidianmd/ui/sentence-case` unconfigured** — rejected; it lowercases the brand name ("synapse"), acronyms, and product names. Kept on, with `brands`/`acronyms`/`ignoreRegex` allow-lists, after fixing the genuine Title-Case it found.
- **Lint `manifest.json` (`validate-manifest`)** — left out: the rule only fires on a file named `manifest.json` and needs an ESTree `ObjectExpression` no standard parser yields from bare JSON (the official preset doesn't wire it either). Our manifest is already valid and is checked by Obsidian's own review; not worth a custom-parser hack.

---

## 2026-06-28: Subscription plans can't replace API billing (documented; wontfix)

**Context**: A recurring user request (#364) is to power Synapse with an existing Claude Pro/Max (or ChatGPT Plus / Gemini Advanced) **subscription** instead of metered, per-token **API** billing — the cost ask is one flat monthly fee, not a second usage-based bill.

**Decision**: Document it as a canonical wontfix — it is blocked by provider policy, not by Synapse's architecture. A subscription authorizes the provider's own chat app, not third-party API access: Anthropic's Consumer Terms prohibit third-party use of subscription tokens (enforced with suspensions) and the Messages API rejects the `sk-ant-oat…` setup token; OpenAI "Sign in with ChatGPT" is identity-only; Google Gemini Advanced has no API, only AI Studio / Vertex (facts re-verified 2026-06). The supported, compliant cost answers are a pay-as-you-go provider API key and Ollama (local, free). The README **FAQ** is the canonical user-facing answer; this entry is its decision-log counterpart and the billing-model twin of the 2026-06-16 "Guided key onboarding + live validation (OAuth deferred)" entry (#335) — same provider-policy facts, viewed from cost rather than auth UX.

---

## 2026-06-28: Title-proposal filename collisions → `iterate` | `merge`, surfaced as a distinct UI state (#408, #414)

**Context**: When the title module proposes renaming a note to a title that **already exists** as a file, a blind rename would either fail or clobber. Auto-accept made this worse — it could silently resolve a collision the user never saw.

**Decision**:
- Pre-check the target path before accepting a title proposal. On a collision, resolve by a configurable **`title.duplicateHandling`** strategy (`TitleDuplicateStrategy = 'iterate' | 'merge'`, default `'iterate'`):
  - **`iterate`** — append a numeric suffix to find a free path (`findAvailableVaultPath`).
  - **`merge`** — merge the note into the existing target when it's a real `TFile`; if there's nothing to merge into, fall back to a suffixed rename.
- Surface the collision as a **distinct proposal UI state** (#414) rather than a generic error, so a user reviewing manually sees the conflict and chooses, while auto-accept applies the configured default.
- `onTitleAccept(id, resolution?)` forwards the user's per-proposal choice into `title.acceptProposal`; the accept outcome reports `{ status: 'renamed' | 'merged', … }`.

**Alternatives considered**:
- **Always suffix (never merge)** — rejected; users consolidating duplicate notes want a real merge, not `Note 2.md`.
- **Fail the proposal on any collision** — rejected; collisions are common and expected (two stubs about the same topic), so a dead-end error is poor UX.

**Rationale**: A rename that can overwrite or fail needs an explicit, user-visible policy. Making it a setting with a safe `iterate` default keeps auto-accept non-destructive while letting power users opt into merging.

**Impact**: `title/` (types `TitleDuplicateStrategy`/`TitleAcceptOutcome`, collision pre-check, `settings-section.ts` dropdown, `content-key.ts`), `views/` (distinct collision state), `main.ts` (resolution forwarding). New `title.duplicateHandling` setting.

---

## 2026-06-28: Version-stamped settings-migration framework (#93)

**Context**: Settings evolved through ad-hoc, presence-guarded one-offs — e.g. the #307 `excludeFolders → exclusions` fold ran "only if the `exclusions` key is absent." That works for a single migration but doesn't compose: nothing recorded *which* schema version a stored `data.json` was at, so each new migration had to invent its own idempotency guard. The 2026-06-14 #307 entry explicitly **deferred** a real versioning system to #93.

**Decision**: Add a small, pure, version-stamped migration runner in `shared/settings-migrations.ts`:
- A persisted **`settingsVersion`** field; `readSettingsVersion(raw)` treats absent/non-numeric as version `0` (the pre-versioning baseline, so a legacy file replays everything).
- An ordered `SETTINGS_MIGRATIONS` chain of `{ to, migrate }` steps; `migrateSettings(raw, from)` clones the raw object once (JSON round-trip, so a throwing step can't half-mutate the caller's fallback) and replays **every migration whose `to > from`** in ascending order, *before* the deep-merge over `DEFAULT_SETTINGS`. On upgrade, `main.loadSettings()` stamps `settingsVersion = CURRENT_SETTINGS_VERSION` and saves once.
- Seeded with two steps: **v1** folds legacy `excludeFolders` into `exclusions` (wrapping the existing `buildMigratedExclusions`, keeping the presence guard so a deliberately-cleared `[]` stays `[]`); **v2** deletes the inert `rem.semanticMatching` flag left by the always-on REM change (#380).
- A drift-guard test asserts `CURRENT_SETTINGS_VERSION` always equals the highest migration `to`.

**Layering**: `settings-migrations.ts` lives in `shared/` and imports `exclusions` directly (same layer); it must **never** import `../settings`. `settings.ts` takes one runtime value (`CURRENT_SETTINGS_VERSION`) from it — the single sanctioned `settings → shared` edge — and the graph stays acyclic.

**Alternatives considered**:
- **Keep presence-guarded one-offs** — rejected; doesn't compose, can't express "drop a key," and re-derives idempotency every time.
- **A migration library** — rejected; the plugin has no runtime dependencies and the need is a dozen lines of pure transforms.
- **Map `semanticMatching` onto `titleMatchWeight`** — rejected; the old boolean has no faithful weight target now that REM is always-on, so deleting it is the honest migration.

**Rationale**: A version stamp + ordered replay turns settings evolution into an append-only list of pure, individually tested functions with one provable "current version" — far safer than scattered guards as the schema grows.

**Impact**: New `shared/settings-migrations.ts` (+ tests), `settings.settingsVersion` field, `main.loadSettings()` rewired to the runner. Supersedes the "settings-version system deferred (#93)" note in the 2026-06-14 #307 entry.

---

## 2026-06-27: Idempotency bundle shipped — proposal dedup, notice throttle, AI cache, prompt-injection fence (#395–#398)

**Context**: The 2026-06-26 idempotency spike (#390, below) mapped the design and filed #395–#398. This entry records the **implementation** landing per that plan; the spike holds the full design rationale, so only implementation-specific choices are captured here.

**Decision** — one shared primitive, four enforcement points:
- **Shared hashing/keying primitive** (`shared/hash-utils.ts`): dependency-free `hashString` + `contentKey(parts[])`, keyed on **inputs only** (never model output), so an unchanged note re-keys identically even at temperature > 0.
- **#395 Proposal dedup + revive `maxProposalsPerNote`.** Stores skip re-proposing for an unchanged content key (`proposalContentKey` in elaboration, `titleContentKey` in title; the store records each proposal's `contentKey`), killing the "scan twice → duplicate proposal" bug. The long-dead `maxProposalsPerNote` setting is now enforced as a per-note pending cap.
- **#396 Notice equal-message throttle.** A `level:message` dedup window suppresses identical **fire-and-forget one-shot** toasts (e.g. the same per-image message each loop iteration), and ad-hoc `new Notice` sites are centralized. **Tracked-operation** error toasts and contextual `notifyError()` stay **unthrottled** — they carry per-run context worth repeating.
- **#397 AI response cache + in-flight coalescing.** `AIClient` coalesces concurrent identical requests through an in-flight `Map` (entry cleared in `.finally()`, mirroring intake's discipline) and keeps a **per-instance, bounded LRU** response cache. The cache participates when **`temperature === 0`** (deterministic) **or** the user opts in via **`ai.cacheResponses`**; it is populated **only on success**; a `bypassCache` option forces a fresh dispatch for "regenerate."
- **#398 Structural prompt-injection fence.** `shared/untrusted-content.ts` `wrapUntrusted(content, source)` fences fetched external text (article/tweet/Reddit bodies, image analysis) in labeled delimiters with a data-not-instructions frame and anti-breakout sentinel scrubbing; used by `elaboration/proposer`.

**Alternatives considered** (implementation-level; design-level alternatives are in the spike):
- **Lexical injection stripping** (regex out "ignore previous instructions") for #398 — rejected; brittle, false-positives on legitimate articles (e.g. one *about* prompt injection), and breeds false confidence. The defense is **structural** (delimiter + label + fence-scrub), paired with a system-prompt clause.
- **Cache AI responses unconditionally** — rejected; at temperature > 0 that freezes a single sample. Gated on temp 0 or explicit opt-in, never caching errors.
- **Process-wide static AI cache** — deferred; per-instance scope matches the long-lived `AIClient` a generator owns and avoids cross-session staleness.

**Rationale**: Keying on **inputs** makes idempotency hold despite a non-deterministic model; each layer enforces at the point where duplication is expensive (generate+save, render, network) without doubling up.

**Impact**: New `shared/hash-utils.ts` and `shared/untrusted-content.ts`; `ai-client.ts` (cache/coalesce + new `ai.cacheResponses` setting, default `false`), `notifications.ts` (throttle), elaboration/title stores (content-key dedup), `elaboration/proposer` (`wrapUntrusted`). Re-running a command on unchanged inputs now produces no new proposal and no new equal one-shot notice.

---

## 2026-06-26: Centralized "Review" completion-toast gate (`reviewAction`, #366)

**Context**: The 2026-06-19 #340 work added a "Review" button to proposal-generation toasts, but each proposal-producing module re-derived *when* to show it in its own way (setting-based, per-proposal `!autoAccepted`, `proposalCount - autoAcceptedCount > 0`) — four divergent rules. Worse, an **automatic post-op** run (a chained `enrich()`/`checkTitle()` after the primary action) surfaced its own "Review" toast every time, nagging the user about a secondary action they never invoked.

**Decision**: Add one shared gate, `shared/review-action.ts` `reviewAction(opts)`, that every flow calls. It returns a Review `NoticeAction` **iff** (1) something was generated, (2) auto-accept is OFF for that action's own kind (read through a live getter, not a captured boolean), and (3) the run is **not** a post-op side effect (`!postOp`). Post-op chained calls pass `{ postOp: true }`, so auto-accepting a primary action never raises an unrelated secondary Review prompt.

**Alternatives considered**:
- **Leave each module's bespoke rule** — rejected; four implementations of one policy drift, and the post-op nag bug lived in the gaps between them.
- **Suppress post-op toasts entirely** — rejected; the toast still usefully reports completion; only the *Review affordance* should be gated off.

**Rationale**: A single predicate keeps the six proposal flows consistent and fixes the post-op double-prompt at the source instead of patching each call site.

**Impact**: New `shared/review-action.ts` (+ tests), consumed by all proposal-producing modules; post-op callers (`enrich`/`checkTitle`) pass `{ postOp: true }`. Generalizes the deep-dive `totalProposals > 0 && !shouldAutoAccept()` pattern.

---

## 2026-06-26: Idempotency foundation — scoping spike (#390)

**Context**: Synapse has no shared notion of *idempotency* — same input → same outcome, repeating an operation doesn't multiply its effects. This spike investigated three layers and confirmed the current state against the live code (all citations verified in-tree):

- **Proposals (no idempotency).** IDs are random, never content-addressed: every store builds ids from the shared `generateId()` (timestamp + `Math.random()`, `src/shared/id-utils.ts:8`), and elaboration's proposer carries its *own* `Math.random()`-based UUID generator (`src/elaboration/proposer.ts:89` → `:284`). `ElaborationModule.scanVault()` (`src/elaboration/index.ts:201`) has **no "already proposed?" guard** — Phase 3 calls `proposer.generate()` then `store.save()` unconditionally for every detected note (`:272`–`287`). `ProposalStore.save()` names files `<base>-<id.slice(0,8)>.json` (`src/elaboration/proposal-store.ts:99`), so a random id per run means a *second* file per re-scan. **Repro:** run "Scan vault" twice on one unchanged stub note → two pending proposals, two files, two random ids. `maxProposalsPerNote` is **dead code** — declared (`src/settings.ts:57`), defaulted to 3 (`:362`), referenced by **zero** module code (grep-confirmed; already flagged in `src/elaboration/AGENTS.md:204`). The same random-id + unconditional-save shape repeats across enrichment, organize, deep-dive, summarize, rem, title, tidy, image, audio, video stores.
- **Notices (no idempotency).** `NotificationManager.info()/success()/error()/confirm()` each build a fresh `new Notice` per call (`src/shared/notifications.ts:344`,`:368`,`:436`,`:292`) — no equal-message dedup, no throttle. There are 24 `new Notice` sites total; ~16 are **ad-hoc** outside the manager (`src/main.ts`, `src/transcription/unified-modal.ts`, `src/views/unified-proposal-view.ts`, `src/image/extractor.ts`, `src/elaboration/image-analyzer.ts`, `src/shared/fire-and-forget.ts`, …), so they bypass any future manager-level throttle.
- **AI requests (no idempotency).** `AIClient.complete()` → `chat()` (`src/shared/ai-client.ts:275`–`299`) dispatches a provider request on every call — no `(messages, provider, model, temperature, maxTokens)` → response cache and no in-flight coalescing. No content hashing exists anywhere in `src/` today (grep-confirmed).
- **Reusable primitives already in-tree.** intake's in-flight `Set<string>` + per-path debounce (`src/intake/index.ts:69`,`:189`) is the model for request coalescing; `CheckpointManager.withLock()` per-id mutex over atomic `adapter.write` (`src/shared/checkpoint-manager.ts:279`) is the model for safe read-modify-write of a content-keyed store.

**Decision** (recommendation; no production code shipped in this spike — only `DECISIONS.md` + follow-up issues #395–#398):

- **Idempotency key, per layer.**
  - *Proposal:* deterministic hash of `normalize(notePath) + contentHash(originalContent) + serialize(detectionReasons) + the AI/detection settings that change output` (provider, model, temperature, maxTokens, relevant detection thresholds). Key on **inputs only** — never the model's output.
  - *Notice:* `level + message` within a short window.
  - *AI request:* hash of the fully-resolved request (messages + provider + model + temperature + maxTokens).
- **Deterministic hashing.** Add one dependency-free hash primitive to `src/shared/` (e.g. `src/shared/hash-utils.ts`, a stable FNV-1a/`djb2`-style string hash, exported via `src/shared/index.ts`). No `Math.random()`, no `Date.now()` in the key. This is also the seam to *replace* the per-store random ids with content-addressed ids over time.
- **Shared dedup primitive.** A small `src/shared/` helper (working name `idempotency`/`content-key`) exposing: (a) `contentKey(parts: string[]): string` over the hash primitive; (b) an in-flight coalescer (`Map<string, Promise<T>>`, generalizing intake's `Set<string>`) so concurrent identical work shares one Promise; (c) a "seen key" lookup contract that stores implement against their existing persistence, guarded by the checkpoint-manager `withLock` mutex pattern for atomic read-modify-write. Stores keep owning their files; the primitive owns the key + coalescing + lock discipline.
- **Enforcement altitude, per layer.** Dedup the **generate+save** path for proposals (that is the expensive, duplicating one); rendering stays a pure read of the deduped store. Notices dedup at **render** (the manager). AI requests coalesce at **call** time and optionally cache the response. "Both" is unnecessary anywhere.
- **LLM non-determinism at temperature > 0.** Because every key is over **inputs**, an unchanged note never re-generates regardless of sampling. A response cache is the one place output is frozen — so **gate AI response caching on `temperature === 0`** (or an explicit opt-in) and never cache error responses.
- **Coverage.** All seven pipeline phases share the random-id + unconditional-save pattern, and the `fire`/`fireOnFile` runner (`src/pipeline/synapse-runner.ts:14`,`:70`) simply calls each module's scan with `onlyFile` — it adds **no** dedup of its own, so fixing the per-module stores (starting with elaboration) is what makes Fire Synapse idempotent too.

**Phased plan** (cheapest win first):

1. **Proposal dedup by content key + revive `maxProposalsPerNote`** (#395) — highest value, lowest risk; de-risks the whole effort and kills the scan-twice duplicate.
2. **Notice throttle/dedup + centralize the ad-hoc `new Notice` sites** (#396) — small, user-visible, unblocks the #366 Review-button work.
3. **AI-request coalescing + opt-in response cache** (#397) — deeper; saves spend on any path that does call the model.
4. **Prompt-injection gating for fetched external content** (#398) — hardening; injected instructions are also an idempotency/stability vector.

**Alternatives considered**:
- **Content-address every store at once (big-bang).** Rejected — sequence behind a shared primitive and migrate stores incrementally (elaboration first) so each lands with tests and no cross-module churn.
- **Throttle notices only inside `NotificationManager`.** Insufficient alone — ~16 ad-hoc `new Notice` sites bypass it; the fix must also route them through a centralized helper.
- **Cache AI responses unconditionally.** Rejected — at temperature > 0 that freezes a single sample and changes behavior; gate on `temperature === 0`/opt-in.
- **Persist a separate idempotency ledger.** Rejected for now — proposals are already files on disk; look up by content key in the existing store under the `withLock` mutex rather than add a parallel index to keep in sync.

**Rationale**: The cheapest, highest-leverage win is proposal dedup — it removes the visible "scan twice → duplicate proposals" bug, finally enforces a long-dead setting, and forces the shared hash + content-key primitive that the notice and AI layers reuse. Keying on inputs (not outputs) is what makes idempotency hold even with a non-deterministic model.

**Impact**: No code changed by this spike (constraint: only `DECISIONS.md`). Follow-ups filed: **#395** (proposal dedup + `maxProposalsPerNote`), **#396** (notice throttle/dedup + centralized helper), **#397** (AI coalescing/cache), **#398** (prompt-injection gating) — all labeled `enhancement`, milestone *v1.1.0 — Post Release*. Acceptance for the bundle: re-running a command on unchanged inputs produces **no new proposal and no new equal notice**. Cross-agent note: the centralized notification helper (#396) and the proposal content-key (#395) are the two pieces the Review-button gating work (#366) should build on.

---

## 2026-06-25: Audit pass (1.0.6) — redaction now guards the operation-error console sink; command-name normalization

**Context**: A periodic codebase audit reviewed the plugin at version 1.0.6. The module graph is still acyclic and the code security-mature, but two small gaps surfaced. (1) `NotificationManager` routed three error sinks through `redactSecrets` — the `error()` toast, `notifyError`, and `showErrorNotice` — but the per-*operation* failure path still did a raw `console.error(message)`. That was the one remaining spot where an API key echoed into an operation error could reach the console unredacted. (2) One command name broke the all-lowercase palette convention ("REM: **D**iscover links in current note").

**Decision**: Route the operation-error `console.error` through `redactSecrets` too, so *every* error sink in `notifications.ts` shares the single redaction source. Normalize the command to "REM: discover links in current note". Refresh all 18 machine-readable `AGENTS.md` files and these human docs against the live code.

**Alternatives considered**:
- **Leave the console log raw ("it's just a log")** — rejected; logs get copied into bug reports, so a redacted toast beside a raw console line defeats the purpose.
- **Tolerate the mixed-case command name** — rejected; the palette reads as inconsistent, and the registry is the place to keep names uniform.

**Rationale**: `redact.ts` is the single source of truth only if it actually covers every path; the operation-error console was the last hole. The wording fix is cosmetic but keeps the registry authoritative.

**Impact**: `shared/notifications.ts` (+ `notifications.test.ts`), `commands/registry.ts`. No behavior change beyond redaction coverage and palette wording. `data.json` (live keys) remains gitignored; the audit otherwise found no critical/high security issues.

---

## 2026-06-25: REM semantic matching is always-on; literal title/alias matches are down-weighted (#380)

**Context**: REM gated AI semantic matching behind a toggle most users never enabled, so the feature mostly produced only literal title/alias matches — and those literal matches (raw confidence 1.0) out-ranked everything, crowding out the content-relevant links semantic matching is *for*.

**Decision**: Make semantic matching **always run** (drop the enable toggle) and add `titleMatchWeight` (default `0.6`) that multiplies the raw confidence of literal title/alias matches so they no longer automatically dominate the ranking. Candidates from both phases merge, re-rank by confidence, and cap at `maxLinksPerNote`; `confidenceThreshold` now filters *semantic* matches only. Resume re-runs the same gather pipeline, so resumed items also get semantic links.

**Alternatives considered**:
- **Keep the toggle but default it on** — rejected; a setting people never find isn't a real default, and the literal-match ranking problem would remain.
- **Surface `titleMatchWeight` in the settings UI** — deferred; left as a `data.json`-only knob rather than ship an obscure slider most users won't tune.

**Rationale**: REM's value is the non-obvious links. Gating that behind a toggle and then out-ranking it with literal matches buried the whole feature.

**Impact**: `rem/` (`SemanticMatcher` always invoked; weight applied during gather/re-rank); new `rem.titleMatchWeight` setting (no UI). REM auto-accept still **rewrites the note body** — the long-standing caution is unchanged.

---

## 2026-06-25: Note title as an elaboration signal + anti-fabrication guards (#387, #380)

**Context**: Elaboration generated from body text alone. A near-empty note with a meaningful title ("Photosynthesis") produced weak proposals, while a note that is essentially just a URL or a date-named daily note risked the AI fabricating content from a slug.

**Decision**: Surface the note title in every elaboration prompt (`Note title: "<basename>"`) and seed a title-only proposal when the body is empty. Add two **anti-fabrication guards** that return `null` (skip the note, create no proposal) rather than invent content:
- **Guard A** — empty body **and** a generic title (Obsidian "Untitled", date-style daily-note names, bare URLs), detected via the shared `isGenericTitle` predicate.
- **Guard B** — a link-dominated note where **every** external fetch returned nothing.

**Alternatives considered**:
- **Always generate something** — rejected; fabricated elaboration on a date-named note is worse than no proposal.
- **Re-implement "generic title" detection inside elaboration** — rejected; it reuses the shared `isGenericTitle`/`isUntitled` predicate (`shared/title-detector.ts`) so elaboration and the title module agree, honoring the no-feature-to-feature-import rule.

**Rationale**: The title is the single most reliable topic hint for a stub note; the guards keep that signal from becoming a fabrication vector.

**Impact**: `elaboration/proposer.ts` (title context + Guards A/B), shared `isGenericTitle`. `generate()` returning `null` is a normal skip, not an error — callers complete the checkpoint item and move on.

---

## 2026-06-25: In-app update check against the plugin's GitHub Releases (#365)

**Context**: Synapse isn't in the Obsidian community browser yet, so there is no auto-update channel and users had no signal when a newer build shipped.

**Decision**: Add a `shared/UpdateChecker` that — gated on `settings.updates.enableUpdateNotifications` (default on) — polls the plugin's own public GitHub Releases API **at most once per 24h**, compares the latest tag to the running version (`isNewerVersion`, pure semver), and shows a sticky, dismissible notice whose button opens Settings → Community plugins. It **fails silently** (offline / non-200 / malformed → logged `null`) and records the version it surfaced so it never nags twice for the same release.

**Alternatives considered**:
- **Check on every load** — rejected; network spam and rate-limit risk. The 24h gate plus dismissed-version memory keep it quiet.
- **Wait for community-store distribution to provide updates** — rejected as the *only* answer; this is the stop-gap until that lands.

**Rationale**: A once-a-day, self-silencing nudge is the least-annoying way to close the "no auto-update channel" gap.

**Impact**: `shared/update-checker.ts`; new `settings.updates` block (`enableUpdateNotifications`, `lastUpdateCheck`, `dismissedUpdateVersion`); a delayed (5 s) startup timer in `main.ts`.

**Update (2026-06-28)**: Synapse is now in the community store, which delivers updates automatically — so this in-app checker is a *fallback/notice*, not the only update channel. See the 2026-06-28 release-automation entry (#389).

---

## 2026-06-25: In-app "What's new" via build-inlined CHANGELOG.md (#375)

**Context**: Release notes lived only in `CHANGELOG.md` on GitHub; users never saw them in-app.

**Decision**: Inline `CHANGELOG.md` into the bundle at build time (esbuild text loader + a `*.md` ambient type in `shared/markdown.d.ts`) and parse/render it in a `ChangelogModal` reachable from settings. One source file, no network fetch, no drift between the shipped changelog and what's displayed.

**Alternatives considered**:
- **Fetch the changelog from GitHub at runtime** — rejected; offline-fragile and redundant with a file already in the repo.
- **Maintain a separate in-app copy of the notes** — rejected; guarantees drift.

**Rationale**: The changelog is already the source of truth; inlining it at build time shows exactly what shipped with zero extra maintenance.

**Impact**: `changelog.ts`, `changelog-modal.ts`, `shared/markdown.d.ts`; esbuild config. Purely additive UX.

---

## 2026-06-25: Auto-fold the Properties panel on note open (#381)

**Context**: Synapse writes a lot of frontmatter (tags, links, references), so the Obsidian Properties panel can grow tall and push content down on every note.

**Decision**: Add an opt-in `ui.autoFoldProperties` (default **off**) that folds a note's Properties panel — and its heading chevron — when the note opens, via `registerPropertiesAutoFold`. It lives in a new "General" settings section.

**Alternatives considered**:
- **Default it on** — rejected; folding is a personal preference, and silently hiding metadata the plugin just wrote would surprise users.

**Rationale**: The feature exists *because* Synapse-heavy vaults accumulate properties; making it opt-in respects users who want metadata visible.

**Impact**: `properties-fold.ts`; new `ui.autoFoldProperties` setting; new "General" settings section.

---

## 2026-06-25: Actionable video-dependency onboarding notice (#382)

**Context**: When yt-dlp/ffmpeg were missing, video and URL-transcription paths failed with a generic error and no guidance on how to fix it.

**Decision**: Detect the `DependencyMissingError` through the error `cause` chain and show an actionable notice with an "Open settings" button that reveals the Video settings section (where the tool paths live). Path fields also gained tooltips.

**Rationale**: A missing external tool is a setup problem, not a bug; the notice should route the user straight to the fix instead of surfacing a dead-end error.

**Impact**: `summarize/` (dependency-error detection + notice), settings-tab tooltips. No schema change.

---

## 2026-06-23: Summarize the note's own prose + combined-summary mode (#367)

**Context**: Summarize only touched the URLs, transcriptions, and audio a note *referenced* — never the note's own writing — and emitted a separate callout per item, cluttering notes with many references.

**Decision**: Add two toggles, **both default on**. `includeNoteContent` adds the note's own prose (frontmatter and previously-generated Synapse blocks stripped, so it never re-summarizes its own output) as an extra summarize target. `combineSummaries` folds all summarizable items into ONE "Combined summary (N items)" callout instead of one callout each. Both are honored by single-note summarize, the 2+-target selection modal, and vault/folder scans. Enrichment-reference targets stay per-item (they create notes + rewrite links).

**Alternatives considered**:
- **Always combine** — rejected; some users want a per-source callout, so it's a toggle.
- **Summarize whatever's in the note, including prior summaries** — rejected; `extractNoteProse` strips Synapse-generated blocks to avoid a feedback loop where the AI re-summarizes its own output.

**Rationale**: Summarizing a note's own content is the common ask, and one combined block reads far better on reference-heavy notes.

**Impact**: `summarize/` (`extractNoteProse`, combined path, modal defaults); new `summarize.includeNoteContent` and `summarize.combineSummaries` settings.

---

## 2026-06-22: Error notices persist, copy-on-dismiss, softer color (1.0.6)

**Context**: Error toasts auto-dismissed on the standard timer, so a user could miss the message, and the full (often long) error text wasn't recoverable. The error color also read as alarming for routine, recoverable failures.

**Decision**: Error notices now **stay up until dismissed**; clicking one **copies its full (redacted) message to the clipboard** before it closes; and they use a **softer, less-alarming color**. Implemented in `NotificationManager.error()`/`notifyError()`.

**Rationale**: A persistent, copyable error is far easier to act on or paste into a bug report; the softer color matches that these failures are usually recoverable.

**Impact**: `shared/notifications.ts`, `styles.css`. The copied text routes through `redactSecrets`, so keys never reach the clipboard.

---

## 2026-06-20: On-brand icon system (1.0.5)

**Context**: Synapse reused generic Obsidian/Lucide glyphs for its ribbon icons and actions, which diluted the brand and left the actions sidebar visually flat.

**Decision**: Register a set of bespoke Synapse SVG icons (`brand-icons.ts`, `registerSynapseIcons()`) — an S-Signal identity mark plus per-feature glyphs — **before** any ribbon/`setIcon`/view use, and use them for all three ribbon icons, the Synapse Actions sidebar buttons, and per-action command-palette icons.

**Rationale**: Custom marks make the plugin recognizable and give the actions sidebar a scannable, per-feature visual language.

**Impact**: `brand-icons.ts` (`SYNAPSE_ICONS`, `SYNAPSE_ICON_SVG`); ribbon + actions-sidebar + palette icon wiring. No behavior change.

---

## 2026-06-20: Notification timers torn down on unload; audit reaffirms the layering

**Context**: A periodic codebase audit (architecture, security, and Obsidian-guideline compliance) reviewed the plugin at version 1.0.3. It found the code security-mature and the module graph acyclic, but surfaced one lifecycle leak: `NotificationManager` starts a 400 ms `setInterval` to animate the "…" ellipsis on every in-flight operation toast. If the plugin was disabled (or reloaded) while an operation was still running, that interval kept firing against a detached toast — an orphaned timer, exactly the class of leak Obsidian's reviewer guidelines call out.

**Decision**: Add `NotificationManager.dispose()` — it stops every tracked operation's ellipsis interval, hides the notice, and clears the operation map — and call it from `SynapsePlugin.onunload()` after every module's `onunload()`. The audit's other touch-ups were hygiene/doc-only: shared-utility imports normalized to the `../shared` barrel (the `SettingsSectionContext` import), `.gitignore` hardened against stray credential files, and the machine-readable `AGENTS.md` set refreshed.

**Alternatives considered**:
- **Switch the ellipsis to `registerInterval()`** — rejected for now; the manager is a plain class (not an Obsidian `Component`), and a targeted `dispose()` is a smaller, more explicit change that also hides the toasts.
- **Leave it (low impact)** — rejected; a timer firing against a destroyed plugin can throw, and clean unload is a hard requirement for an Obsidian community plugin (and for dev reloads).

**Rationale**: One teardown method, called once on unload, closes the leak without changing any running-operation behavior. It extends the earlier resource-cleanup work (#170) to cover the ellipsis timers added since.

**Impact**: `shared/notifications.ts` (`dispose()`), `main.ts:onunload()`. No user-visible change. The audit otherwise found no critical/high security issues; `data.json` (live keys) remains gitignored.

---

## 2026-06-20: Type-only imports are the sanctioned escape hatch for the acyclic graph

**Context**: The value-level module graph is deliberately acyclic (`shared`/`commands` are base layers; features depend down; the coordination layers inject features rather than importing them). But a few places genuinely need a *type* that lives "above" them in the graph. Importing the value would close a cycle; re-declaring the type locally would drift.

**Decision**: Where only a type is needed, use a TypeScript `import type`, which esbuild erases at compile time — so it creates **no runtime edge** and cannot form a runtime cycle. Three sanctioned cases:
- `audio/index.ts` → `import type { AudioExtractor } from '../video'` for time-range clipping. The runtime value edge stays one-directional `video → audio`; the type-only back-edge carries no JS.
- `settings.ts` → `import type { ProposalKind } from './views/types'` (the single source of truth for proposal kinds / `autoAccept` keys).
- `settings.ts` → `import type { ExclusionRule } from './shared/exclusions'` (the centralized exclusion model, #307).

Both `settings.ts` imports are type-only precisely because `views/types` and `shared/exclusions` sit above `settings` in the value graph; a runtime import would invert the layering.

**Alternatives considered**:
- **Move `AudioExtractor` into `shared/`** (or pass a structural interface) — still the preferred *eventual* cleanup for that one edge, but unnecessary for correctness while the import is type-only. Flagged, not blocking.
- **Re-declare the shared types locally** — rejected; guarantees drift between `ProposalKind`/`ExclusionRule` and their real definitions. A compile-time guard already asserts `ProposalKind` matches the `UnifiedItem` union exactly.

**Rationale**: `import type` lets the codebase share a single authoritative type across layers without paying a runtime dependency. The distinction (erased type edge vs. real value edge) is what keeps the dependency graph provably acyclic at runtime even though a couple of type arrows point "the wrong way."

**Impact**: Documents an intentional, enforced pattern rather than an oversight. The audio→video type edge is the one remaining structural back-edge, slated for a future move of `AudioExtractor` into `shared/`.

---

## 2026-06-19: Registry-driven "Synapse actions" sidebar for mobile reach (#289)

**Context**: On Obsidian mobile the command palette is buried, and there is no `removeRibbonIcon` API, so piling per-feature ribbon icons on isn't viable. Mobile users had no fast path to the plugin's ~20 commands.

**Decision**: Add a second sidebar view, `SynapseActionsView` (`views/`), that renders a touch-friendly button for every *enabled* palette command. The button list is derived from the command registry via `listPaletteActions(registrar.getRegistered())` — no command behavior is re-declared; each button runs the already-registered command through Obsidian's own `executeCommandById`. A `layout-grid` ribbon icon opens it (unconditional, so it's reachable on mobile). Each registry entry now carries a `context` (`note` | `vault` | `global`); per-note buttons disable when no note is active, and for `note` commands the opener re-activates the note's markdown leaf first (opening the sidebar can steal editor focus, which previously made those buttons silently no-op).

**Alternatives considered**:
- **More ribbon icons** — rejected; there's no way to remove them, and they don't scale to ~20 commands.
- **A bespoke action list hand-maintained beside the registry** — rejected; it re-creates exactly the drift the command registry exists to kill. Deriving from `getRegistered()` keeps it authoritative.

**Rationale**: Reusing the registry as the source of truth means the sidebar can never list a command that isn't actually wired, and gating by `context` gives correct enable/disable state per active note. Dispatching via `executeCommandById` honors the same editor/check gating the palette uses.

**Impact**: New `views/synapse-actions-view.ts` + `SYNAPSE_ACTIONS_VIEW_TYPE`; `layout-grid` ribbon icon; `context` field on registry entries; `listPaletteActions` in `commands/`. Mobile users reach any enabled command in ≤2 taps.

---

## 2026-06-19: "Review" action button on proposal-generation toasts (#340)

**Context**: After a scan generated proposals, users got a success toast but still had to find and open the proposal sidebar by hand.

**Decision**: Extend `NotificationManager` notices with an optional `NoticeAction` (a labeled button). Proposal-producing modules surface a "Review" button on their completion toasts that opens the unified proposal view via a shared `onOpenProposalView` callback wired in `main.ts` (the same six modules: elaboration, enrichment, organize, deep-dive, title, rem). Actionable toasts stay up longer (8 s) so the button is clickable.

**Rationale**: One shared opener callback keeps the wiring consistent with the existing `onViewRefreshNeeded` pattern, and the action lives on the toast the user is already looking at.

**Impact**: `shared/notifications.ts` (`NoticeAction`, `showActionNotice`), `main.ts` (`onOpenProposalView` wiring). Purely additive UX.

---

## 2026-06-19: Action-type colors unified into semantic theme tokens (#342)

**Context**: Proposal card colors (blue/green/orange/purple/yellow) and action accents were hard-coded across the UI, making them inconsistent and unfriendly to community themes.

**Decision**: Route action-type colors through semantic CSS theme tokens rather than literal color values, so they adapt to the active Obsidian theme and stay consistent across surfaces.

**Rationale**: Theme tokens are the Obsidian-idiomatic way to color UI; centralizing them removes drift and respects light/dark and community themes.

**Impact**: Styling only (`styles.css` + view code). No behavior change.

---

## 2026-06-19: Defer settings-DOM mutation to a macrotask to avoid an Obsidian freeze (#335)

**Context**: The guided-key "Test" button (added with #335) mutates the settings DOM to show its ✓/✗ result. Doing that synchronously from within the click handler's promise *microtask* could hard-freeze Obsidian's settings pane — a reproducible hang that looked like a CSS or network problem but was neither.

**Decision**: Defer the result-rendering DOM update to a *macrotask* (`setTimeout(…, 0)`) instead of mutating from within the resolving microtask, render the get-key link and status chip outside the settings row so the field keeps focus, and don't return the promise from the button's `onClick`.

**Alternatives considered**:
- **Tweak CSS / drop the `:has()` selector** — tried during diagnosis; `:has()` was one contributor but not the root cause.
- **Mutate synchronously** — that *is* the freezing path; rejected.

**Rationale**: Settling settings-DOM changes onto a macrotask lets Obsidian's own layout/reflow complete first, side-stepping the re-entrant freeze. This generalizes: heavy or focus-sensitive settings-DOM work belongs on a macrotask, not on a microtask chained off a click handler.

**Impact**: The credential-field decorator (`shared/credential-field.ts`) and its settings rendering. The "Test" button now reports results without freezing — captured as an Obsidian engineering lesson for future settings UI.

---

## 2026-06-16: Hoist transcription provider + API key into AI Configuration (#332)

**Context**: Each transcription provider key (Whisper, Deepgram, Gemini) was configured deep inside the Audio settings, far from the primary AI provider/key. Users setting up transcription had to hunt for the right field.

**Decision**: Surface the transcription provider selector and its API key alongside the main AI provider in the "AI Configuration" settings section, so credential setup lives in one place. The underlying fallbacks (`whisperApiKey || ai.apiKey`, `geminiApiKey || ai.apiKey`) are unchanged.

**Rationale**: Co-locating credentials reduces onboarding friction and pairs naturally with the guided key validation (#335) decorator applied to those same fields.

**Impact**: Settings-tab layout only; no schema change.

---

## 2026-06-15: Content-type auto-formatting registry; lyrics formatting (#233, #234)

**Context**: Content-type–specific formatting (recipe, receipt) was wired ad hoc inside the summarize/OCR paths. A new case — song transcripts, which read far better as structured lyrics — needed the same treatment without bolting more special cases onto each caller.

**Decision**: Promote a shared content-type auto-formatting **registry** into `src/shared` (#233), then add a lyrics schema/template that auto-detects song transcripts and formats them as structured lyrics (#234, `audio.autoFormatLyrics`, default on). New content types register against the shared registry instead of editing each consumer.

**Rationale**: A registry makes content-type formatting extensible and testable in one place; the existing recipe/receipt templates proved the pattern, and lyrics slot in cleanly.

**Impact**: New shared content-type registry; `audio.autoFormatLyrics` setting. Song transcripts render as lyrics; other content is unaffected.

---

## 2026-06-14: Centralized path-exclusion model with one-time migration (#307)

**Context**: Every feature carried its own `excludeFolders` list in settings, and several modules hand-rolled near-identical folder/tag matching. The same folder (e.g. `templates/`, `.synapse/`) had to be repeated per feature, and the duplicated matchers drifted (case sensitivity, inline vs. frontmatter tags).

**Decision**: Replace the per-module `excludeFolders` fields with a single `settings.exclusions: ExclusionRule[]`. The model and a glob matcher live in `shared/exclusions.ts`: each rule is `{ pattern, features: 'all' | FeatureId[] }`; `isPathExcluded(path, featureId, settings)` / `findMatchingRule` are first-match-wins. A 12-member `FeatureId` union (with an `ALL_FEATURE_IDS` compile-time exhaustiveness guard) defines who can be excluded. Tag exclusion (`excludeTags`) stays per-module but now routes through a shared `matchesExcludeTag` helper. `main.loadSettings()` runs a one-time `buildMigratedExclusions()` migration, gated on the *raw persisted data* lacking an `exclusions` key, so upgraders' folders are preserved exactly (a folder excluded by every legacy feature collapses to `features: 'all'`). Fresh installs get default rules (`.synapse/**`, `templates/**`) and skip migration. Exclusions are also applied at vault-enumeration sites (#323).

**Alternatives considered**:
- **Keep per-module lists** — rejected; the duplication and matcher drift were the problem.
- **A settings-version system to drive migration** — deferred (#93); gating on the missing `exclusions` key runs the migration exactly once without one.
- **A glob library** — rejected (zero-runtime-deps policy); a small, documented matcher (`dir/**`, `dir/*`, bare token, exact path) covers the needed forms.

**Rationale**: One authoritative list plus one tested matcher removes the per-feature duplication and the drift it caused, and lets a user scope an exclusion to specific features or to all of them. The exhaustiveness guard forces every new flow to make an explicit exclusion decision.

**Impact**: New `shared/exclusions.ts`; `settings.exclusions` replaces all per-module `excludeFolders`; chip multi-select UI for feature scoping (#328); one-time migration in `loadSettings()`. Behavior-preserving for upgraders.

---

## 2026-06-14: Desktop-only Node access behind a single guarded loader (#299)

**Context**: The plugin ships `isDesktopOnly: false`, so the bundle must load on Obsidian mobile, which has no `os`/`path`/`fs`/`child_process`. esbuild marks those builtins `external`, so any *top-level* `require('fs')` would throw on mobile at module-load time — before any `Platform.isDesktop` guard could run. The earlier fix (#198) used lazy getters scattered across modules; that worked but spread the invariant thin.

**Decision**: Centralize every Node-builtin access in one module, `shared/node-loader.ts`:
- `loadNodeModules()` lazily `require`s `os`/`path`/`fs`/`child_process.execFile` *inside the function body* and returns typed handles. It calls `assertDesktop()` first.
- `assertDesktop(context?)` throws a descriptive `DesktopOnlyError` off-desktop, instead of a raw `Cannot find module 'fs'`.
- `shellEnv()` builds a narrowed, allowlisted environment (augmented `PATH`, plus `HOME`, `TMPDIR`, and proxy vars when present) for spawning yt-dlp/ffmpeg/ffprobe.

This is the single sanctioned `no-var-requires` site; audio, video, and transcription/duration-detection route through it after an explicit desktop assertion.

**Alternatives considered**:
- **Keep scattered lazy getters (#198)** — worked, but the mobile-safety invariant lived in many files; one loader makes it auditable in one place.
- **Separate mobile/desktop builds** — rejected; doubles build complexity for a single bundle artifact.
- **`isDesktopOnly: true`** — rejected; would lock mobile users out of all the text/AI features that need no Node builtins.

**Rationale**: One guarded entry point makes the "never touch Node at module top level" rule structural rather than a convention each file must remember, and a distinct `DesktopOnlyError` makes any violation obvious in logs. Desktop-only features degrade gracefully; everything else runs on mobile.

**Impact**: New `shared/node-loader.ts` (`loadNodeModules`, `assertDesktop`, `DesktopOnlyError`, `shellEnv`). Audio/video/duration-detector call it behind a desktop guard. `manifest.json` stays `isDesktopOnly: false`; the bundle loads on mobile. Supersedes the scattered lazy-getter approach from the 2026-03-19 "Lazy Node.js requires" decision.

---

## 2026-06-11: First-run onboarding welcome (#89)

**Context**: A brand-new install dropped users into a fully-featured plugin with no API key set and no pointer to where to start; AI operations would simply fail until a key was configured.

**Decision**: Add a pure, testable `onboarding` module (`src/onboarding.ts`). On a genuine fresh install (`loadData()` returns nothing), show a one-time welcome notice pointing at the settings tab, then persist `onboarding.hasSeenWelcome` so it never fires again; existing upgraders are marked seen silently. The settings tab additionally emphasizes the AI provider API-key field as "required" while the active hosted provider still lacks a key. All decision logic is pure (`planFirstRun`, `needsApiKey`); the caller performs the side effects, so every branch is unit-testable without rendering a settings tab.

**Alternatives considered**:
- **A multi-step onboarding modal/wizard** — rejected as heavier than warranted; a single notice plus a "required" field cue is enough to unblock setup.
- **Show the welcome to upgraders too** — rejected; only genuine fresh installs need it.

**Rationale**: Keeping the logic pure makes onboarding deterministic and testable, and gating on a missing-persisted-data signal cleanly distinguishes fresh installs from upgrades without a settings-version system.

**Impact**: New `src/onboarding.ts`; `settings.onboarding.hasSeenWelcome`; `runFirstRunOnboarding()` runs last in `onload()` and never blocks load.

---

## 2026-06-16: Guided key onboarding + live validation (OAuth deferred)

**Context**: Every AI/transcription provider was configured by pasting a raw API key into a password field with no validation. A typo, wrong-provider, or expired key failed *silently* and only surfaced later when an elaboration/transcription operation errored out — the single biggest onboarding-friction point. The original ask (#335) was an OAuth/OIDC "click to connect your provider" button to replace keys.

**Decision**: Ship the achievable friendlier-auth win that works for **all** providers today — guided key acquisition + live validation — and defer OAuth. Concretely: a per-provider metadata map (`shared/provider-metadata.ts`: console get-key URL, placeholder/format hint, probe spec), a pure `validateCredentials()` checker (`shared/credential-validator.ts`) that fires one minimal authenticated GET and returns a redacted ✓/✗ result, and a reusable settings decorator (`shared/credential-field.ts`: "Get an API key →" link + "Test" button + inline status chip) applied to the shared AI key, the per-provider transcription keys, and the Ollama endpoint. Validation logic lives in pure modules (not UI callbacks) because the Obsidian test mock no-ops `Setting.addText`; the get-key link + chip render in the section body and the chip updates in place so the field keeps focus. Validation state is ephemeral — never persisted to settings.

**Why not OAuth (as of June 2026)**: third-party use of Anthropic subscription OAuth tokens is **banned** by ToS (2026-02-19) — `sk-ant-oat…` is rejected by the Messages API; OpenAI "Sign in with ChatGPT" is **identity-only** and grants no general API access; Google Gemini OAuth is viable only via **Vertex AI** (needs a GCP project + billing). Building a "connect" button for the first two would be a dead end or a ToS violation, so a friendlier *key* UX serves all providers without that risk. An OAuth "Connect" spike for Google/Vertex (via `registerObsidianProtocolHandler` + PKCE) remains a deferred stretch goal.

**Alternatives considered**:
- **OAuth "Connect" button now** — rejected. Not viable for our main providers (above); would either fail or violate ToS.
- **Persist validation state to settings** (e.g. `ai.keyValid`) — rejected. A stored "valid" flag goes stale the moment a key rotates or expires; the chip is a point-in-time live check, so keep it ephemeral and leave the settings schema (and `version-bump --check`) untouched.
- **Validate inside the settings `onChange`/UI callback** — rejected. The Obsidian test mock no-ops `addText`, so any behavior there is unreachable by unit tests; the probe lives in a pure module instead.
- **Retry the probe** (reuse `withRetry`) — rejected for the probe path. A "Test" click should report immediately; retrying would make a wrong key take seconds.

---

## 2026-06-11: Canonical secret-redaction module (`shared/redact.ts`)

**Context**: Two code paths scrubbed API keys/tokens out of strings before they could reach a user-facing Notice, an error message, an echoed-back upstream error body, or the console: the AI client (`ai-client.ts`) and `notifyError` (`api-utils.ts`). Each kept its *own* inline copy of the redaction regex, and the two had drifted — the `notifyError` copy was missing the Google `AIza…` (Gemini) pattern. A leaked Gemini key surfaced through `notifyError` would have been shown to the user verbatim.

**Decision**: Extract one canonical `redactSecrets()` into a new `shared/redact.ts` and make it the single source of truth. Both `ai-client.ts` (upstream error bodies) and `api-utils.ts:notifyError` (any error shown to the user/console) now route through it. It is re-exported from `ai-client.ts` and the `shared` barrel for back-compat. Covered shapes: `sk-`/`sk-ant-`, generic `key-`, Deepgram `dg-`, `Bearer `/`Token ` header values, `anthropic-` identifiers, and Google `AIza` keys.

**Alternatives considered**:
- **Keep two copies, just add the missing pattern to `notifyError`** — rejected. Fixes today's drift but not the cause; two regexes will drift again the next time a provider is added.
- **A lint rule that bans raw key patterns in strings** — rejected as heavier and orthogonal; it doesn't give us one tested redactor to call.

**Rationale**: One function, one regex, one place to extend when a new provider key shape appears — and one set of regression tests instead of two partial ones. The drift that exposed Gemini keys becomes structurally impossible once both callers share the module.

**Impact**: New `src/shared/redact.ts`. Redaction is now consistent across both surfaces and covers Gemini `AIza` keys everywhere. Behavior-preserving except that `notifyError` now also redacts Gemini keys. Regression tests added (`ai-client.test.ts`, `api-utils.test.ts`).

> _Later (2026-06-25): `notifyError` moved into `notifications.ts`, and the per-operation error `console.error` sink was brought under the same redactor — so `redactSecrets` now covers **every** error path, not just the two original surfaces. See the 2026-06-25 audit entry at the top of this log._

---

## 2026-06-11: Harden multipart transcription bodies against header injection

**Context**: Obsidian's `requestUrl` has no `FormData`, so `audio/transcriber.ts` hand-builds the `multipart/form-data` body for Whisper uploads (`buildMultipartBody`). The part field names and the uploaded file name are **vault-/settings-derived** — i.e. influenceable via a crafted note or embed file name — and were interpolated straight into `Content-Disposition` header lines. A file name containing CRLF or a quote (e.g. `x"\r\nContent-Disposition: ...`) could break out of the quoted parameter to inject extra headers or forge new multipart parts.

**Decision**: Sanitize every untrusted value before it reaches a header line. A new internal `sanitizeMultipartHeaderValue()` strips all CR/LF and replaces `"` and `\` (the only characters that can escape a quoted header parameter) with `_`; field *values* additionally collapse CR/LF to spaces so they cannot start a new part. The binary file payload is appended raw and never interpreted as text.

**Alternatives considered**:
- **Reject file names containing suspicious characters** — rejected; would fail legitimate transcriptions for benign-but-unusual names. Sanitizing is non-destructive to the actual audio upload.
- **Percent-encode header values (RFC 6266)** — rejected as overkill for a controlled internal body; strip-and-replace provably closes the break-out characters with less code.

**Rationale**: Defense-in-depth on any vault-derived string that crosses into a wire-format header. The fix is local, has no effect on normal file names, and removes the only injection-capable characters.

**Impact**: `audio/transcriber.ts` only (`buildMultipartBody` + new `sanitizeMultipartHeaderValue`). No user-visible change for normal transcriptions. Regression tests added.

---

## 2026-06-11: Shared utilities are imported through the `shared` barrel only

**Context**: An architecture audit found shared utilities being reached inconsistently — through a *sibling feature module* or through an *internal `shared/` file* rather than the `shared` barrel. Concretely: base64 helpers pulled via `image/preprocess`, and an **undocumented static `summarize → video` import** had crept in even though `video.transcribeUrl` is supposed to arrive only by constructor injection. The static edge contradicted both the docs and the acyclic-graph rule.

**Decision**: Establish and enforce one rule — **shared utilities are imported from the `../shared` barrel, never from a sibling feature module and never from an internal `shared/` file.** Normalize the offending imports (`image/preprocess.ts`, `summarize/index.ts`, `elaboration/image-analyzer.ts`) to the barrel, and remove the static `summarize → video` import (summarize keeps `video.transcribeUrl` strictly as an injected dependency; the URL-platform helpers `isSupportedUrl`/`detectPlatform` resolve from `shared`). Canonical homes (`url-detector.ts`, `redact.ts`, `encoding.ts`) live in `shared/` and may be re-exported elsewhere for back-compat, but consumers import the barrel.

**Alternatives considered**:
- **Allow re-export "convenience" imports through whichever module is nearest** — rejected; that is exactly what let the static `summarize → video` edge appear, and it makes the dependency graph ambiguous.
- **Deep-import internal `shared/` files directly (e.g. `shared/encoding`)** — rejected; couples callers to `shared`'s internal file layout. The barrel is the stable contract.

**Rationale**: A single import convention keeps the dependency graph legible and acyclic, prevents accidental feature-to-feature coupling, and lets `shared` reorganize its internals freely behind the barrel.

**Impact**: Imports normalized in `image/preprocess.ts`, `summarize/index.ts`, `elaboration/image-analyzer.ts`; the static `summarize → video` edge is removed (now injection-only).

**Known exception (flagged for cleanup)**: `audio/index.ts` keeps a **type-only** `import type { AudioExtractor } from '../video'` for time-range clipping. Because the type is erased at compile time it creates **no runtime cycle** (the runtime edge remains the correct `video → audio`), but it is a structural back-edge against the layering. A future cleanup could move `AudioExtractor` into `shared/` or pass it through a structural interface.

---

## 2026-06-08: Eliminate the `shared ⇄ video` circular dependency

**Context**: `shared/` is the base layer of the codebase — every feature module depends on it, and by design it must depend on *no* feature module. An audit found that `url-detector.ts` lived in `video/`, yet `shared/` code reached back into it for URL parsing. That inverted the layering and created a genuine import cycle: `shared → video → shared`. Cycles make the dependency graph non-deterministic to reason about, complicate testing in isolation, and risk subtle load-order bugs.

**Decision**: Relocate `url-detector.ts` (and its tests) from `src/video/` into `src/shared/`. The URL detector is a pure parsing utility with no video-specific dependencies, so it belongs in the base layer. After the move, the only edge between the two modules is the correct, one-directional `video → shared`.

**Alternatives considered**:
- **Document the cycle as an accepted exception** — rejected. It leaves the cycle in place; the graph stays non-acyclic and the layering rule stays violated.
- **Dependency-inject the detector into `shared`** — rejected. Same outcome: the runtime cycle still exists, just hidden behind an injection seam, at the cost of extra wiring.

**Rationale**: Moving the file is the only option that actually removes the cycle rather than masking it. The detector is base-layer-appropriate code, so the move also improves conceptual placement. `shared` now depends on no feature module, and the whole dependency graph is acyclic.

**Impact**: `src/video/url-detector.ts` → `src/shared/url-detector.ts`; `src/video/url-detector.test.ts` → `src/shared/url-detector.test.ts`. `video/` now imports `findVideoUrls`/`detectPlatform`/`isSupportedUrl` from `shared`. No behavior change; all tests still pass. The dependency graph is now provably acyclic with `shared` and `commands` as base layers.

---

## 2026-06-08: Sanitize vault-derived basename before building temp paths (security hardening)

**Context**: A security pass reviewed `transcription/duration-detector.ts`, which builds a temporary file path from a note's `basename` before invoking `ffprobe`. A crafted basename (e.g. one containing path separators) could in principle influence where the temp file lands.

**Decision**: Sanitize the basename to a safe character set (`[^A-Za-z0-9._-]` → `_`) before composing the temp path, so a crafted name can never escape `os.tmpdir()`.

**Alternatives considered**:
- **Leave as-is** — rejected; cheap to harden, and defense-in-depth on any vault-derived string that feeds a filesystem path is worth it.
- **Hash the basename** — rejected; loses human-readability of temp files for negligible extra safety.

**Rationale**: One-line, zero-behavior-change hardening that closes a low-severity path-traversal surface. This was the only code change the security pass required — the rest of the codebase was already security-mature.

**Impact**: `duration-detector.ts` only. No user-visible change.

---

## 2026-06-08: Per-proposal-type auto-accept (Issue #228)

**Context**: Every proposal kind (elaboration, enrichment, organize, deep-dive, title, REM) routed through the same manual review sidebar. Users who trust one feature still had to click through its proposals one by one, with no way to opt a single feature into hands-off operation.

**Decision**: Add an `autoAccept` settings group with one boolean per proposal kind (`autoAccept.{elaboration|enrichment|organize|deep-dive|title|rem}`), all defaulting to `false`. Each module receives a `shouldAutoAccept` predicate, wired in `main.ts` to its setting. When true, a freshly generated proposal is accepted in full as generated.

**Alternatives considered**:
- **One global auto-accept switch** — rejected; users trust features unevenly (e.g. happy to auto-tidy, but want to eyeball folder moves).
- **Confidence-threshold auto-accept** — rejected as a larger feature; deferred. A per-kind boolean is the minimal honest control.

**Rationale**: Per-kind granularity matches how users actually build trust in the tool — incrementally, one feature at a time. All-false defaults preserve the existing review-everything behavior.

**Impact**: New `AutoAcceptSettings` group. **Safety note:** REM auto-accept is unlike the others — it *rewrites the note body* (inserting `[[wikilinks]]`) rather than appending a separate section. This is called out in the REM module docs so users understand the difference before enabling it.

---

## 2026-06-08: Coalesce similar organize folder names (Issue #172)

**Context**: When the organize module proposes new directories for a batch of notes, the AI sometimes produced near-duplicate folder names for the same concept (e.g. `Recipes`, `Recipe`, `Cooking Recipes`), fragmenting what should be one folder.

**Decision**: Add a coalescing step that detects similar proposed folder names within a run and merges them to a single canonical name before presenting proposals.

**Rationale**: Reduces folder sprawl and keeps the vault's directory structure coherent without requiring the user to manually reconcile near-duplicates after the fact.

**Impact**: Organize proposals for a batch now converge on shared folders. Single-note organize is unaffected.

---

## 2026-06-08: Intake folder auto-processing (Issue #111)

**Context**: Users wanted a "drop it and forget it" inbox — add a note (or a media/article URL) to a watched folder and have Synapse process it automatically, rather than running commands by hand.

**Decision**: Add an `intake/` module that watches a configurable folder, debounces until a note settles, routes it (article URL / media URL / general), runs the full Fire Synapse pipeline on that single note via an injected `fireOnFile`, stamps a `synapse-processed` frontmatter flag for idempotency, and optionally relocates the note. The module imports **only** `obsidian` and `shared/` — all cross-module work flows through an injected `IntakeDeps` object, so intake never depends on a feature module.

**Alternatives considered**:
- **Let intake import the pipeline/feature modules directly** — rejected; would couple the watcher to concrete features and risk cycles. Dependency injection keeps intake at the leaf of the graph.
- **Process on every file event** — rejected; notes are saved many times while being edited. A per-path debounce (settle window) avoids reprocessing mid-edit.

**Rationale**: A settle-then-process loop with a frontmatter idempotency flag gives reliable, exactly-once auto-processing that survives reloads. Routing through `IntakeDeps` preserves the architecture rule that intake (and the pipeline) never reach into feature modules.

**Impact**: New `settings.intake` group (watched folder, settle seconds, move-when-done, capture log). The media-transcription branch is a documented stub (#112). A capture-log breadcrumb (#224) records when a note is organized out of the inbox, with guards to prevent an infinite ingest loop.

---

## 2026-06-08: Fire Synapse multi-phase pipeline (`pipeline/` module)

**Context**: Several features each had their own "scan a folder" command. Running a full pass over a directory meant invoking each one separately, in no enforced order. Organize in particular *must* run last (it moves notes), but nothing guaranteed that.

**Decision**: Add a `pipeline/` module with a `SynapseRunner` that runs an ordered, fixed sequence of phases over a folder or a single note: **elaboration → summarize → enrichment → REM → tidy → organize**. Each phase is one feature module's scan function, injected via a `PipelineModuleMap` in `main.ts`; the pipeline imports `commands/` (for flow gating) but never the feature modules themselves. Phases are gated by both the feature's `enabled` setting and command-registry flow membership, and each phase is wrapped in try/catch so one failure doesn't abort the run.

**Rationale**: A single ordered runner makes "do everything to this folder" one action with deterministic ordering. Organize runs last by construction — as the content-aware mover, it relocates notes only after all content has been generated. Dependency injection keeps the runner decoupled from concrete features (same rule intake follows).

**Impact**: `synapse:fire` command + the synthetic `tidy-vault` pipeline phase. `SynapseRunner.fireOnFile` is the single-note entry point reused by the intake module.

---

## 2026-06-08: REM module — in-place wikilink discovery (`rem/`)

**Context**: Enrichment suggests links as a separate section, but users also wanted Synapse to find places in the *existing prose* where a phrase matches another note's title/alias and turn it into a `[[wikilink]]` in place.

**Decision**: Add a `rem/` module (Re-link & Enrich Mappings) that scans note text for literal title/alias matches (plus optional AI semantic matches above a confidence threshold) and proposes in-place `[[wikilink]]` insertions. Accepting a proposal rewrites the note body; the pre-edit content is snapshotted for undo. REM is phase 4 of the Fire Synapse pipeline and appears in the unified proposal view.

**Rationale**: Literal title/alias matching is high-precision and cheap; semantic matching is opt-in behind a confidence gate. Snapshotting before the body rewrite makes the destructive edit safely reversible. Exclusion rules reuse the existing enrichment `excludeFolders`/`excludeTags` rather than inventing a parallel set.

**Impact**: Two new commands (`rem-current-note`, `rem-directory`). REM is the one proposal kind whose accept rewrites prose rather than appending a section — important context for the auto-accept feature (#228).

---

## 2026-06-05: Central command registry (Issue #215)

**Context**: Synapse registered 23 commands via scattered `addCommand()` calls across 9 files. The only gate was each feature's user-facing `enabled` setting — all-or-nothing per feature — and there was no single place to audit commands or to deprecate/disable one or remove it from a specific flow (palette, Fire Synapse, startup) without hunting through modules. The drift was already real: `AGENTS.md`'s command table was missing 3 of the 23 commands.

**Decision**: Add a developer-facing command registry under `src/commands/` (`types.ts`, `registry.ts`, `registrar.ts`, `audit.ts`, `index.ts`) that sits *above* user settings. `COMMAND_REGISTRY` is the source of truth (id, name, feature, `status`, `flows`, optional `pipelineKey`). Modules keep handlers co-located but call `registrar.register(id, userEnabled, spec)` instead of `plugin.addCommand(...)`; the registrar registers only when `status === 'active' && flows.includes('palette') && userEnabled`. Fire Synapse (`synapse-runner.ts`) and the elaboration startup scan AND-in `isPipelineKeyInFlow`/`isInFlow`. An end-of-onload audit (also a Vitest test) flags drift in both directions. Ships behavior-preserving: all entries `active` with current flows.

**Alternatives considered**:
- Single centralized wiring file owning all `addCommand` calls (moves handlers away from their modules; loses module-local closures; bigger, riskier migration than a 1:1 call-site swap).
- Settings-authoritative (extend per-feature settings) — rejected; this is a *developer* kill-switch that must override user settings, not another user toggle.
- Hang `pipelineKey: 'tidy'` on the `tidy-current-note` palette command — rejected; the pipeline runs `tidy.scanVault()` (vault-wide) while that command runs `tidy()` on one note. Coupling them would let disabling the palette command silently drop tidy from Fire Synapse. Instead a synthetic, pipeline-only `tidy-vault` entry owns `pipelineKey: 'tidy'` (24 registry entries; 23 real commands).
- Pass an explicit `loadedFeatures` set to the audit — rejected; re-creates the hand-maintained list the registry exists to kill. The audit derives "feature loaded" from the attempted set instead, which also makes the platform-gated `video` module correct for free.

**Rationale**: A 1:1 call-site swap keeps the migration mechanical and low-risk while giving one authoritative control surface. `pipelineKey` is typed `string` (not `PipelineModuleKey`) so `commands/` imports nothing from `pipeline/` — `pipeline/` imports `commands/`, so a back-import would close a cycle; `registry.test.ts` cross-checks the keys against `SYNAPSE_PIPELINE` to recover the type safety. Fail-open choices (unknown id in `register`, unmapped key in `isPipelineKeyInFlow`) preserve behavior under drift and let the audit surface it rather than silently dropping a working command/phase.

**Impact**: All 23 commands now flow through `CommandRegistrar`; 8 module constructors take a registrar (summarize at position 5, before its optional transcribe callbacks). Developers can deprecate/disable a command or remove it from a single flow by editing one registry entry. CI fails on registry↔handler drift. Known limitation: a fully disabled feature can't be drift-checked (its `onload()` never runs). See `docs/agent/command-registry.md`.

---

## 2026-03-19: Receipt content template for OCR text extraction (Issue #200)

**Context**: The OCR module extracts raw text from images, but receipt images contain structured data (store name, items, prices, totals) that benefits from a specialized extraction format rather than raw text dump.

**Decision**: Add a `receipt` content template to the OCR pipeline that detects receipt-like content and applies a structured extraction prompt. The template formats OCR output with store info, line items with prices, subtotals, and totals.

**Alternatives considered**:
- Raw OCR only (loses structured financial data)
- Separate receipt scanning command (fragments UX)
- Post-processing step after OCR (doubles AI cost)

**Rationale**: Receipt detection is cheap (keyword scoring on OCR output) and the structured template produces dramatically more useful output for expense tracking and bookkeeping workflows. Follows the same template pattern established for recipe summarization.

**Impact**: Receipt images produce structured extractions with itemized data. Non-receipt images are unaffected.

---

## 2026-03-19: Lazy Node.js requires for mobile safety (Issue #198)

**Context**: Obsidian mobile crashes on top-level `require('child_process')` / `require('fs')` even if the code path is never executed. The plugin had `isDesktopOnly: false` but still imported Node.js built-ins at module scope.

**Decision**: Wrap all Node.js built-in requires (`child_process`, `fs`, `os`, `path`) in lazy getter functions that only resolve on first access. Desktop-only features (yt-dlp, ffmpeg, ffprobe) gracefully degrade on mobile.

**Alternatives considered**:
- Separate mobile/desktop builds — doubles build complexity
- Dynamic `import()` — not supported in Obsidian's module system
- Gate entire modules behind `Platform.isDesktop` — loses mobile access to non-CLI features within those modules

**Rationale**: Lazy getters are minimal code change, zero runtime cost on mobile, and keep a single build artifact. The pattern is applied to `video/audio-extractor.ts` and `transcription/duration-detector.ts`.

**Impact**: Plugin no longer crashes on mobile load. Video/audio clipping features silently fall back to full-file processing on mobile.

---

## 2026-03-19: Instagram Reels URL detection for transcription pipeline (Issue #197)

**Context**: Users share Instagram Reels URLs in their notes. The transcription pipeline only recognized YouTube and TikTok URLs, leaving Instagram content unsupported.

**Decision**: Add Instagram Reels detection to `url-detector.ts`. Recognizes `instagram.com/reel/{id}` and `instagram.com/p/{id}` URL patterns. Platform type extended to `'youtube' | 'tiktok' | 'instagram' | 'unknown'`.

**Alternatives considered**:
- Only support YouTube and TikTok (misses growing Instagram Reels usage)
- Generic "any URL" support (yt-dlp supports many sites but detection UX needs platform-specific badges)

**Rationale**: Instagram Reels are increasingly common in note-taking workflows. yt-dlp already supports Instagram extraction, so the only change needed is URL detection and badge display in the transcription modal.

**Impact**: Instagram Reels URLs show platform badge in transcription modal and are processed through the existing yt-dlp pipeline. `UnifiedTranscriptionModal` displays Instagram badge alongside YouTube and TikTok.

---

## 2026-03-19: Duration-aware time-range slider for transcription clipping (Issues #192, #194, #196)

**Context**: Users wanted to transcribe specific segments of audio/video rather than entire files. This required (1) knowing media duration before presenting a UI, and (2) a visual way to select the time range.

**Decision**: Three-part implementation:

1. **Duration detection** (`transcription/duration-detector.ts`): Probes media length via ffprobe (local files) or yt-dlp (URLs). Returns `DurationResult` with duration and title. Falls back gracefully on mobile or when tools are unavailable.

2. **Time-range slider** (`transcription/time-range-slider.ts`): Pure DOM component with dual-handle range inputs on a shared track. Visual highlight for selected region, live timestamp labels (MM:SS or HH:MM:SS), step size adapts to media length (1s for <= 10min, 5s otherwise).

3. **Time-range toast** (`transcription/time-range-toast.ts`): Non-dismissible Obsidian Notice with embedded slider. "Transcribe Selection" button returns `TimeRange`; "Full File" button returns `undefined`.

The slider appears in `UnifiedTranscriptionModal` when detected duration >= 10 seconds (`MIN_SLIDER_DURATION`). Audio clipping uses ffmpeg; video clipping uses ffmpeg on extracted audio. Both are desktop-only with full-file fallback on mobile.

**Alternatives considered**:
- Text input for start/end times — error-prone, poor UX
- Always show slider with unknown duration — misleading
- Waveform visualization — complex, large dependency, marginal benefit

**Rationale**: Duration detection is fast (metadata-only, no download). Dual-handle slider provides intuitive visual feedback. The toast pattern reuses Obsidian's Notice system without a full modal. Falls back gracefully when detection fails.

**Impact**: New files in `transcription/`: `duration-detector.ts`, `time-range-slider.ts`, `time-range-toast.ts`. Callout titles include time range when clipped: "Transcription of file.mp3 [01:30 - 05:00]". Desktop-only for clipping (mobile gets full-file fallback).

---

## 2026-03-19: Broaden URL detection for YouTube and TikTok edge cases (Issue #190, #191)

**Context**: Users encountered YouTube and TikTok URL variants that the existing regex patterns did not match: YouTube Shorts with query params, YouTube Music URLs, TikTok mobile share links with tracking parameters.

**Decision**: Expand URL detection regexes in `url-detector.ts` to handle additional patterns:
- YouTube: `music.youtube.com`, shorts with query params, embedded URLs
- TikTok: `vm.tiktok.com`, `vt.tiktok.com` short links, URLs with tracking query params

**Alternatives considered**:
- Parse URLs with the `URL` API and match by hostname (cleaner but loses line-number tracking from regex scan)
- Only support canonical URL forms (too restrictive for real-world note content)

**Rationale**: Users paste URLs directly from mobile share sheets, which produce non-canonical forms. Broader regex coverage prevents false negatives without increasing false positives.

**Impact**: More YouTube and TikTok URLs are correctly detected in notes. No behavior change for already-matched URLs.

---

## 2026-03-19: Display plugin version in settings header (Issue #178)

**Context**: Users had no easy way to check which version of Synapse they were running, especially when reporting bugs.

**Decision**: Display the plugin version from `manifest.json` in the settings tab header, next to the plugin name.

**Alternatives considered**:
- Separate "About" section in settings (over-engineered)
- Console log on load (not discoverable)

**Rationale**: Minimal change, high discoverability. Users see the version every time they open settings.

**Impact**: Settings header shows "Synapse v0.3.2" (or current version).

---

## 2026-03-19: Revised hybrid strategy -- caption-first with extraction fallback (Issue #166, follow-up)

**Context**: After the initial hybrid extraction decision (below), a key insight emerged: Synapse's actual need is transcription (URL to text), not video downloading. The user does not need the video file itself -- they need the transcript, and optionally a summary. This reframes the problem: if we can get text from a URL without ever downloading audio or video, the entire yt-dlp/ffmpeg dependency becomes unnecessary for the most common use case.

**Decision**: Adopt a three-tier "caption-first" strategy that tries the cheapest/simplest approach first and falls back progressively:

### Tier 1: Caption/subtitle extraction (no audio processing, no external tools)

For YouTube specifically, captions can be fetched as text without downloading any media:

- **YouTube Data API v3** (`captions.list` + `captions.download`): Can list and download caption tracks for any public video. Requires only an API key for listing, but downloading caption content requires OAuth 2.0 authorization as the video owner -- so this path is limited to listing available tracks and their metadata. It cannot download third-party video captions with just an API key.

- **youtube-transcript libraries / innertube API**: Multiple open-source libraries (e.g., `youtube-transcript`, `youtubei.js`) access YouTube's internal transcript endpoint without OAuth. These work as pure HTTP requests (no CLI tools) and return timed transcript text for any video that has captions enabled. This is the most promising Tier 1 path -- it is a simple HTTP call that works from any platform including mobile, requires no API keys, and handles the majority of YouTube videos (auto-generated captions cover most English-language content).

- **Limitations**: Tier 1 only works for platforms that expose captions. YouTube has excellent coverage (auto-generated captions for most videos). TikTok does not expose captions via any public API -- there is no equivalent subtitle endpoint.

### Tier 2: URL-based transcription via existing provider APIs

Both Deepgram and AssemblyAI accept URLs as direct input -- no local audio extraction needed:

- **Deepgram**: The `/v1/listen` endpoint accepts a JSON body with `{"url": "https://..."}` pointing to a publicly accessible audio or video file. Deepgram's server fetches the media and transcribes it. This works for direct media URLs (e.g., `.mp3`, `.mp4` hosted files) but does NOT work for YouTube/TikTok page URLs -- Deepgram cannot resolve a `youtube.com/watch?v=...` URL to its underlying media stream.

- **AssemblyAI**: The `/v2/transcript` endpoint accepts `{"audio_url": "https://..."}` and handles fetching and transcription server-side. Same limitation as Deepgram: requires a direct media file URL, not a platform page URL.

- **OpenAI Whisper API**: Does NOT accept URLs. The `/v1/audio/transcriptions` endpoint requires a file upload via `multipart/form-data`. The audio data must be in the request body. This means Whisper always requires the audio file to be obtained locally first.

- **Practical implication**: Tier 2 works for direct audio/video file URLs (e.g., podcast RSS enclosures, hosted recordings) but cannot replace yt-dlp for platform URLs. It is useful as a fallback for non-YouTube sources where a direct media URL is available.

### Tier 3: Full extraction fallback (existing pipeline)

When Tiers 1 and 2 cannot handle the URL:
- **Desktop**: Use yt-dlp + ffmpeg via `LocalExtractor` (existing pipeline, unchanged)
- **Mobile**: Use `ServerExtractor` calling a user-configured endpoint (as originally designed)
- **Covers**: TikTok URLs, age-restricted YouTube videos without captions, any platform where caption extraction fails

### Revised architecture

The `MediaExtractor` strategy interface from the original decision is retained, but the implementation hierarchy changes:

```
TranscriptionStrategy (interface)
  |-- CaptionExtractor        (Tier 1: HTTP-only, YouTube captions, cross-platform)
  |-- UrlTranscriptionProvider (Tier 2: Deepgram/AssemblyAI URL input, cross-platform)
  |-- LocalExtractor           (Tier 3: yt-dlp + ffmpeg, desktop only)
  |-- ServerExtractor          (Tier 3: cloud function, mobile fallback)
```

The orchestrator tries tiers in order: caption extraction first (free, fast, no API cost), then URL-based transcription if the user has Deepgram/AssemblyAI configured and a direct URL is available, then full extraction as last resort.

**Alternatives considered**:

- **Caption-only, drop extraction entirely**: Rejected. TikTok has no caption API, and some YouTube videos have captions disabled. The extraction fallback is necessary for full platform coverage. However, caption-first dramatically reduces how often extraction is needed.

- **Require Deepgram/AssemblyAI for URL transcription**: Rejected as sole strategy. These services cannot resolve platform page URLs (youtube.com, tiktok.com) to media streams. They work for direct file URLs only. Also requires users to sign up for and pay for an additional service beyond what they already have (OpenAI/Anthropic).

- **Build a YouTube caption fetcher only, skip TikTok**: Considered as an MVP. YouTube is likely 90%+ of the use case. TikTok support could be deferred to a later milestone if the extraction fallback proves too complex.

**Rationale**: This tiered approach is a significant simplification over the original hybrid decision:

1. **YouTube transcription works everywhere with zero dependencies** -- Caption extraction is pure HTTP, works on mobile and desktop, requires no API keys, no external tools, and no server endpoint. This covers the dominant use case.

2. **The custom server endpoint (issue #181) becomes optional, not required for mobile** -- Mobile users get YouTube transcription via caption extraction without any server. The server endpoint is only needed for TikTok on mobile or for videos without captions.

3. **Existing OpenAI Whisper users are unaffected** -- For local audio files, the pipeline is unchanged. Whisper API is still the transcription backend for file-based audio.

4. **Cost savings** -- Caption extraction is free (no API call). Even when falling back to Whisper, skipping yt-dlp download + extraction is faster.

**Impact on follow-up issues**:

- **Issue #180 (abstract extraction interface)**: Still needed, but the interface expands from `MediaExtractor` to `TranscriptionStrategy` with four implementations instead of two. Scope increases slightly but complexity per implementation decreases (CaptionExtractor is ~50 lines of HTTP code).

- **Issue #181 (server-side endpoint)**: Downgraded from "required for mobile" to "optional fallback." Mobile YouTube transcription works without it via caption extraction. The server endpoint is still valuable for TikTok-on-mobile and captionless videos, but it is no longer a blocker for the v0.7.0 mobile milestone.

- **Issue #182 (mobile-aware strategy selection)**: Simplified. Instead of "desktop = local, mobile = server (required)", the logic becomes "try captions first (any platform), then try URL transcription, then try local extraction (desktop), then try server extraction (if configured)." Mobile works out of the box for YouTube without any server configuration.

- **New issue needed**: YouTube caption fetcher implementation (Tier 1). This is the highest-value, lowest-complexity piece and should be prioritized first.

---

## 2026-03-19: Hybrid extraction strategy for cross-platform media support (Issue #166)

**Context**: Synapse depends on `yt-dlp` and `ffmpeg` as external CLI tools that users must install themselves. This creates high onboarding friction (Homebrew/apt installs, PATH configuration, manual updates), makes the entire video transcription pipeline desktop-only (Obsidian Mobile has no `child_process` / shell access), and ties the plugin to a macOS-centric `shellEnv()` workaround that is fragile on Linux and Windows. Issue #166 asks how we might eliminate or reduce this external dependency burden, especially for mobile.

**Decision**: Adopt a hybrid extraction strategy (Option D) with three implementation phases:

1. **Abstract the extraction interface** -- Refactor `AudioExtractor` into a strategy interface (`MediaExtractor`) with `extractAudioFromUrl(url)`, `extractAudioFromFile(path)`, `downloadVideo(url)`, and `checkAvailability()` methods. Implement `LocalExtractor` (wraps existing yt-dlp/ffmpeg `execFile` logic) and `ServerExtractor` (calls a cloud endpoint).

2. **Server-side extraction endpoint** -- Deploy a cloud function (AWS Lambda preferred over Cloudflare Workers due to Lambda's higher memory ceiling of 10GB, 900-second timeout, and ability to run yt-dlp as a Lambda layer) that accepts a URL and returns extracted audio. The endpoint is opt-in, user-configurable, and self-hostable. No Synapse-operated default instance ships initially -- users must provide their own endpoint URL or use a community-hosted instance.

3. **Platform-aware strategy selection** -- On desktop (`Platform.isDesktopApp`), default to `LocalExtractor` with fallback to `ServerExtractor` if local tools are missing. On mobile (`Platform.isMobileApp`), use `ServerExtractor` exclusively. A settings override lets users force either strategy on any platform.

**Alternatives considered**:

- **Option A -- WASM-based media processing (ffmpeg.wasm)**: Rejected as a primary strategy. ffmpeg.wasm can transcode local audio/video files but cannot replace yt-dlp's URL downloading capability -- it has no network fetching, site-specific extraction logic, or DRM handling. The core WASM binary is approximately 25MB (custom builds can reduce to ~5MB but lose codecs), which would nearly double Synapse's bundle size. The 2GB WebAssembly memory hard limit constrains file processing. Multi-threaded mode requires SharedArrayBuffer with cross-origin isolation headers (`COOP`/`COEP`), which Obsidian's Electron renderer does not set by default and which conflict with loading cross-origin resources. On mobile, Obsidian uses WKWebView (iOS) and Android WebView via Capacitor -- both support WASM execution in principle, but SharedArrayBuffer availability and Worker thread support in these embedded WebViews is inconsistent and unverified in Obsidian's specific build. Furthermore, ffmpeg.wasm officially dropped Node.js support as of v0.12.0, making it purely browser-targeted. For an Electron app that already has native `child_process` access, native ffmpeg via `execFile` is faster, more capable, and uses less memory. ffmpeg.wasm remains viable as a future local-file-only fallback for mobile if server extraction is unavailable, but this is a stretch goal, not a primary path.

- **Option B -- Server-side extraction only**: Rejected as the sole strategy. Moving all extraction to a cloud service conflicts with Synapse's privacy-first philosophy (user URLs and potentially copyrighted content would transit an external server) and the zero-runtime-deps policy (creates a hard service dependency). It also introduces cost questions (who pays for Lambda compute?), latency (cold starts, large file transfers), and reliability concerns (service outages block all transcription). However, server-side extraction is the only viable path for mobile, so it is incorporated as the mobile leg of the hybrid approach with explicit opt-in and self-hosting support.

- **Option C -- Platform-native APIs**: Rejected. The Web Audio API is a DSP toolkit for processing audio that is already loaded in memory -- it cannot fetch media from URLs, does not understand video container formats, and has no site-specific extraction logic. Obsidian Mobile runs in a Capacitor WebView but does not expose native media framework bridges (iOS AVFoundation, Android MediaCodec) to plugins. Obsidian's plugin API provides `Platform.isDesktopApp`, `Platform.isMobileApp`, `Platform.isIosApp`, `Platform.isAndroidApp`, vault filesystem operations, and `requestUrl` for HTTP -- but no Capacitor plugin bridge for native media processing. Writing custom Capacitor plugins would require forking Obsidian's mobile app, which is not open source. There is no viable path here for URL-based media extraction.

**Rationale**: The hybrid approach is pragmatic and incremental. It preserves the working desktop pipeline (no regression), unlocks mobile support through server-side extraction (the only technically viable mobile path), and creates a clean abstraction that accommodates future extraction backends (community services like cobalt.tools, future WASM improvements, or native Obsidian media APIs if they emerge). The strategy interface also improves testability -- `ServerExtractor` and `LocalExtractor` can be independently mocked and tested. The self-host-first server model avoids creating a Synapse-operated service dependency while still enabling the feature.

**Impact**:
- `AudioExtractor` class refactored into `MediaExtractor` interface + `LocalExtractor` + `ServerExtractor` implementations
- New settings: `video.extractionStrategy` (`auto` | `local` | `server`), `video.serverEndpoint` (URL), `video.serverApiKey` (optional auth)
- `VideoModule` constructor accepts a `MediaExtractor` instead of creating `AudioExtractor` directly
- Mobile users gain access to video transcription features (previously completely gated behind `Platform.isDesktop`)
- Three follow-up implementation issues created for v0.7.0 milestone
- No changes to the audio transcription pipeline (Whisper API) -- only the media fetching/extraction layer is affected

---

## 2026-03-19: Image OCR module with multi-modal AIClient (Issues #162, #165)

**Context**: Users embed images (screenshots, diagrams, handwritten notes) in their vault notes. These images contain text and context that is invisible to AI-powered features — elaboration, enrichment, and summarization all operate on text content only.

**Decision**: Add a dedicated `image` module (`src/image/`) for OCR text extraction using vision models, and extend `AIClient.chat()` to support multi-modal content:

1. **Multi-modal AIClient**: `ChatMessage.content` accepts `string | ContentBlock[]` where `ContentBlock` is either `TextContentBlock` or `ImageContentBlock`. Provider-specific format conversion handles OpenAI (`image_url` with data URI), Anthropic (`image` source with base64), and Ollama (separate `images` array).

2. **ImageExtractor**: Reads image binary from vault, converts to base64, sends to vision model via `AIClient.chat()` with "OCR assistant" system prompt. Results wrapped in `[!synapse-ocr]` callouts.

3. **ImageModule**: Follows standard FeatureModule contract with `CheckpointManager` support. Batch extraction processes embeds in reverse line order with 2-second delay between API calls to avoid rate limits.

4. **Vision model override**: `settings.image.visionModel` temporarily overrides `settings.ai.model` for the duration of vision API calls, then restores the original.

**Alternatives considered**:
- Dedicated OCR library (adds runtime dependency, violates zero-deps policy)
- Always use the primary AI model for vision (some models lack vision capability)
- Process images client-side without AI (limited OCR quality)

**Rationale**: Vision models (GPT-4o, Claude) already excel at OCR and image understanding. Using the existing `AIClient` with multi-modal extensions avoids new dependencies while leveraging provider-native vision support. The model override pattern lets users choose a vision-capable model independently of their text model.

**Impact**: New `src/image/` module with 6 files. `AIClient` gains `ContentBlock` support across all three providers. `synapse-ocr` callout type added. Image OCR accessible via `NoteMediaModal` (transcription UI) or direct API.

---

## 2026-03-19: Image analysis enriches elaboration proposals (Issues #163, #167)

**Context**: When generating elaboration proposals for stub notes, the AI only sees the note's text content. Images embedded in the note (screenshots, diagrams, photos) often contain crucial context — a photo of a location, a diagram of an architecture, handwritten meeting notes — that should inform the proposal.

**Decision**: Add `ImageAnalyzer` to the elaboration module that uses multi-modal `AIClient.chat()` to analyze up to 5 embedded images per note before proposal generation:

- Finds both wiki-link (`![[image.png]]`) and markdown (`![alt](path)`) image references
- Skips external URLs (only vault images analyzed)
- Produces `ImageAnalysis` objects with description, location hints, and metadata clues
- Image analysis context is injected into the proposal generation prompt
- Graceful degradation: individual image failures are skipped without blocking the proposal

**Alternatives considered**:
- Analyze images only in the image module, not during elaboration (misses contextual value)
- Always analyze all images without cap (token overflow risk on image-heavy notes)
- Use OCR text extraction instead of image analysis (loses visual context like layout, colors, spatial relationships)

**Rationale**: A stub note with a photo of a mountain and the text "Trip notes" should produce proposals about a hiking trip, not generic travel content. Image analysis provides semantic understanding beyond OCR — it can describe what's in a photo, read a diagram's structure, or identify a location from visual cues. The 5-image cap prevents token explosion while covering most real-world notes.

**Impact**: Elaboration proposals are more contextually relevant for notes containing images. Uses the same `image.visionModel` override pattern as the image module.

---

## 2026-03-19: Preserve image embeds in AI-generated content (Issue #161)

**Context**: When AI models process note content containing image embeds (`![[photo.png]]` or `![alt](url)`), they sometimes strip or mangle the embed syntax. Image references in the original note would be lost after elaboration or tidy operations.

**Decision**: Sanitize AI responses to preserve image embed syntax. Both external URL embeds (`![alt](https://...)`) and internal wiki-links (`![[image.png]]`) are protected during response processing.

**Alternatives considered**:
- Strip all images from AI input and re-inject after (complex, loses contextual placement)
- Post-process AI output to restore images from original (fragile, depends on position matching)

**Rationale**: Preserving embeds inline is simpler and more robust than stripping and re-injecting. AI models generally handle the syntax well; the sanitizer just needs to avoid removing it.

**Impact**: Image embeds survive elaboration, tidy, and other AI-powered transformations.

---

## 2026-03-19: Proper resource cleanup on plugin unload (Issue #170)

**Context**: The plugin registered `setTimeout` handles and injected custom CSS styles (for notifications) during operation but did not clean them up when the plugin was unloaded. This caused stale timers firing after reload and orphaned `<style>` elements accumulating in the DOM.

**Decision**: Track all `setTimeout` handles and injected `<style>` elements, and clean them up in `onunload()`. Specifically:
- `NotificationManager` removes its injected `<style>` element
- `main.ts` clears the delayed checkpoint check timer
- All modules properly clean up on `onunload()`

**Alternatives considered**:
- Ignore cleanup (works but accumulates DOM garbage across reloads)
- Use Obsidian's `registerInterval()` for all timers (doesn't cover one-shot `setTimeout`)

**Rationale**: Clean unload is essential for plugin development (frequent reloads) and for Obsidian stability. Leaked timers can cause errors when callbacks fire against a destroyed plugin instance.

**Impact**: No more stale timers or orphaned styles after plugin unload/reload.

---

## 2026-03-19: Migrate settings headings to setHeading() API (Issue #171)

**Context**: The settings tab used `containerEl.createEl('h2', ...)` to render section headings. Obsidian's `Setting` API provides `setHeading()` which integrates better with the settings UI (proper indentation, collapsible sections in future).

**Decision**: Replace all `createEl('h2', ...)` and `createEl('h3', ...)` calls in `settings-tab.ts` with `new Setting(containerEl).setName('...').setHeading()`.

**Alternatives considered**:
- Keep `createEl` (works but inconsistent with Obsidian API best practices)

**Rationale**: `setHeading()` is the idiomatic Obsidian approach for settings section headers. It ensures consistent styling and forward-compatibility with future Obsidian settings UI improvements.

**Impact**: Visual appearance unchanged. Settings tab code follows Obsidian API conventions.

---

## 2026-03-18: Title proposal module for untitled and mismatched notes (Issue #150)

**Context**: After elaboration, transcription, or summarization, notes often retain their original filename (e.g., "Untitled", "Untitled 2") or have titles that no longer match their content. Users had to manually rename files.

**Decision**: Add a `title` module that detects two conditions and proposes AI-generated titles:
- **Untitled detection**: filenames matching `Untitled*` pattern trigger `suggestTitle()` via AI
- **Content-mismatch detection**: AI evaluates whether the current filename reflects the note's content; if not, it proposes a better title

Title checks are wired as cross-module callbacks in `main.ts`, triggered after enrichment (or directly after elaboration/transcription/summarization/deep-dive when enrichment is disabled). Proposals appear in the unified sidebar with yellow color coding. Accepting a title proposal renames the file.

The module does NOT use CheckpointManager (single-note operations, not vault scans).

**Alternatives considered**:
- Auto-rename without proposal (risky -- changes file paths, breaks links)
- Only detect untitled notes (misses content drift after elaboration)
- Batch title check during vault scan (over-engineered for a per-note operation)

**Rationale**: Title proposals fit naturally into the existing proposal-review workflow. The two-trigger design catches both obvious cases (Untitled) and subtle ones (content evolved past the original title). File rename is a high-impact action that warrants user confirmation via the sidebar.

**Impact**: New `src/title/` module with 5 files. Unified sidebar gains a 5th proposal type (yellow cards). Title settings added under `settings.title`. Cross-module callbacks in `main.ts` expanded.

---

## 2026-03-18: Content-aware summary templates with recipe detection (Issue #145)

**Context**: The summarize module treated all URL content identically, producing bullet-point or paragraph summaries. Recipe pages contain structured data (ingredients, steps, prep time) that generic summaries lose.

**Decision**: Add content-type detection to the summarize pipeline:
1. `content-fetcher.ts` extracts JSON-LD structured data from fetched HTML (Recipe, Article, etc.)
2. `summarizer.ts` detects content type and selects a specialized template
3. Recipe template: amalgamates ingredients from multiple JSON-LD entries, requires exact amounts, includes step images
4. Default template: existing bullets/paragraph/key-points behavior

Subsequent PRs refined this: exact ingredient amounts required (#149), step images included (#149), JSON-LD recipe data extraction to amalgamate ingredients across multiple Recipe objects (#153).

**Alternatives considered**:
- Always use generic summarization (loses structured data)
- Hard-code recipe detection only (not extensible to other content types)
- Use a separate command for recipe summarization (fragments UX)

**Rationale**: JSON-LD is a widely-used standard on recipe sites. Extracting structured data produces dramatically better summaries than feeding raw HTML to an LLM. The template system is extensible -- future content types (articles, products) can be added without changing the pipeline.

**Impact**: Recipe URLs produce structured summaries with exact ingredients and steps. The `autoDetectTemplates` setting controls this behavior. Non-recipe URLs are unaffected.

---

## 2026-03-18: TikTok URL normalization (Issue #155)

**Context**: TikTok URLs often include query parameters (tracking, session tokens) that cause the same video to be treated as different URLs. This led to duplicate transcription attempts and failed deduplication.

**Decision**: Strip query parameters from TikTok URLs during normalization in `url-detector.ts`. The canonical URL form is `https://www.tiktok.com/@user/video/{id}` with no query string.

**Alternatives considered**:
- Strip query params from all URLs (would break YouTube timestamp URLs)
- Normalize at transcription time only (wouldn't fix detection/matching)

**Rationale**: TikTok query params are purely tracking/session data -- they don't affect video content. YouTube params (like `t=` for timestamp) are meaningful, so normalization must be platform-specific.

**Impact**: TikTok URLs are consistently matched regardless of tracking parameters. No behavior change for YouTube URLs.

---

## 2026-03-18: Unified sidebar expanded to 5 proposal types

**Context**: The title module added a 5th proposal type to the unified sidebar (previously elaboration, enrichment, organize, deep-dive).

**Decision**: Extend `UnifiedItem` to a 5-way discriminated union adding `{ kind: 'title'; data: TitleProposal }`. Title cards show current vs proposed title, trigger reason (untitled/mismatch), and AI reasoning. Yellow color coding distinguishes them from other types. Accept triggers file rename.

**Alternatives considered**:
- Separate modal for title proposals (inconsistent with existing proposal workflow)
- Auto-apply title changes without review (too risky -- renames affect links)

**Rationale**: Consistency with the existing proposal-review pattern. Users already check the sidebar for proposals; title suggestions appear alongside other proposal types naturally.

**Impact**: `UnifiedViewCallbacks` gains `onTitleAccept` and `onTitleReject`. Card type table now has 5 entries (blue, green, orange, purple, yellow).

---

## 2026-03-18: Reject All button for proposals (Issue #141)

**Context**: Users with many pending proposals had to reject them one at a time. The existing Accept All button had no counterpart for bulk rejection.

**Decision**: Add a "Reject All" button to the unified sidebar, visible when 2+ proposals are pending. Processes all proposals sequentially, same as Accept All.

**Alternatives considered**:
- Only provide individual reject buttons (tedious for large batches)
- Add a "Clear All" that deletes proposals without marking them rejected (loses audit trail)

**Rationale**: Symmetric with Accept All. Users who scan proposals and find them unhelpful shouldn't need to reject each one individually.

**Impact**: New button in the unified sidebar header. All proposal types support rejection through their existing reject callbacks.

---

## 2026-03-18: Rebrand from Auto Notes to Synapse (Issue #124)

**Context**: The plugin name "Auto Notes" was generic and didn't convey the plugin's purpose of connecting knowledge through AI. A more distinctive name was needed as the project matured toward public release.

**Decision**: Rename the plugin from "Auto Notes" to "Synapse" across all code, configuration, and documentation:
- Manifest: `id: "synapse"`, `name: "Synapse"`
- Plugin class: `AutoNotesPlugin` → `SynapsePlugin`
- Settings type: `AutoNotesSettings` → `SynapseSettings`
- Data folder: `.auto-notes/` → `.synapse/`
- Callout types: `auto-notes-*` → `synapse-*`
- All user-facing strings and command prefixes

A one-time data folder migration runs on load: if `.auto-notes/` exists and `.synapse/` does not, the old folder is renamed. If both exist, a warning is logged and the user must merge manually. The legacy `.auto-notes/` folder is added to `.gitignore`.

**Alternatives considered**:
- Keep "Auto Notes" (too generic, likely name collisions with other plugins)
- Use a migration plugin or manual instructions (more friction for existing users)
- Support both names indefinitely (maintenance burden, confusing code)

**Rationale**: "Synapse" evokes neural connections, fitting for a plugin that builds knowledge graphs. The automatic migration ensures existing users don't lose data. The clean break (no dual-name support) keeps the codebase simple.

**Impact**: All references to "Auto Notes" are historical. Existing users with `.auto-notes/` data folders are migrated automatically. Callout CSS selectors changed (users with custom CSS for `auto-notes-*` callouts need to update).

---

## 2026-03-18: Shared CheckpointManager singleton (Issue #47)

**Context**: Long-running operations (vault-wide scans, batch transcriptions) could be interrupted by plugin reload or Obsidian restart, losing all progress. Each module could create its own checkpoint manager, but that would mean duplicated storage and inconsistent UX.

**Decision**: Create a single `CheckpointManager` in `main.ts` and inject it into all modules via constructor. The checkpoint manager:
- Stores checkpoints as JSON in `.synapse/checkpoints/`
- Tracks `completedItems` and `remainingItems` per operation
- Supports `resume()` to return remaining work and `discard()` to abandon
- Fires deferred tasks (e.g., sidebar refresh) on completion
- Uses per-checkpoint write mutex to prevent concurrent read-modify-write corruption

On startup (delayed 3 seconds), `main.ts` checks for incomplete checkpoints and offers the user Resume/Dismiss options. The unified sidebar shows a banner for any incomplete checkpoints.

**Alternatives considered**:
- Per-module checkpoint managers (duplicated code, inconsistent storage)
- No checkpoint support, restart from scratch (poor UX for expensive operations)
- Obsidian's `loadData`/`saveData` for state (doesn't support per-operation granularity)

**Rationale**: A single shared manager ensures consistent storage, UI integration, and lifecycle management. Constructor injection makes the dependency explicit and testable. The delayed startup check avoids blocking plugin load.

**Impact**: All feature modules accept `CheckpointManager` as a constructor parameter. Each module implements `resumeFromCheckpoint(checkpoint)`. The `synapse:manage-checkpoints` command provides manual access to interrupted operations.

---

## 2026-03-17: Unified transcription — 6 commands to 2 + 1 utility (Issue #20)

**Context**: Audio and video modules each had their own modal classes for transcription: `TranscriptionModal` and `NoteAudioModal` in `src/audio/`, `VideoModal` and `NoteVideoModal` in `src/video/`. This meant 6 separate transcription commands, 4 modal classes, and duplicated UI patterns across two modules.

**Decision**: Consolidate into a new `src/transcription/` module with two modal classes:
- **UnifiedTranscriptionModal** — combines audio file picker and video URL input in a single modal (replaces `TranscriptionModal` + `VideoModal`)
- **NoteMediaModal** — scans the current note for both audio embeds and video URLs, presents a unified selection UI (replaces `NoteAudioModal` + `NoteVideoModal`)

Reduce to 2 unified commands + 1 utility:
- `synapse:transcribe-media` — opens UnifiedTranscriptionModal
- `synapse:transcribe-note-media` — opens NoteMediaModal for the current note
- `synapse:check-dependencies` — checks yt-dlp/ffmpeg availability (retained from video module)

The transcription module is UI-only; it delegates all work to AudioModule and VideoModule via callbacks wired in `main.ts`. AudioModule and VideoModule expose new public methods (`transcribeFileToActiveNote`, `transcribeUrlToActiveNote`, `transcribeAndInsert`) for the unified orchestration.

Settings tab reorganized with a "Media Transcription" parent heading grouping both audio and video settings.

**Alternatives considered**:
- Keep separate commands with a "smart" command that auto-detects media type (still requires two modal implementations)
- Merge Audio and Video modules entirely (too much coupling; they have independent provider configurations and different external dependencies)
- Add transcription UI to each module's own modal but share via inheritance (fragile, tight coupling between UI classes)

**Rationale**: Users think in terms of "transcribe this media" — not "is this audio or video?" The unified modal handles both media types with a single entry point. Keeping AudioModule and VideoModule as separate backend modules preserves clean separation of concerns (different providers, different external tools). The transcription module acts as a thin UI layer that delegates to the right backend.

**Impact**:
- 4 modal files deleted (`audio/transcription-modal.ts`, `audio/note-audio-modal.ts`, `video/video-modal.ts`, `video/note-video-modal.ts`)
- 3 new files in `src/transcription/` (unified-modal.ts, note-media-modal.ts, index.ts)
- Command count reduced from ~25 to 21
- Single ribbon icon (`mic`) for all transcription
- Audio and video modules no longer register their own commands (except `check-dependencies`)

---

## 2026-03-16: Deep-dive generate-all-upfront model

**Context**: When a user triggers a deep dive, the system needs to decide whether to generate child notes one at a time (with user approval between each) or generate the entire tree upfront and let the user accept/reject afterward.

**Decision**: Generate the entire proposal tree upfront in a single BFS traversal, store all proposals, and present them in the unified sidebar for batch review. The user confirms once before generation starts, then reviews all proposals afterward.

**Alternatives considered**:
- Interactive step-by-step generation (user approves each level before proceeding -- more control but slow and tedious for large trees)
- Background generation with streaming UI updates (complex, hard to cancel cleanly)
- Generate only depth 0, let user trigger deeper dives manually (safe but loses the recursive discovery value)

**Rationale**: Upfront generation minimizes user friction. A deep dive into a note with 5 topics at depth 3 could produce 15-50 proposals -- asking for approval at each step would be exhausting. The BFS queue processes topics breadth-first, so proposals at depth 0 are ready for review while deeper levels are still generating. The single confirmation gate before generation prevents accidental API costs.

**Impact**: Users get a complete proposal tree to browse. They can accept individual notes or reject branches (cascade rejection removes children too). Progress tracking and cancellation are available during generation.

---

## 2026-03-16: Local heuristic quality scorer (no AI)

**Context**: The deep-dive module needs to decide when to stop recursing. A topic at depth 2 that produces thin, generic content shouldn't spawn more children.

**Decision**: Use a local heuristic scorer (`quality-scorer.ts`) with five weighted factors -- no AI call for scoring:
- Topic count (0.3): `min(1.0, childTopics / 3)`
- Word count (0.2): `min(1.0, wordCount / 200)`
- Generic penalty (0.2): penalizes 1-word titles or common words ("introduction", "overview", etc.)
- Overlap penalty (0.2): fraction of child topics already in ancestor list
- Depth decay (0.1): `1.0 - (depth / maxDepth * 0.5)`

Score below `qualityThreshold` (default 0.4) stops recursion for that branch.

**Alternatives considered**:
- AI-based quality assessment (adds an API call per proposal; doubles cost for marginal benefit)
- Fixed depth limit only (doesn't account for content quality; wastes API calls on thin branches)
- User-defined per-topic stop/continue (too interactive for upfront generation model)

**Rationale**: Local heuristics are free, fast, and surprisingly effective. The overlap penalty catches circular topics. The generic penalty avoids wasting API calls on "Introduction to X" or "Overview" notes that won't have rich subtopics. Word count correlates with generation quality. The configurable threshold lets users tune aggressiveness.

**Impact**: Deep dives terminate branches early when quality drops, saving API costs. The `earlyTerminations` stat in run metadata shows how many branches were pruned.

---

## 2026-03-16: Cascade rejection for deep-dive proposals

**Context**: Deep-dive proposals form a tree. When a user rejects a depth-0 proposal, its children (depth 1, 2, ...) become orphaned -- they reference a parent note that will never exist.

**Decision**: Rejecting a proposal automatically rejects all its descendants. The `DeepDiveStore.cascadeReject(id)` method walks the `childProposalIds` tree and marks all as rejected. The UI shows a count: "Rejected 5 proposals (including children)."

**Alternatives considered**:
- Reject only the selected proposal, leave children pending (orphaned proposals confuse users)
- Delete children entirely (loses the record for run statistics)
- Ask user per child whether to keep or reject (too much friction)

**Rationale**: An orphaned child proposal makes no sense -- it would create a note about a subtopic of a note that doesn't exist. Cascade rejection is the only consistent behavior. Keeping rejected proposals (rather than deleting) preserves run statistics for debugging quality thresholds.

**Impact**: Users can prune entire subtrees with a single reject. The run's proposal count and depth stats remain accurate.

---

## 2026-03-16: Deep-dive auto-enrich and auto-organize on accept

**Context**: When a user accepts a deep-dive proposal, the new note is created bare -- no tags, no links, no enrichment. Users would need to manually trigger enrichment and organize on each accepted note.

**Decision**: Add two opt-in callbacks:
- `autoEnrichOnAccept` (default: true): triggers `enrichment.enrich(filePath, 'deep-dive')` after note creation
- `autoOrganizeOnAccept` (default: false): triggers `organize.organizeNote(file)` after note creation

Both are wired in `main.ts` only when the corresponding modules are enabled.

**Alternatives considered**:
- Always enrich and organize (opinionated, hard to disable)
- Never auto-trigger (requires manual commands on every accepted note)
- Batch enrich/organize all accepted notes at once (complex, timing issues)

**Rationale**: Enrichment is low-risk and high-value -- newly generated notes benefit from tags and links immediately. Organize is off by default because moving a just-created note before the user has reviewed it can be surprising. Both are configurable per user preference.

**Impact**: Accepted deep-dive notes are automatically connected to the vault graph. Organize can be enabled for users who want fully automated file management.

---

## 2026-03-16: Organize module uses dual action model (move vs propose)

**Context**: The organize module analyzes note content and determines the best directory. Sometimes the best directory already exists; sometimes a new directory needs to be created.

**Decision**: Two action types:
- **move**: if the AI recommends an existing directory, move the note immediately with a snapshot for undo
- **propose-new-directory**: if a new directory is needed, create a proposal for user review in the sidebar

**Alternatives considered**:
- Always propose (too much friction for obvious moves to existing directories)
- Always move, create directories automatically (risky -- bad AI suggestions create folder clutter)
- Only move to existing directories, never suggest new ones (limits organization growth)

**Rationale**: Existing directories are user-validated locations. Moving to them is safe and reversible (via snapshot/undo). New directories deserve user confirmation because they change vault structure permanently. This split gives users speed where it's safe and control where it matters.

**Impact**: Most organizes are instant moves. Only novel directory suggestions require sidebar review.

---

## 2026-03-16: Summarize module creates standalone notes for enrichment-section links

**Context**: The summarize module handles two contexts: inline URLs/transcriptions in the note body, and external reference links added by enrichment (in the `## References` section). Inline summaries are simple blockquotes. But enrichment-section links are references to external resources -- summarizing them inline would clutter the references section.

**Decision**: When summarizing a URL in the enrichment section:
1. Fetch and summarize the content with a comprehensive prompt
2. Create a standalone summary note (new file in vault)
3. Replace the external `[title](url)` link with an internal `[[Summary - title]]` link in the source note

When summarizing outside the enrichment section, insert a blockquote summary inline after the URL.

**Alternatives considered**:
- Always inline (clutters enrichment sections)
- Always create standalone notes (overkill for simple URL summaries in note body)
- Never summarize enrichment links (misses opportunity to bring external knowledge into the graph)

**Rationale**: Enrichment-section links represent curated references. Converting them to internal notes with full summaries strengthens the knowledge graph. The external URL is preserved in the summary note, so no information is lost. Inline summaries are more appropriate for casual URL mentions in the note body.

**Impact**: Users can "internalize" their external references into vault notes. The original reference link is replaced with an internal link, keeping the references section clean.

---

## 2026-03-16: Unified view expanded to 4 proposal types with color coding

**Context**: The unified proposal view originally supported elaboration and enrichment. The organize and deep-dive modules added two new proposal types that needed review UI.

**Decision**: Extend `UnifiedItem` to a 4-way discriminated union: `elaboration | enrichment | organize | deep-dive`. Each type gets a distinct color (blue, green, orange, purple) and a specialized review pane:
- Organize: shows proposed directory, AI reasoning, accept/reject
- Deep-dive: shows topic title, depth badge, quality score, content preview, child count warning, accept/reject

**Alternatives considered**:
- Separate views per module (fragmented UX, already rejected this once)
- Tabs within the sidebar (adds navigation overhead)
- Only show deep-dive in a modal (inconsistent with other proposal types)

**Rationale**: Consistency -- all proposal types use the same browse-and-review workflow. Color coding provides instant visual differentiation. The deep-dive review pane is read-only (unlike elaboration's editable textarea) because generated notes are complete and shouldn't be hand-edited before acceptance.

**Impact**: One sidebar, four proposal types, four colors. Users have a single place to manage all pending proposals.

---

## 2026-03-13: On-demand folder creation in stores

**Context**: Store classes (ProposalStore, EnrichmentStore, TidyStore) relied on an `init()` call during plugin startup to create their storage folders. If the folder was deleted while the plugin was running, subsequent saves would fail.

**Decision**: Add `await ensureFolder(this.app, this.folderPath)` at the top of every `save()` method, in addition to the existing `init()` call. The `ensureFolder` function in `shared/file-utils.ts` handles the race condition where a folder exists on disk but not in the vault cache.

**Alternatives considered**:
- Rely solely on `init()` (fails if folder deleted mid-session)
- Create folder lazily on first save only, remove `init()` (startup validation is still useful)

**Rationale**: Belt-and-suspenders approach. The `init()` call catches configuration errors early (bad path, permissions); the `save()` call handles runtime deletion. `ensureFolder` is idempotent and cheap.

**Impact**: Stores are resilient to folder deletion during plugin runtime. No behavior change for normal usage.

---

## 2026-03-13: Git workflow -- protected main, feature branches, bot identity

**Context**: The project was growing beyond solo development. Multiple agents (human and AI) needed to contribute without stepping on each other's work or breaking main.

**Decision**: Establish a formal git workflow:
- **Protected main**: never push directly; all changes via pull requests
- **Feature branches**: `feat/`, `fix/`, `refactor/`, `chore/` prefixes
- **Bot identity**: all git operations use `bot@wafflenet.io` / `bot` (never personal identities)
- **Co-authored commits**: `Co-Authored-By: Claude <bot@wafflenet.io>` trailer
- **Pre-flight checklist**: type-check, test, build before pushing
- **Worktrees**: for parallel work on conflicting files

**Alternatives considered**:
- Trunk-based development (risky without CI/CD gate)
- Personal identity for commits (confuses authorship tracking)
- No formal workflow (works solo, breaks with multiple contributors)

**Rationale**: Protected main prevents accidental breakage. Feature branches isolate work-in-progress. The bot identity creates a clear audit trail distinguishing automated from manual commits. Worktrees enable parallel agent work without branch switching.

**Impact**: All contributors follow the same workflow. PRs are the only path to main. The git-workflow skill (`/.claude/skills/git-workflow/SKILL.md`) documents the full protocol.

---

## 2026-03-13: Teams infrastructure for multi-agent coordination

**Context**: The project uses multiple specialized AI agents (architect, security, docs, elaboration-designer, transcription-engineer). These agents need clear role boundaries, shared skills, and coordination mechanisms.

**Decision**: Create a teams infrastructure under `.claude/agents/` with dedicated agent definition files. Each agent has:
- A name and description
- A list of skills they can use
- A list of allowed tools
- Clear responsibility boundaries

**Alternatives considered**:
- Single monolithic agent (loses specialization benefits)
- Ad-hoc agent instructions (inconsistent, hard to maintain)
- External coordination tool (adds complexity, another dependency)

**Rationale**: Explicit agent definitions prevent role confusion and scope creep. Skills are shared (any agent can use `git-workflow`), but responsibilities are distinct (only `security` audits for vulnerabilities). The file-based approach is version-controlled and easy to extend.

**Impact**: Seven agents defined: architect, security, docs-agent, docs-human, elaboration-designer, plugin-architect, transcription-engineer. Adding a new agent means creating a new `.md` file in `.claude/agents/`.

---

## 2026-03-13: Enrichment redesign -- tags as metadata classifiers, topics as links

**Context**: The original enrichment module used a `TagScorer` that treated tags as topic labels (e.g., `#machine-learning`, `#python`). This conflicted with Obsidian best practices: tags work best as metadata classifiers (status, type, source), while topics belong as `[[internal links]]` in the knowledge graph.

**Decision**: Replace `TagScorer` with two new components:
- **MetadataClassifier** (`metadata-classifier.ts`): classifies notes using a user-defined tag vocabulary. Tags are rare, purposeful metadata (e.g., `#draft`, `#reference`, `#meeting-notes`). AI classifications are validated against the vocabulary -- hallucinated tags are rejected.
- **TopicExtractor** (`topic-extractor.ts`): extracts key concepts from note content and converts them to `[[internal link]]` candidates. Matched topics (existing vault notes) become link suggestions immediately. Unmatched topics are accumulated for cross-note resolution.

**Alternatives considered**:
- Keep TagScorer with frequency + proximity weighting (treats tags as topics, against Obsidian conventions)
- Tags only, no topic extraction (misses link graph opportunities)
- AI-only link suggestions without vault matching (ignores existing knowledge graph)

**Rationale**: This aligns with the Obsidian community consensus: tags are for classification/filtering, links are for building a knowledge graph. A user who searches `#draft` expects to find incomplete notes, not every note mentioning "drafts." Topic extraction surfaces the concepts that should be linked, not tagged.

**Impact**: The `TagVocabularyEntry` setting defines allowed tag categories. Users control exactly which tags the system can suggest. Topics become link candidates, enriching the knowledge graph. The old `TagScorer` class no longer exists.

---

## 2026-03-13: New-note suggestions require 2+ independent references

**Context**: During vault-wide enrichment scans, the `TopicExtractor` identifies topics that do not match any existing vault note. These could be suggested as "create this new note" candidates. However, a single AI mention of a topic is weak evidence -- it might be noise.

**Decision**: Only promote an unmatched topic to a new-note suggestion when 2 or more notes independently reference the same topic. The `TopicExtractor` accumulates unmatched topics in a `pendingNewTopics` map during the scan, then `resolveNewNoteCandidates()` filters for multi-reference topics in Phase 4.

**Alternatives considered**:
- Suggest new notes for any unmatched topic (too noisy, creates clutter)
- Require 3+ references (too conservative, misses genuine connections)
- Never suggest new notes (misses knowledge graph growth opportunities)
- Human threshold setting (adds settings complexity for marginal benefit)

**Rationale**: Two independent notes surfacing the same concept is strong evidence of a genuine hub topic worth creating. Single mentions are often contextual noise or AI hallucination. The 2-note threshold balances signal quality against discovery.

**Impact**: Vault scans produce fewer but higher-quality new-note suggestions. Single-note enrichment never suggests new notes (no cross-note evidence available).

---

## 2026-03-13: Proximity scoring weights lowered -- topical relevance dominates

**Context**: The original link scoring gave equal weight to folder proximity and topical relevance. This produced link suggestions biased toward nearby files even when topically unrelated.

**Decision**: Reduce proximity scoring multipliers in `LinkResolver`:
- Graph hop candidates: `proximity * 0.25` (was higher)
- Shared tag candidates: `proximity * sharedCount * 0.15` (was higher)
- Folder proximity candidates: `proximity * 0.15` (was higher)

In `mergeTopicCandidates()`, topic relevance dominates: graph proximity adds only `existing.score * 0.2` as a bonus when a candidate appears in both sources. Topic base score is 0.7; proximity contributes at most 0.2 * proximity.

**Alternatives considered**:
- Keep equal weighting (proximity bias overwhelms topical relevance)
- Remove proximity entirely (loses useful same-folder signal)
- User-configurable balance slider (adds UI complexity for a tuning parameter)

**Rationale**: Topic relevance is the primary signal -- a note about "React Hooks" should link to other React notes regardless of folder. Proximity is a tiebreaker, not a driver. The lowered weights ensure topically relevant notes in distant folders still surface.

**Impact**: Link suggestions are more topically relevant and less biased by folder structure. The `weights` settings still control proximity tiers, but their influence on final scores is reduced.

---

## 2026-03-13: Vault-wide enrichment scan with 4-phase flow

**Context**: Single-note enrichment worked well, but users needed a way to enrich their entire vault at once. A naive "loop over all files" approach would be expensive (many AI calls) and couldn't leverage cross-note evidence for new-note suggestions.

**Decision**: Implement a 4-phase vault scan in `EnrichmentModule.scanVault()`:
1. **Scan**: collect eligible files (respecting exclude rules), warm VaultAnalyzer caches
2. **Confirm**: user confirmation via NotificationManager (gates expensive AI calls)
3. **Generate**: per-file enrichment with progress tracking and cancellation. TopicExtractor accumulates unmatched topics across all files
4. **Resolve**: `TopicExtractor.resolveNewNoteCandidates()` -- topics referenced by 2+ notes become new-note link suggestions, injected into existing proposals via `LinkResolver.mergeTopicCandidates()`

On error or cancellation in Phase 3, all created proposals are rejected and pending topics are cleared.

**Alternatives considered**:
- Simple loop with per-note confirmation (too many dialogs)
- Background processing without confirmation (expensive surprise API bills)
- Batch AI calls for multiple notes at once (token limits, harder to cancel per-note)

**Rationale**: The 4-phase design separates cheap operations (scan) from expensive ones (AI calls), giving the user a gate before costs are incurred. Phase 4 is the key innovation: cross-note topic resolution can only happen after all notes have been processed, so it must be a separate post-processing step.

**Impact**: Users can enrich their entire vault with one command. The confirmation step prevents accidental API charges. Cross-note topic resolution produces new-note suggestions that single-note enrichment cannot.

---

## 2026-03-13: Tidy module uses immediate apply, no proposals

**Context**: The tidy feature (spelling/formatting correction) was being designed. Other modules (elaboration, enrichment) use a proposal-review workflow where changes are stored as JSON proposals and presented in a sidebar for user approval.

**Decision**: Tidy applies changes immediately to the note without a proposal step. A snapshot of the original content is saved to `.synapse/tidy-snapshots/` for undo capability.

**Alternatives considered**:
- Proposal workflow like elaboration/enrichment (adds friction for low-risk changes)
- Diff view showing before/after (complex UI for minimal benefit)
- No undo capability (risky if AI makes unwanted formatting changes)

**Rationale**: Tidy changes are cosmetic -- spelling fixes and markdown formatting only, no content addition or removal. The risk of unwanted changes is low, and the undo command provides a safety net. A full proposal workflow would slow down a feature that should feel instant. One snapshot per file (overwriting previous) keeps storage bounded.

**Impact**: Users run `Tidy current note` and see changes immediately. If unsatisfied, `Undo last tidy` restores the original content. No sidebar review needed.

---

## 2026-03-13: Unified proposal view replaces per-module sidebars

**Context**: Elaboration and enrichment each had their own sidebar view classes (`ProposalReviewView`, `EnrichmentReviewView`) and their own modals. Users had to navigate between separate UI surfaces to review different types of proposals.

**Decision**: Create a single `UnifiedProposalView` in `src/views/` that displays all proposal types in one sidebar. The view has multiple rendering modes: list (all proposals grouped by note), elaboration review (editable textarea), enrichment review (per-item checkboxes), organize review (directory + reasoning), and deep-dive review (topic + quality score + content preview). Legacy view classes remain in the codebase but are not registered by `main.ts`.

**Alternatives considered**:
- Keep separate views (fragmented UX, multiple ribbon icons needed)
- Tabbed view with one tab per module (added complexity)
- Modal-only workflow without sidebar (less persistent, harder to browse)

**Rationale**: A single sidebar reduces cognitive overhead -- users have one place to check for pending proposals. The `UnifiedItem` discriminated union keeps the data model clean. Color-coded cards (blue for elaboration, green for enrichment, orange for organize, purple for deep-dive) provide visual distinction without separate views.

**Impact**: One ribbon icon (sparkles) opens all proposals. Legacy views are dead code but preserved for reference. The view is refreshed via callbacks from all four proposal-generating modules through `main.refreshUnifiedView()`.

---

## 2026-03-13: Replace modals with inline review panes and clickable note links

**Context**: The initial proposal review flow used Obsidian `Modal` dialogs for viewing proposal details. Modals blocked interaction with the rest of the app and couldn't link back to source notes.

**Decision**: Replace modals with inline review panes within the unified sidebar view. Proposal headings are clickable links that open the source note in the main editor pane.

**Alternatives considered**:
- Keep modals (blocking, can't reference source note simultaneously)
- Open proposals in a new pane (too many panes)

**Rationale**: Inline review lets users see the proposal and the source note side by side. Clickable note links provide immediate navigation context. The sidebar persists while users navigate between notes.

**Impact**: Review workflow is non-blocking. Users can read the source note while deciding on a proposal.

---

## 2026-03-13: Centralized notification system with cancellation and two-phase vault scan

**Context**: Feature modules used ad-hoc `new Notice()` calls for progress reporting. Long-running operations (vault scans, batch transcriptions) had no cancellation mechanism, and there was no way to show progress or prevent duplicate operations.

**Decision**: Create `NotificationManager` in `src/shared/` providing:
- Tracked operations with animated status, progress counters, and cancel buttons
- Non-dismissible notices for running operations
- Confirmation snackbars (Proceed/Cancel) returning `Promise<boolean>`
- Status bar integration showing active operation count
- CSS injection for styled notices

Vault scanning uses a two-phase approach: Phase 1 scans without API calls, Phase 2 asks for confirmation before generating proposals (which costs API credits).

**Alternatives considered**:
- Per-module notification logic (duplicated, inconsistent)
- Obsidian's built-in `Notice` only (no cancellation, no progress, auto-dismisses)
- Custom status bar only without notices (not attention-getting enough)

**Rationale**: Centralized notifications ensure consistent UX across all modules. Cancellation is critical for operations that make paid API calls. The two-phase vault scan prevents accidental credit consumption when a scan finds many stub notes. All modules receive `NotificationManager` via constructor injection.

**Impact**: All modules use `NotificationManager` for user communication. Operations are cancellable via `handle.cancelled`. The confirmation snackbar gates expensive operations.

---

## 2026-03-13: Enrichment module with proximity-weighted tag scoring

**Context**: After notes are elaborated or transcribed, they lack connections to the rest of the vault -- no tags, no links to related notes, no external references.

**Decision**: Add an enrichment module that analyzes vault structure to suggest tags, internal links, external references, and frontmatter attributes. Tag scoring uses a proximity-weighted algorithm: candidate tags are scored by how often they appear in nearby notes (same folder > sibling > cousin > distant), combined with vault-wide frequency. Internal links are resolved from graph hops, shared tags, and folder proximity.

**Alternatives considered**:
- AI-only suggestions without vault context (ignores existing vault structure)
- Simple frequency-based tagging (doesn't account for note relationships)
- Manual tagging reminders (no automation)

**Rationale**: Proximity weighting produces tags that are contextually relevant to where the note lives in the vault hierarchy, not just globally popular tags. The pure function `computeProximityWeight()` is testable and configurable via six weight parameters. Combining AI suggestions with vault analysis produces better results than either alone.

**Impact**: Notes gain contextual tags and connections automatically. The enrichment runs after elaboration acceptance or transcription completion (when `autoEnrich` is enabled), or manually via command.

---

## 2026-03-13: Cross-module callbacks wired in main.ts

**Context**: When an elaboration proposal is accepted or a transcription completes, the resulting note should be enriched automatically. Modules need to communicate completion events without direct dependencies on each other.

**Decision**: Wire callbacks in `main.ts` using simple function assignments:
- `elaboration.onProposalAccepted(filePath)` -> `enrichment.enrich(filePath, 'elaboration')`
- `audio.onTranscriptionComplete(filePath)` -> `enrichment.enrich(filePath, 'transcription')`
- `video.onTranscriptionComplete(filePath)` -> `enrichment.enrich(filePath, 'transcription')`
- `summarize.onSummaryComplete(filePath)` -> `enrichment.enrich(filePath, 'summarization')`
- `deepDive.onNoteAccepted(filePath)` -> `enrichment.enrich(filePath, 'deep-dive')`
- `deepDive.onOrganizeRequested(file)` -> `organize.organizeNote(file)`
- `*.onViewRefreshNeeded()` -> `main.refreshUnifiedView()`

Callbacks are only wired when the relevant modules and settings are enabled.

**Alternatives considered**:
- Event bus / pub-sub pattern (over-engineered for <10 connections)
- Direct module imports (creates circular dependencies)
- Obsidian events on the workspace (global, hard to type-check)

**Rationale**: Simple callback assignment in the orchestrator (`main.ts`) is explicit and easy to trace. Each module declares nullable callback properties; `main.ts` assigns them. No event system overhead, no subscription management, no circular dependencies.

**Impact**: Enrichment runs automatically after elaboration, transcription, summarization, and deep-dive acceptance. Organize runs after deep-dive acceptance when enabled. View refresh is centralized. Adding new cross-module connections requires editing `main.ts`.

---

## 2026-03-13: Removed output folder settings from audio and video

**Context**: Audio and video modules originally had `outputFolder` settings specifying where transcription notes would be saved. These were redundant -- transcriptions are inserted inline into the current note (audio) or saved alongside video metadata (video).

**Decision**: Remove `audio.outputFolder` and `video.outputFolder` settings. Video retains `downloadFolder` (for saving video files to vault) and `embedInNote` (for embedding video file links in notes).

**Alternatives considered**:
- Keep output folders as optional settings (unused code, confusing settings)
- Add output folder support later if needed (YAGNI)

**Rationale**: Both modules insert content inline into existing notes rather than creating new files in an output folder. Keeping unused settings confuses users and adds maintenance burden.

**Impact**: Settings schema is simpler. Video `downloadFolder` and `embedInNote` remain for the video file download feature.

---

## 2026-03-13: AI response sanitization strategy

**Context**: AI providers (OpenAI, Anthropic, Ollama) return text that gets written directly into vault notes. Obsidian renders markdown, which means certain HTML constructs and URI schemes could execute code if injected.

**Decision**: `sanitizeAIResponse()` strips: `<script>` tags with content, HTML event handlers (`onclick`, `onerror`, etc.), dangerous URI schemes (`javascript:`, `data:`, `vbscript:`), and embedding tags (`<iframe>`, `<embed>`, `<object>`). Applied to all AI output before vault writes. The tidy module additionally strips code fences that AI sometimes wraps responses in.

**Alternatives considered**:
- Full HTML sanitizer library (adds runtime dependency, over-engineered for markdown context)
- No sanitization, trust AI providers (risky -- prompt injection is a real threat)
- Escape all HTML (breaks legitimate markdown rendering)

**Rationale**: Targeted stripping removes known dangerous patterns while preserving legitimate markdown and inline HTML that Obsidian renders safely. Defense-in-depth: even if AI output contains injected content, sanitization prevents execution. The pattern is applied consistently via a single shared function.

**Impact**: All AI-generated content is safe to render in Obsidian. Legitimate markdown formatting is preserved.

---

## 2026-03-13: Enrichment uses marker comments for idempotent updates

**Context**: Enrichment adds "Related Notes" and "References" sections to notes. If enrichment runs again on the same note (e.g., after re-elaboration), it needs to update these sections rather than duplicating them.

**Decision**: Wrap enrichment-added sections with HTML comment markers: `%% synapse-enrichment-start %%` and `%% synapse-enrichment-end %%`. On subsequent enrichments, content between markers is replaced. Undo removes everything between markers.

**Alternatives considered**:
- Heading-based detection only (fragile -- user might have a heading with the same name)
- Frontmatter flags (doesn't help with body content sections)
- Append-only without updates (causes duplication)

**Rationale**: Obsidian comment syntax (`%% ... %%`) is invisible in reading view but preserved in source. Markers provide reliable boundaries for idempotent section updates without depending on heading text matching.

**Impact**: Enrichment can safely re-run on the same note. Users don't see the markers in reading view. Undo cleanly removes only enrichment-added content.

---

## 2026-03-13: Frontmatter key validation with allowlist pattern and forbidden keys

**Context**: Enrichment suggests frontmatter attributes via AI. Without validation, AI could suggest keys that cause prototype pollution (`__proto__`, `constructor`) or overwrite Obsidian-reserved keys.

**Decision**: Validate frontmatter keys against pattern `^[a-z][a-z0-9_-]{0,49}$` and block a forbidden keys list (`__proto__`, `constructor`, `prototype`, etc.). Never overwrite existing frontmatter keys -- only add new ones.

**Alternatives considered**:
- No validation (prototype pollution risk)
- Strict allowlist of specific keys (too restrictive, can't adapt to vault conventions)
- Overwrite existing keys if AI suggests better values (data loss risk)

**Rationale**: The regex pattern is permissive enough for any reasonable frontmatter key while blocking injection vectors. The forbidden keys list catches the most dangerous prototype pollution keys. Never overwriting existing keys preserves user data.

**Impact**: AI-suggested frontmatter is safe to apply. Users keep their existing frontmatter values intact.

---

## 2026-03-12: TDD infrastructure with Vitest

**Context**: The project had no test framework despite having testable pure functions (URL detection, input validation) and injectable dependencies (AIClient, Transcriber). The codebase was growing and needed automated regression coverage.

**Decision**: Adopt Vitest 4.x as the test framework with the following infrastructure:
- `vitest.config.ts` at project root with globals enabled, node environment, and `src/**/*.test.ts` include pattern
- Centralized Obsidian mock at `src/__mocks__/obsidian.ts` with real class implementations for `TFile` and `TFolder` (so `instanceof` checks work in tests) and stubs for UI classes (`Modal`, `Plugin`, `Setting`, etc.)
- Setup file at `src/__test-utils__/setup.ts` that calls `vi.mock('obsidian')` globally
- Mock factories at `src/__test-utils__/mock-factories.ts` providing `mockFile()`, `createMockApp()`, `createMockPlugin()`, and `makeSettings()` helpers
- Test files co-located with source as `<name>.test.ts`
- Three npm scripts: `test` (single run), `test:watch`, `test:coverage`

**Alternatives considered**:
- Jest (heavier, slower startup, more configuration required for ESM/TypeScript)
- No tests, rely on manual QA (unsustainable as features grow)
- End-to-end tests with real Obsidian (fragile, slow, hard to automate)

**Rationale**: Vitest is fast, has native TypeScript and ESM support, and integrates well with the esbuild-based build pipeline. The centralized Obsidian mock means every test file automatically gets stubs for all Obsidian APIs without per-file setup. Real `TFile`/`TFolder` class implementations (instead of plain objects) ensure `instanceof` checks in production code work correctly in tests.

**Impact**: Tests can be run with `npm test`. The TDD skill (`/tdd`) guides the Red-Green-Refactor workflow for new features.

---

## 2026-03-12: Security hardening -- defense-in-depth approach

**Context**: A security audit reviewed the plugin for input validation gaps, output sanitization, credential handling, and subprocess security.

**Decision**: Implement a comprehensive security layer:
- `shared/validation.ts` with `sanitizeUrl()`, `sanitizePath()`, `ensureWithinVault()`, `sanitizeAIResponse()`
- `execFile` over `exec` for all subprocess calls (no shell invocation)
- `safeRequest()` wrapper for `requestUrl` with error body extraction and key redaction
- Password masking on all API key input fields
- Ollama endpoint protocol validation (HTTPS required, HTTP only for localhost)
- API key redaction in error messages
- 5-minute timeouts and 10MB buffer limits on all external calls
- Frontmatter key validation against allowlist + forbidden keys

**Alternatives considered**:
- Minimal hardening (validate only user-visible inputs)
- Third-party security libraries (adds runtime dependencies, violates zero-deps policy)
- No output sanitization (assumes AI providers return safe content)

**Rationale**: Defense-in-depth: multiple independent layers ensure a bypass in one layer does not compromise the system. Centralized in `shared/validation.ts` for easy auditing.

**Impact**: All external interactions are validated and sanitized. No user-facing behavior changes except masked API key fields and more descriptive error messages.

---

## 2026-03-12: VideoModule delegates transcription to AudioModule

**Context**: Video transcription requires downloading a video, extracting audio, and then transcribing it -- the same pipeline AudioModule already provides.

**Decision**: VideoModule accepts AudioModule as a constructor argument and calls `AudioModule.transcribe()` for the transcription step.

**Alternatives considered**:
- Duplicate transcription logic in VideoModule
- Create a shared transcription service extracted from both modules

**Rationale**: Keeps transcription logic in one place. The dependency is one-directional (Video -> Audio). Audio must be initialized before Video in `main.ts`.

**Impact**: Audio and Video modules are not fully independent. Audio must always be loaded if Video is enabled.

---

## 2026-03-12: Non-destructive proposal storage in `.synapse/`

**Context**: AI-generated elaborations and enrichments should never modify a user's notes without explicit consent. Proposals need to survive plugin reloads and Obsidian restarts.

**Decision**: Store proposals as JSON files in `.synapse/` with subdirectories per module:
- `.synapse/proposals/` -- elaboration proposals
- `.synapse/enrichments/` -- enrichment proposals
- `.synapse/tidy-snapshots/` -- tidy undo snapshots
- `.synapse/organize/proposals/` and `.synapse/organize/snapshots/` -- organize data
- `.synapse/deep-dive/` -- deep-dive proposals and `runs/` subdirectory

Each proposal is a separate file with metadata and proposed content.

**Alternatives considered**:
- In-memory only (lost on reload)
- Single database file (merge conflicts, corruption risk)
- Frontmatter annotations on original notes (modifies user files)

**Rationale**: JSON files are human-inspectable, diffable, and survive reloads. Individual files avoid corruption cascading across proposals. The `.synapse/` folder is excluded from all module scans by default.

**Impact**: Vault contains a `.synapse/` folder with module-specific subdirectories. Users can inspect, back up, or delete proposal/snapshot files manually.

---

## 2026-03-12: Modular architecture with FeatureModule contract

**Context**: The plugin has multiple distinct features that share infrastructure but are otherwise independent.

**Decision**: Each feature is a self-contained module following a common contract: `constructor(plugin, getSettings, notifications)`, `onload()`, `onunload()`. Modules are conditionally loaded based on settings. A shared utilities layer (`src/shared/`) provides cross-cutting concerns.

**Alternatives considered**:
- Monolithic single-file plugin
- Separate plugins per feature
- Event-bus architecture with loose coupling

**Rationale**: The module pattern balances isolation with simplicity. Features can be independently enabled/disabled. The `getSettings()` closure ensures modules always read fresh settings without event wiring.

**Impact**: Adding a new feature means creating a new module directory and wiring it in `main.ts`. Eight modules currently follow this pattern: elaboration, audio, video, enrichment, summarize, tidy, organize, deep-dive.

---

## 2026-03-12: Zero runtime npm dependencies

**Context**: Obsidian community plugins are reviewed for security and bundle size. Runtime dependencies increase both risk and review burden.

**Decision**: Zero runtime npm dependencies. All external API calls use Obsidian's `requestUrl` or native `fetch`. External tools (yt-dlp, ffmpeg) are invoked as subprocesses.

**Alternatives considered**:
- Use SDK packages for OpenAI, Anthropic, Deepgram
- Bundle a minimal HTTP client library

**Rationale**: Keeps the bundle small and avoids supply chain risk. API calls are simple enough to implement directly.

**Impact**: API integration code is hand-rolled but the plugin has no transitive dependency risk.

---

## 2026-03-12: Provider-specific model dropdowns

**Context**: The original model setting was a free-text input where users typed model identifiers. Typos caused silent API failures.

**Decision**: Replace free-text with dropdowns populated from `MODEL_OPTIONS`, keyed by provider. Anthropic uses simplified names mapped to full API IDs by `resolveModelId()`.

**Alternatives considered**:
- Free-text with validation (still requires users to know model IDs)
- Fetching available models from API at runtime (requires valid API key first)

**Rationale**: Eliminates typo risk and shows only relevant models per provider.

**Impact**: Users pick from curated lists. Adding a model requires updating `MODEL_OPTIONS` in `settings.ts`.

---

## 2026-03-12: Mobile support with graceful degradation

**Context**: The plugin uses `child_process` for yt-dlp/ffmpeg execution -- Node.js APIs unavailable on mobile. Originally marked `isDesktopOnly: true`.

**Decision**: Set `isDesktopOnly: false` in `manifest.json` and gate desktop-only features behind `Platform.isDesktop`:
- VideoModule is only initialized on desktop
- Video-related ribbon icon (mic) hidden on mobile
- `transcribeUrl` callback throws on mobile with a clear error message
- All non-video features (elaboration, enrichment, summarize, tidy, organize, deep-dive, title, audio) work on both platforms

**Alternatives considered**:
- Keep desktop-only (excludes mobile users from all features)
- API-based video processing service for mobile (adds complexity and external dependency)

**Rationale**: Most plugin features don't need Node.js APIs. Only video download/extraction requires local CLI tools. Mobile users get full access to AI-powered text features.

**Impact**: Plugin is available on mobile. Video features are clearly gated. Settings tab hides video-only options on mobile.

---

## 2026-03-12: Whisper API as default transcription provider with key fallback

**Context**: Audio transcription needs a reliable backend. Users may use Anthropic or Ollama as their AI provider, meaning their shared API key isn't an OpenAI key.

**Decision**: Default to OpenAI Whisper API. Add dedicated `audio.whisperApiKey` with fallback: `whisperApiKey || ai.apiKey`. The settings UI conditionally shows the Whisper key field only when needed.

**Alternatives considered**:
- Always require a separate Whisper key (redundant for OpenAI users)
- Require OpenAI as AI provider to use Whisper (unnecessarily restrictive)

**Rationale**: Zero extra configuration for OpenAI users; clear prompt for others. Conditional UI keeps settings clean.

**Impact**: Anthropic/Ollama users who want Whisper see an additional key field. OpenAI users see no change.

---

## 2026-03-12: yt-dlp for URL-based media fetching with PATH resolution

**Context**: Video transcription needs to download from YouTube/TikTok. Obsidian runs in Electron with a minimal PATH.

**Decision**: Use yt-dlp (external CLI) via `execFile`. A `shellEnv()` function prepends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH for subprocess calls. Use `os.tmpdir()` for temp files instead of vault-relative paths.

**Alternatives considered**:
- Require absolute paths in settings (poor UX)
- Use `shell: true` for PATH inheritance (reintroduces injection risk)

**Rationale**: Covers most installations automatically while preserving `execFile` security.

**Impact**: yt-dlp/ffmpeg found automatically on most systems. Users can verify via the dependency check command.
