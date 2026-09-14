---
name: adversarial-review
description: Adversarially review a green PR from a hostile reviewer's seat — read the full diff and poke holes in correctness edge cases, API/naming choices, missing tests, error handling, and simplification opportunities, posting findings as actionable PR review comments. Severity stays honest — no manufactured blockers; "no holes found" is a valid outcome for a genuinely solid PR. Invokable by users and agents.
user-invocable: true
argument-hint: "<PR#, number, or PR URL> (omit for the current branch's PR)"
---

# Adversarial Review

When this skill is invoked, you review a **finished, CI-green pull request** from the seat of
a **deliberately hostile reviewer**. Green checks prove the code *runs*; they do not prove it
is the *best version of itself*. Your job is the pressure step between "checks passed" and
"merge": read the full diff and find concrete reasons this PR is **not good enough yet**.

Your stance is adversarial, but your severity must stay **honest**. You are not here to
manufacture blockers or invent nits to look thorough — a genuinely solid PR earns a clean
bill of health. "No holes found" is a valid, and sometimes correct, outcome. The value is in
finding the *real* holes, not in the count.

This is distinct from the built-in `/code-review`, which reviews the author's uncommitted
working diff **before** commit. This skill reviews a **committed, green PR** from a reviewer's
seat and posts its findings back onto the PR as review comments addressed to the author
(human or agent).

## 1. Resolve the target PR

Inspect `$ARGUMENTS`:

| `$ARGUMENTS` | What to do |
|--------------|------------|
| `#N`, a bare number, or a PR URL | Review that PR. Reduce it to the PR number `N`. |
| empty / omitted | Review the **current branch's** open PR: `gh pr view --json number,url` (fails if the branch has no PR — report that and stop). |

