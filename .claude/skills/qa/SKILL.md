---
name: qa
description: Functional QA of a green PR against the linked issue's intent — read the full diff plus the issue's acceptance criteria, best-effort run the project's tests and exercise the changed behavior, and assess whether the diff carries real test coverage, posting findings as one PR review. Severity stays honest — "no QA concerns" is a valid outcome for a change that does what its issue asked and proves it with tests. Invokable by users and agents.
user-invocable: true
argument-hint: "<PR#, number, or PR URL> (omit for the current branch's PR)"
---

# QA

When this skill is invoked, you QA a **finished, CI-green pull request** against **what its
linked issue asked for**. Green checks prove the code *runs*; they do not prove the change
*does what the issue intended*, or that the changed behavior carries tests that would catch it
regressing. Your job is the functional gate between "checks passed" and "merge": read the diff
**and** the issue, enumerate the intended behaviors, test what the repo lets you test, and
report where the change falls short of its own spec.

This is distinct from `adversarial-review`, which reviews the same green PR from a hostile
reviewer's seat — correctness edge cases, API/naming choices, error handling, design. QA asks
the complementary questions: **does the change do what the issue said**, and **is the changed
behavior actually covered by tests**? A PR can survive a hostile design review and still ship
with an acceptance criterion quietly missing — that gap is exactly what this skill exists to
catch. Like its sibling, this skill **reports**; it never commits fixes or tests itself — the
`pr-response` skill is the applying half that disposes of the findings.

Your severity must stay **honest**. You are not here to manufacture findings to look
thorough — a change that does what its issue asked, with real coverage, earns a clean bill of
health. "No QA concerns" is a valid, and sometimes correct, outcome. The value is in finding
the *real* gaps between intent and implementation, not in the count.

## 1. Resolve the target PR

Inspect `$ARGUMENTS`:

| `$ARGUMENTS` | What to do |
|--------------|------------|
| `#N`, a bare number, or a PR URL | QA that PR. Reduce it to the PR number `N`. |
| empty / omitted | QA the **current branch's** open PR: `gh pr view --json number,url` (fails if the branch has no PR — report that and stop). |

Resolve the repo coordinates and the head commit up front — you need them to post inline
comments and to confirm the PR is really green:

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)
gh pr view "$N" --json number,title,state,isDraft,headRefName,headRefOid,mergeable,statusCheckRollup,url,author
```

- If the PR is **closed or merged**, there is nothing to gate — report and stop.
- If it is a **draft** or its **required checks are not yet green**, say so: this skill is the
  *post-green* gate. You may still QA on request, but note that checks haven't passed.

## 2. Read the diff AND the issue's intent

```bash
gh pr diff "$N"
gh pr view "$N" --json files,body,closingIssuesReferences
```

The issue is the spec. For **each linked issue** in `closingIssuesReferences`, read its full
body:

```bash
gh issue view <issue#> --json title,body
```

If `closingIssuesReferences` is empty, fall back to parsing closing keywords (`Closes #N`,
`Fixes #N`, `Resolves #N`) out of the PR body and read those issues. If the PR links **no
issue at all**, QA against the PR body's own stated intent — and say plainly in the review
that no issue was linked, so the spec you verified against is the PR's self-description.

Then **distill an acceptance checklist**: the concrete behaviors, criteria, and constraints
the issue (or PR body) says this change must deliver. Explicit `- [ ]` acceptance criteria are
checklist items verbatim; prose intent becomes the behaviors it implies. This checklist is
what the rest of the run verifies — every item ends the run as **met**, **not met**, or
**not verifiable here** (with the reason).

Do not QA the diff in isolation. For each checklist item, find where the diff claims to
deliver it — open the files, trace the changed call paths — so your verdicts are grounded in
what the change actually does, not what its description says it does.

## 3. Test what the repo offers (best-effort)

Prefer **running** the change over reading it. Check out the PR's head branch if it isn't the
current branch (same precedent as `pr-response`):

```bash
gh pr checkout "$N"
```

Then, in priority order, as far as the repo allows:

1. **Run the project's test suite** and read the result — a green suite is the floor, not the
   verdict:

   ```bash
   npm test
   ```