Resolve the repo coordinates and the head commit up front — you need them to post inline
comments and to confirm the PR is really green:

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)
gh pr view "$N" --json number,title,state,isDraft,headRefName,headRefOid,mergeable,statusCheckRollup,url,author
```

- If the PR is **closed or merged**, there is nothing to gate — report and stop.
- If it is a **draft** or its **required checks are not yet green**, say so: this skill is the
  *post-green* gate. You may still review on request, but note that checks haven't passed.

## 2. Read the full diff and its surroundings

```bash
gh pr diff "$N"                      # the complete unified diff
gh pr view "$N" --json files,body    # changed-file list + PR description / intent
```

Do not review the diff in isolation. For each non-trivial change, **read the surrounding
code** the diff touches (open the files, trace the callers and callees) so your findings are
grounded in how the change actually behaves — not just how the hunk looks. A hole you can't
tie to a concrete failure or a concrete call site is a guess; don't post guesses.

## 3. Poke holes — the adversarial lens

Work through every category below. For each, ask "what did the author *not* handle, and how
would I break it?" Be specific: name the input, the line, the call path.

- **Correctness & edge cases** — boundary values (empty, zero, one, max, negative), `null`/
  `undefined`/missing keys, off-by-one, concurrency and re-entrancy, ordering assumptions,
  unicode/encoding, time zones, integer overflow, and the unhappy path the tests skip. What
  input makes this code do the wrong thing?
- **Error handling & failure modes** — swallowed exceptions, unchecked return values, partial
  writes with no rollback, resource leaks (unclosed handles/connections), retries without
  backoff or idempotency, and failures that surface as a confusing message three layers away.
  What happens when the thing this code depends on fails?
- **Missing or shallow tests** — untested new branches, tests that assert the happy path only,
  no coverage for the edge cases above, over-mocked tests that would pass even if the code
  were broken, and assertions weak enough to be vacuous. Which added line has no test that
  would fail if you deleted it?
- **API, naming & design choices** — leaky or too-wide public surface, names that mislead
  about behavior, inconsistent parameter order or return-shape versus siblings, booleans that
  should be enums, mutable state that should be immutable, and abstractions introduced with a
  single caller (or duplicated instead of abstracted). Would a caller be surprised by how this
  behaves?
- **Simplification & missed reuse** — dead or unreachable code, a hand-rolled loop that a
  standard library call replaces, a special case the general case already covers, an existing
  helper in this repo that was re-implemented, and needless indirection. What could be deleted
  with no loss?
- **Comment-vs-code disagreements** — comments in deterministic files (JS, YAML, shell) are
  human orientation, not spec: when one contradicts the code, the finding is "shrink or delete
  the comment", never "make the code match the comment". Raise a comment finding only when the
  comment misleads about live behavior — and the demand is a deletion or a one-line correction,
  not an expansion. Skill and agent markdown is different: there the prose is the program a
  model executes, and precision findings stay fully in scope, as do findings about
  **user-visible output strings** that lie.

Keep it proportional. A three-line typo fix does not need a five-category audit; a new module
does. Match the depth of the review to the surface area of the change.

## 4. Rank findings by honest severity

Assign each finding a severity and let that drive whether it blocks:

- **blocker** — a correctness bug, data-loss path, security hole, or missing test for
  load-bearing new logic. The PR should not merge as-is. Reserve this for holes you can
  demonstrate; if you are not sure it's real, it is not a blocker.
- **should-fix** — a real weakness (thin test, awkward API, unhandled-but-unlikely failure)
  that is worth addressing but wouldn't by itself stop a merge.
- **nit** — style, naming, or a minor simplification. Label it as optional. Comment wording in
  a deterministic file is at most a nit, and usually not a finding at all.

Do **not** pad the list. If the only honest finding is one nit, post one nit. If there are
none, say so (step 6).

## 5. Post findings as PR review comments

Frame each finding as an **actionable demand to the author**, not a vague observation: state
the hole, the concrete failure it causes, and what would resolve it. Prefer **inline comments
anchored to the offending line** so the author sees them in context, plus one **summary
review comment** that gives the verdict and lists the findings by severity.

Post everything as a **single review** so the author gets one coherent notification.

**Assemble the payload in a file, then post it with one single-line command.** Use the `Write`
tool to create the review payload outside the repo (so the working tree stays clean), then
submit it. Never build the review with a heredoc (`--input - <<'EOF'`) or a
multi-line `--body "…"`: a heredoc is a *multi-line command*, and an automated caller's tool
allowlist matches on the command's leading program (`Bash(gh api:*)`), which a multi-line
compound never matches — the call is denied and the review silently never posts.

**The staging path MUST be namespaced by PR number AND head SHA** (`$N` and `$HEAD_SHA` — the
`headRefOid` you resolved in step 1 — both in scope since step 1):

```
${TMPDIR:-/tmp}/waffle-adversarial-review-$N-$HEAD_SHA.json
```

A fixed, un-namespaced path (`/tmp/adversarial-review.json`) is a **correctness bug, not a
style nit**. These gates run *per PR, concurrently* — an autopilot parallel group runs this
review on several PRs at once. On one shared path, two runs interleaving a write and a
`gh --input` post **PR A's review onto PR B**, and the loser never knows; a stale payload
left by an earlier run gets posted as if it were this PR's. Both have happened. The PR number
in the path is what keeps two concurrent gates from ever touching the same file. And `$N`
alone is not enough (#376): every round of a multi-round loop on the same PR reuses a
per-PR-only path, so a later round — including autopilot's deliberately cold evidence pass —
finds the previous round's payload and is forced to read prior-round content just to
overwrite it, breaking the cold-pass isolation the loop depends on. The head SHA closes that:
each round reviews a different head by construction (the loop re-waits for green after every
fix push), so cross-round collisions are structurally impossible.

> **The `Write` tool does not expand shell syntax.** `$N`, `$HEAD_SHA` and `${TMPDIR:-/tmp}`
> are for the `bash` command line only. When you call `Write`, pass a **literal,
> already-substituted** path —
> `/tmp/waffle-adversarial-review-321-8f2d3f1e6a9c4b7d0e5f2a8b1c6d3e9f4a7b0c5d.json` for
> PR 321 at head `8f2d3f1e…` — or you will create a file named literally `${TMPDIR:-/tmp}`
> and post nothing. Use the **full** 40-character `headRefOid` verbatim — never truncate it.
> Use the same resolved path in both steps.

Write this JSON to that path — `line` must be a line that appears in the
PR's diff, `side: RIGHT` for added/context lines and `LEFT` for removed lines. The `body` MUST
**begin** with the literal marker `<!-- waffle-adversarial-review -->` as its **first line** (see
below):

```json
{
  "event": "COMMENT",
  "body": "<!-- waffle-adversarial-review -->\n**Adversarial review** — 1 blocker, 2 should-fix, 1 nit.\n\n- **[blocker]** `parseRange` returns the wrong bound for an empty input (see inline).\n- **[should-fix]** No test covers the `null` config path added in `load.ts`.\n- **[should-fix]** `flush()` swallows the write error instead of surfacing it.\n- **[nit]** `tmp2` could reuse the existing `withTempDir` helper.\n\n— posted by the adversarial-review bot",
  "comments": [
    { "path": "src/range.ts", "line": 42, "side": "RIGHT",
      "body": "**[blocker]** With `input === \"\"` this returns `[0, -1]`, so every downstream slice is empty. Add an explicit empty-input guard and a test that pins the returned bound." },
    { "path": "src/load.ts", "line": 88, "side": "RIGHT",
      "body": "**[should-fix]** This new `null`-config branch has no test — deleting the branch wouldn't fail the suite. Add a case that exercises it." }
  ]
}
```

**Read back the file before you post it.** Immediately before handing the path to `gh`, use
the `Read` tool on the *exact* file you are about to post and confirm it is the payload you
just wrote **for this PR at this head**: `<!-- waffle-adversarial-review -->` in the summary body, and
findings that match this PR's diff. If it holds anything else — another PR's findings, an
older run's payload, an empty or truncated file — **stop and do not post**: rewrite it,
re-read, then post. This check is cheap and it is the last thing standing between a stale
buffer and a review posted onto the wrong PR under a marker that makes it indistinguishable
from a real one.

Then post it — one program, one line, no compounds:

```bash
gh api "repos/$OWNER/$REPO/pulls/$N/reviews" --method POST --input "${TMPDIR:-/tmp}/waffle-adversarial-review-$N-$HEAD_SHA.json"
```

Notes on mechanics:

- **Begin the body with the marker.** Every review this skill posts — findings *or* no-holes —
  should **begin** with the exact literal `<!-- waffle-adversarial-review -->`. It is how a human
  recognizes a bot review in the UI, and how this skill recognizes its own prior posts.
- **Prove the review landed, THEN signal it — and never confuse the two.** Read back the **review
  itself**, by the id its POST returned; only once that succeeds, write the
  `waffle/adversarial-review` **commit status** on the reviewed head SHA:

  ```bash
  REVIEW_ID=$(gh api "repos/$OWNER/$REPO/pulls/$N/reviews" --method POST --input "${TMPDIR:-/tmp}/waffle-adversarial-review-$N-$HEAD_SHA.json" --jq '.id')
  gh api "repos/$OWNER/$REPO/pulls/$N/reviews/$REVIEW_ID" --jq '.id, .commit_id, .state'
  gh api --method POST "repos/$OWNER/$REPO/statuses/$HEAD_SHA" -f state=success -f context=waffle/adversarial-review -f description="Adversarial review posted"
  ```

  **Fail closed** — if the POST errors, or the read-back returns no id, report it, **do not write the
  status**, and do not claim the review posted.

  **If you run those as separate `Bash` calls, paste the LITERAL values — shell state does not survive
  between calls.** The harness persists the working directory, but variables die with the call, so a
  `$REVIEW_ID` or `$HEAD_SHA` captured in one call is **empty** in the next; substitute what the
  previous command printed. Here that fails loudly (an empty id makes a malformed URL and the API
  errors), but in the sibling `pr-response` skill the same slip loses a value **silently**, so treat
  the rule as absolute.

  **A status must never be its own proof.** Writing the status and then "verifying delivery" by
  reading *that status* back is self-attesting — it proves you wrote a status, not that a review
  exists, so an errored POST would still report *delivered* with nothing on the PR. The status is a
  **signal for consumers**, never evidence for you: everything that needs to know *"has this head
  been reviewed?"* reads it — `waffle-pr-green-hook`'s duplicate-review guard and delivery check, and
  `autopilot` — and it takes repo **push access** to write, so no body can forge one. This is the
  skill's signal **on every path**: a local run emits it exactly as a CI-dispatched one does.
- **Never paste another skill's raw marker literal — or this one — into a body.** No *workflow*
  reads a marker any more (#338), but the **skills and `autopilot` still do**, and `autopilot`'s
  triage gate is what **arms auto-merge**. So a review that merely *quotes* a marker can still read
  as "already reviewed" or "already triaged". Refer to a marker **by name**, or break the literal,
  when a review must discuss it — reviewing a hooks PR is exactly when the temptation arrives. Your
  own *leading* marker is exempt: it is the review.
- That split is the point of #338, and the old design is a trap that will look reasonable again.
  The hooks used to decide "the bot did a thing" by string-matching this literal inside a free-text
  body anyone can write, so a human comment (PR #207) or a QA review (PR #296) that merely *quoted*
  it read as "already replied" / "already reviewed" — silently suppressing the security review.
  Tightening the match only shrank the target; a marker-led body is still prose. Anything that needs
  to know this skill acted asks GitHub for an artifact that takes push access to write — it never
  parses a body.
- Use **`event: "COMMENT"`** — an honest, non-approving review. Escalate to
  `event: "REQUEST_CHANGES"` **only** when you found a genuine **blocker**; never as a default
  posture. GitHub forbids `REQUEST_CHANGES`/`APPROVE` on your **own** PR, so if the review
  identity authored the PR (common for agent-authored PRs), fall back to `event: "COMMENT"`
  and let the severity labels in the body carry the weight.
- A `line` that isn't part of the diff is rejected by the API. If a finding is about code the
  diff only *touches indirectly*, describe it in the **summary body** with a `file:line`
  reference instead of forcing an inline anchor.
- The file is the standard path, not a fallback: `--input <file>` sidesteps both the
  shell-escaping traps of many `-f`/`-F` flags and the multi-line-command trap above.

## 6. "No holes found" is a valid outcome

If the PR genuinely holds up — edge cases handled, tests real and sufficient, API clean, no
obvious simplification — **say so plainly** and do not invent findings to justify the run.
Post a short approving-in-spirit summary (still `event: "COMMENT"` unless you're authorized to
approve and aren't the author). Same rule as step 5: the body goes in a **file**, never inline
after `--body` — a multi-line body inside the command is the same allowlist trap. `Write` the
summary to the **per-PR, per-head** path `${TMPDIR:-/tmp}/waffle-adversarial-review-summary-$N-$HEAD_SHA.md` (same
namespacing rule and same literal-path caveat as step 5), marker as the first line:

```markdown
<!-- waffle-adversarial-review -->
Adversarial review: no holes found. Checked correctness edge cases, error handling, test depth,
API/naming, and simplification against the full diff — nothing blocks or should-fix. Solid PR.