2. **Exercise the changed behavior directly where feasible** — run the CLI path the diff
   touched, hit the changed function with the acceptance checklist's inputs, reproduce the
   bug the issue reported and confirm it no longer reproduces. The issue's acceptance
   criteria are your test cases; walk them one by one.
3. **Assess the diff's test coverage.** For each load-bearing added or changed line, ask:
   *which test would fail if this line were deleted or broken?* If the answer is "none", that
   is a coverage finding. Think failing-test-first: for each suspected gap, name the test that
   *should* exist (file, case, the assertion that would pin the behavior) — you report that
   missing test as a finding; you do not write or commit it here. Over-mocked tests that would
   pass even with the change broken count as gaps, not coverage.

**Degrade honestly when execution isn't feasible** — a dirty working tree you must not
disturb, no runnable test command, an environment the change can't be exercised in. Fall back
to the static coverage assessment (item 3) and the diff-vs-checklist walk, and **say so in
the review**: state what you ran, what you could not run, and why. Never imply you executed
something you didn't.

## 4. Rank findings by honest severity

Assign each finding a severity and let that drive whether it blocks:

- **blocker** — an acceptance criterion of the linked issue that the change does not meet, a
  changed behavior you demonstrated doing the wrong thing, or load-bearing new logic with no
  test that would fail if it broke. A missing acceptance criterion that ships is a blocker.
  Reserve this for gaps you can demonstrate; if you are not sure it's real, it is not a
  blocker.
- **should-fix** — thin coverage of the changed behavior (the happy path is tested, the
  criterion's edge is not), a secondary criterion met only partially, or a test that passes
  without actually exercising the change.
- **nit** — a minor test-hygiene or verification improvement. Label it as optional.

Do **not** pad the list. If the only honest finding is one nit, post one nit. If there are
none, say so (step 6).

Comment text in deterministic files (JS, YAML, shell) is outside QA's scope: QA verifies
acceptance criteria and behavior — including user-visible output — not prose that no runtime
reads.

## 5. Post findings as one PR review

Frame each finding as an **actionable demand to the author**: name the acceptance criterion
or behavior, the gap between it and the change, and what would resolve it (the missing test,
the unmet criterion's fix). Prefer **inline comments anchored to the offending line**, plus
one **summary review comment** that gives the verdict and walks the acceptance checklist.

Post everything as a **single review** so the author gets one coherent notification.

**Assemble the payload in a file, then post it with one single-line command.** Use the `Write`
tool to create the review payload outside the repo (so the working tree stays clean), then
submit it. Never build the review with a heredoc or a multi-line `--body "…"`: a heredoc is a
*multi-line command*, and an automated caller's tool allowlist matches on the command's
leading program (`Bash(gh api:*)`), which a multi-line compound never matches — the call is
denied and the review silently never posts.

**The staging path MUST be namespaced by PR number AND head SHA** (`$N` and `$HEAD_SHA` — the
`headRefOid` you resolved in step 1 — both in scope since step 1):

```
${TMPDIR:-/tmp}/waffle-qa-review-$N-$HEAD_SHA.json
```

A fixed, un-namespaced path (`/tmp/qa-review.json`) is a **correctness bug, not a style
nit**. These gates run *per PR, concurrently* — an autopilot parallel group runs `qa` on
several PRs at once. On one shared path, two runs interleaving a write and a `gh --input`
post **PR A's review onto PR B**, and the loser never knows; a stale payload left by an
earlier run gets posted as if it were this PR's. Both have happened. The PR number in the
path is what keeps two concurrent gates from ever touching the same file. And `$N` alone is
not enough (#376): every round of a multi-round loop on the same PR reuses a per-PR-only
path, so a later round — including autopilot's deliberately cold evidence pass (the QA
gate's cap hatch) — finds the previous round's payload and is forced to read prior-round
content just to overwrite it, breaking the cold-pass isolation the loop depends on. The head
SHA closes that: each round reviews a different head by construction (the loop re-waits for
green after every fix push), so cross-round collisions are structurally impossible.

> **The `Write` tool does not expand shell syntax.** `$N`, `$HEAD_SHA` and `${TMPDIR:-/tmp}`
> are for the `bash` command line only. When you call `Write`, pass a **literal,
> already-substituted** path —
> `/tmp/waffle-qa-review-321-8f2d3f1e6a9c4b7d0e5f2a8b1c6d3e9f4a7b0c5d.json` for PR 321 at
> head `8f2d3f1e…` — or you will create a file named literally `${TMPDIR:-/tmp}` and post
> nothing. Use the **full** 40-character `headRefOid` verbatim — never truncate it. Use the
> same resolved path in both steps.

Write this JSON to that path — `line` must be a line that appears in the PR's
diff, `side: RIGHT` for added/context lines and `LEFT` for removed lines. The `body` MUST
carry the literal marker `<!-- waffle-qa -->` as its FIRST line (see below):

```json
{
  "event": "COMMENT",
  "body": "<!-- waffle-qa -->\n**QA** — 1 blocker, 1 should-fix. Acceptance criteria: 2 of 3 met.\n\n- **[blocker]** Issue #12 criterion \"empty input returns an empty list\" is not met — `parseRange(\"\")` still throws (see inline).\n- **[should-fix]** The new `--force` flag has no test that would fail if the flag were ignored.\n\nRan `npm test` (green, 214 passing); exercised the CLI export path by hand — criteria walk below.\n\n— posted by the qa bot",
  "comments": [
    { "path": "src/range.ts", "line": 42, "side": "RIGHT",
      "body": "**[blocker]** Issue #12's first acceptance criterion says empty input returns an empty list; this line still throws on `\"\"`. Exercised directly: `parseRange(\"\")` → TypeError. Fix the guard and add a test pinning the empty-input contract." },
    { "path": "src/cli.ts", "line": 88, "side": "RIGHT",
      "body": "**[should-fix]** No test exercises `--force` — deleting this branch leaves the suite green. Add a case that runs the command with and without the flag and asserts the differing outcome." }
  ]
}
```

**Read back the file before you post it.** Immediately before handing the path to `gh`, use
the `Read` tool on the *exact* file you are about to post and confirm it is the payload you
just wrote **for this PR at this head**: `<!-- waffle-qa -->` on line 1, and findings that match this PR's
diff. If it holds anything else — another PR's findings, an older run's payload, an empty or
truncated file — **stop and do not post**: rewrite it, re-read, then post. This check is
cheap and it is the last thing standing between a stale buffer and a review posted onto the
wrong PR under a marker that makes it indistinguishable from a real one.

Then post it — one program, one line, no compounds:

```bash
gh api "repos/$OWNER/$REPO/pulls/$N/reviews" --method POST --input "${TMPDIR:-/tmp}/waffle-qa-review-$N-$HEAD_SHA.json"
```

Notes on mechanics:

- **The marker is this skill's own, and it must lead the body.** Every review this skill posts —
  findings *or* no-concerns — must **begin** with the exact literal `<!-- waffle-qa -->` as the
  **first line** of the summary body. It is how a human, and each sibling skill, recognizes a QA
  review. It is deliberately **distinct from the adversarial-review skill's marker**; never put that
  other marker in a QA review.
- **Never quote another skill's raw marker literal mid-body, either — naming it is not carrying
  it, but pasting it is.** No *workflow* reads a marker any more (#338 — CI keys on commit statuses
  and a label), but the **skills and `autopilot` still do**, and `autopilot`'s triage gate is what
  **arms auto-merge**. QA needs this rule most: a QA review of a hooks PR naturally *discusses* those
  markers, and pasting a raw literal anywhere in the body — a code fence, a blockquote, a table cell
  — is enough. **This is not hypothetical: PR #296's QA review did it** (literal at offset 1103, in
  prose about the hook) and, on the tolerant predicates of the day, that one body suppressed the real
  adversarial review *and* spent the PR's one automated pr-response reply. Refer to a marker **by
  name** (`the adversarial-review marker`), or break the literal, when the review must discuss it.
  Your own leading `waffle-qa` marker is exempt — that is the review, and identifying it is what the
  marker is for.
- Use **`event: "COMMENT"`** — an honest, non-approving review. Escalate to
  `event: "REQUEST_CHANGES"` **only** for a genuine **blocker**; never as a default posture.
  GitHub forbids `REQUEST_CHANGES`/`APPROVE` on your **own** PR, so if the review identity
  authored the PR (common for agent-authored PRs), fall back to `event: "COMMENT"` and let
  the severity labels in the body carry the weight.
- A `line` that isn't part of the diff is rejected by the API. If a finding is about behavior
  the diff only *touches indirectly* (e.g. an unmet criterion with no single offending line),
  describe it in the **summary body** with a `file:line` reference instead of forcing an
  inline anchor.
- The file is the standard path, not a fallback: `--input <file>` sidesteps both the
  shell-escaping traps of many `-f`/`-F` flags and the multi-line-command trap above.

## 6. "No QA concerns" is a valid outcome

If the change genuinely delivers what its issue asked — every acceptance criterion met, the
changed behavior exercised or credibly covered, the suite green — **say so plainly** and do
not invent findings to justify the run. Same rule as step 5: the body goes in a **file**,
never inline after `--body`. `Write` the summary to the **per-PR, per-head** path
`${TMPDIR:-/tmp}/waffle-qa-summary-$N-$HEAD_SHA.md` (same namespacing rule and same literal-path caveat
as step 5), marker on its own line, including the criteria walked and what you ran:

```markdown
<!-- waffle-qa -->
QA: no concerns. All 3 acceptance criteria of #12 verified met; ran the test suite (green)
and exercised the changed export path directly. The new branch logic is pinned by the two
tests added in this PR.

— posted by the qa bot
```

`Read` it back to confirm it is this PR's summary, then post it with a single-line command:

```bash
gh pr review "$N" --comment --body-file "${TMPDIR:-/tmp}/waffle-qa-summary-$N-$HEAD_SHA.md"
```

## 7. Verify delivery, then report back

Two steps, in this order, and **neither substitutes for the other**:

```bash
# 1. PROVE THE REVIEW LANDED — read back the artifact itself, by the id its POST returned.
REVIEW_ID=$(gh api "repos/$OWNER/$REPO/pulls/$N/reviews" --method POST --input "${TMPDIR:-/tmp}/waffle-qa-review-$N-$HEAD_SHA.json" --jq '.id')
gh api "repos/$OWNER/$REPO/pulls/$N/reviews/$REVIEW_ID" --jq '.id, .commit_id, .state'

# 2. ONLY THEN, signal it — a waffle/qa commit status on the head you reviewed
#    (step 1's headRefOid — do not re-resolve it here).
gh api --method POST "repos/$OWNER/$REPO/statuses/$HEAD_SHA" -f state=success -f context=waffle/qa -f description="QA review posted"
```

**Fail closed:** if the POST errored, or the read-back errors or returns no id, report the error
verbatim, **do not write the status**, and do **not** claim the review posted — a QA pass whose
findings never landed is a failed pass, not a clean one.

> [!WARNING]
> **If you run those as separate `Bash` calls, paste the LITERAL values — shell state does not
> survive between calls.** The harness persists the working directory, but variables die with the
> call, so a `$REVIEW_ID` or `$HEAD_SHA` captured in one call is **empty** in the next. Substitute
> what the previous command actually printed (`…/reviews/2891…`, `…/statuses/8f2d3f1…`). Here that
> fails loudly — an empty id makes a malformed URL and the API errors — but the sibling `pr-response`
> skill has a value whose loss is **silent** (its `triaged-through` cutoff), so treat the rule as
> absolute rather than learning it the expensive way.

> [!IMPORTANT]
> **A status must never be its own proof.** The obvious shortcut — write the status, then verify
> delivery by reading *that status* back — is **self-attesting**: it proves "I wrote a status", which
> is trivially true one line after writing one, and it never observes the review at all. If the
> review POST errors and the run continues, the read-back still returns 1 and the pass reports
> *clean and delivered* with nothing on the PR. The only thing binding such a status to a review
> would be a sentence in this file telling a model to write it afterwards — **exactly the
> prose-to-prose coupling #338 abolished in CI**, reintroduced one layer down. So step 1 reads the
> **review**, by id, and step 2's status is a *signal for consumers*, never evidence for you.

**Why the signal is a commit status and not this skill's marker in a body.** The delivery check used
to be a `.body | contains(…)` test for this skill's own marker over the reviews on the head — a
**tolerant substring over free text anyone can write**. That is the mechanism #338 excised from CI,
and it was still live here: a *human* review that merely **quoted** the marker while discussing it —
a review of a hooks PR, say — satisfied the check, so a QA run whose own POST was denied read that
stranger's body as proof of its own delivery and reported a clean pass. **PR #296 is that bug,
observed** (literal at offset 1103). A commit status takes repo **push access** to write, so no body
can forge it; a review id read back from the API cannot be forged by a body either.

The head-scoping stays load-bearing: both the review's `commit_id` and the status are keyed to the
SHA, so an **earlier round's** review can never satisfy a later round's check — in a multi-round loop
(autopilot runs `qa` → `pr-response` repeatedly) a silently denied POST from round 2 on would
otherwise "verify" against round 1 and this round's findings would be lost.

Then return a concise summary to the caller: the PR URL, the count of findings by severity
(blocker / should-fix / nit, or "none") — the per-severity count is what an orchestrating
loop reads — the acceptance-criteria tally (met / not met / not verifiable), what was
executed (test command result, behaviors exercised) versus statically assessed, and one line
on the most important finding if there is one.

## When called by agents

An agent may invoke this skill (via its frontmatter `skills:` grant) to functionally gate a
PR before it merges — most notably the `autopilot` skill's opt-in QA gate, which runs
`qa <PR#>` → `pr-response <PR#> --yes` rounds on each green PR before its review loop. The
same workflow applies: the agent passes the PR number (or lets it default to the current
branch's PR), the review posts to the PR where `pr-response` reads it, and the structured
summary (step 7) is the agent's return value. Honesty still governs severity — an agent must
not manufacture blockers to look diligent, and "no QA concerns" is a legitimate result to
hand back.

**Being resumed across rounds.** An orchestrating loop (autopilot's Step 5) may keep the
invoking agent alive and **resume** it — "the PR head moved to `<sha>` — re-run your QA pass on
the new diff" — instead of invoking this skill fresh each round. When resumed — and, for the two
cold-start rules below, when you are the fresh spawn that *replaces* a resumable agent:

- **Re-read the diff and the PR state fresh from the new head.** The branch moved: never trust
  cached file contents, a cached head SHA, or a remembered checks verdict. Re-run steps 1–7
  against the new head.
- **Keep your verdict history.** Don't re-litigate acceptance criteria you already verified met
  unless the new diff touches them, and say explicitly when a prior finding is now resolved by
  the fixes that landed. Continuity is the reason the loop keeps you alive.
- **Cold starts recover the history from the PR itself.** Seed **only when your invocation tells
  you you are replacing a vanished loop agent** — autopilot's re-spawn prompt carries exactly that
  sentence. When it does, **seed it before reviewing**: read the
  PR's own marked `<!-- waffle-qa -->` reviews (what earlier rounds already raised and called
  resolved) and the marked `<!-- waffle-pr-response -->` reply's verdict table (what was
  implemented, deferred, or declined — and why). Never re-raise a finding that table records as
  settled without new evidence in the new head. This keeps the continuity rules above satisfiable
  on every path, not only for an agent that lived through the earlier rounds.
- **An empty context is *not* itself the signal — never infer the seed from it.** A loop may spawn
  you deliberately **cold**: autopilot's cap-escape evidence pass does precisely that, so that your
  look at the final head is *not* anchored by what earlier rounds declined — and its prompt says so
  ("this pass is deliberately cold — do not seed history from the PR"). **When the invocation says
  the pass is deliberately cold, do not seed**: seeding would re-anchor you on the very verdicts the
  cold spawn exists to escape, suppressing every finding earlier rounds declined. Absent an
  invocation that names you a replacement, review the head on its own evidence.
- **Your reply each round is the same structured summary** (step 7) a fresh run would return —
  identical in shape, so the loop's convergence logic is unaffected. The head-scoped delivery
  check (step 7) already guarantees a resumed round cannot be satisfied by an earlier round's
  review.