— posted by the adversarial-review bot
```

`Read` it back to confirm it is this PR's summary, then post it with a single-line command:

```bash
gh pr review "$N" --comment --body-file "${TMPDIR:-/tmp}/waffle-adversarial-review-summary-$N-$HEAD_SHA.md"
```

## 7. Report back

Return a concise summary to the caller: the PR URL, the count of findings by severity
(blocker / should-fix / nit, or "none"), the review event used (`COMMENT` /
`REQUEST_CHANGES`), and one line on the most important finding if there is one.

## When called by agents

An agent may invoke this skill (via its frontmatter `skills:` grant) to gate a PR before it
merges — for example after a delegate run opens a PR, or as the qualitative step an
auto-merge flow lacks. The same workflow applies: the agent passes the PR number (or lets it
default to the current branch's PR), the review posts to the PR, and the structured summary
(step 7) is the agent's return value. Honesty still governs severity — an agent must not
manufacture blockers to look diligent, and "no holes found" is a legitimate result to hand
back.

**Being resumed across rounds.** An orchestrating loop (autopilot's Step 6) may keep the
invoking agent alive and **resume** it — "the PR head moved to `<sha>` — re-run your review on
the new diff" — instead of invoking this skill fresh each round. When resumed — and, for the two
cold-start rules below, when you are the fresh spawn that *replaces* a resumable agent:

- **Re-read the diff and the PR state fresh from the new head.** The branch moved: never trust
  cached file contents or a cached head SHA. Re-run the review against the new head.
- **Keep your finding history.** Don't re-post a hole the last round's fixes closed, and don't
  re-argue a finding `pr-response` declined with a reason you accepted. Anything *new* in the
  diff gets the same hostility as round 1 — a fix that introduced a fresh hole is exactly what a
  later round is for.
- **Cold starts recover the history from the PR itself.** Seed **only when your invocation tells
  you you are replacing a vanished loop agent** — autopilot's re-spawn prompt carries exactly that
  sentence. When it does, **seed it before reviewing**: read the
  PR's own marked `<!-- waffle-adversarial-review -->` reviews (what earlier rounds already raised
  and called resolved) and the marked `<!-- waffle-pr-response -->` reply's verdict table (what
  was implemented, deferred, or declined — and why). Never re-raise a finding that table records
  as settled without new evidence in the new head. This keeps the continuity rules above
  satisfiable on every path, not only for an agent that lived through the earlier rounds.
- **An empty context is *not* itself the signal — never infer the seed from it.** A loop may spawn
  you deliberately **cold**: autopilot's cap-escape evidence pass does precisely that, so that your
  look at the final head is *not* anchored by what earlier rounds declined — and its prompt says so
  ("this pass is deliberately cold — do not seed history from the PR"). **When the invocation says
  the pass is deliberately cold, do not seed**: seeding would re-anchor you on the very verdicts the
  cold spawn exists to escape, suppressing every finding earlier rounds declined. Absent an
  invocation that names you a replacement, review the head on its own evidence.
- **Your reply each round is the same structured summary** (step 7) a fresh run would return, so
  the loop's convergence logic is unaffected.

> **Auto-invocation on PR-green (opt-in).** The `github-workflow` stack ships a companion
> opt-in workflow, `waffle-pr-green-hook.yml`, that dispatches the CI harness to run this skill
> automatically the moment a PR's required checks go green — firing once per green transition
> (per head commit), not on every check re-run, with a duplicate-review guard keyed on this
> skill's review marker. It is **opt-in syrup** (it spends API money on every green PR), so it
> renders only when installed, and it needs this skill rendered alongside it
> (`.claude/skills/adversarial-review/SKILL.md`) — see that stack's setup note for the opt-ins.
> This skill remains independently useful invoked manually (`/adversarial-review <PR#>`) or by an
> agent, with or without the trigger.
