# Review round template

GitHub has no native review template, so this file is the **human's copy** of the shape the review
automation already writes. A review round is two halves, and each has a canonical form:

| Half | Who writes it | Canonical source (the enforcement point) |
|---|---|---|
| **Findings** — what is wrong with this PR | `adversarial-review` / `qa`, or a human reviewer | `.claude/skills/adversarial-review/SKILL.md` (§ "Rank findings by honest severity") |
| **Verdicts** — what the author will do about each finding | `pr-response`, or the PR author | `.claude/skills/pr-response/SKILL.md` (§ "Score each finding — rubric v3") |

**The skills are canonical; this file is a convenience.** The scoring anchors, the composite
thresholds, and the override rules live in the skills and are deliberately *not* restated here — one
source of truth, so a copy in `.github/` can never drift out from under the automation. When the two
disagree, the skill wins. Read the skill before you score.

---

## Half 1 — a finding

One block per finding. Number them `F1`, `F2`, … and keep the numbers stable across rounds: the
verdict table, the follow-up issues, and the next round's reviewer all refer to a finding by number.

```markdown
### F1 — <one-line demand, in the imperative: "Reject an empty allowlist prefix">

- **Severity**: blocker | should-fix | nit
- **Where**: `path/to/file.mjs:42` (anchor inline when the line is in the diff)
- **Hole**: the concrete failure — what input, what code path, what breaks.
- **Resolution**: what would close it.
```

Severity is the one thing a finding must get right, and it is **honest, not rhetorical**:

- **blocker** — a demonstrable correctness bug, data-loss path, security hole, or missing test for
  load-bearing new logic. Reserve it for holes you can demonstrate.
- **should-fix** — a real weakness worth addressing that would not by itself stop the merge.
- **nit** — style, naming, or a minor simplification. Label it optional.

Do not pad the list. **"No holes found" is a valid review** — say so plainly rather than
manufacturing a finding to justify the round.

## Half 2 — the verdict table

One row per finding, **every score recorded, including for declines** — the scores are what make the
thresholds tunable, and a verdict without its numbers is exactly the invisible judgment the rubric
exists to replace.

```markdown
| # | Finding | Severity | Reach | Validity | Effort/Risk | Alignment | Composite | Verdict | Reason |
|---|---------|----------|-------|----------|-------------|-----------|-----------|---------|--------|
| F1 | <short restatement> | 3 | 3 | 3 | 2 | 3 | 14 | **Implement** | <one line: why> |
| F2 | <short restatement> | 2 | 2 | 2 | 1 | 2 | 9  | **Defer**     | <one line + follow-up issue link> |
| F3 | <short restatement> | 1 | 1 | 0 | 3 | 1 | 6  | **Decline**   | <one line: why it is a false positive> |
```

The three verdicts, and what each obliges you to do:

- **Implement** — fix it in this PR, now.
- **Defer** — real, but not worth blocking this PR. **File a follow-up issue and link it in the
  reason.** A defer with no issue is a decline wearing a nicer word.
- **Decline** — do not do it. Say why, once, and move on.

Score the five dimensions (Severity · **Reach** · Validity · Effort/Risk · Alignment) against the
anchors in the `pr-response` skill, apply its three override rules explicitly, and never round a
score to reach the verdict you already wanted.

**Severity and Reach are separate on purpose** (rubric v3): Severity is how bad it is *if hit*,
Reach is whether it can be hit at all. A confirmed blocker in code that cannot execute keeps its
Severity 3 and takes Reach 0 — it defers on the honest numbers instead of being talked down. And a
real defect in dead code is always a **Defer with an issue**, never a Decline: dead code comes back.

## Rounds are append-only

Each round gets its **own** comment. Never edit or overwrite a previous round's reply: the verdict
trail *is* the product, and a later round that PATCHes an earlier one destroys the paper trail that
tells a reader why a finding was skipped three rounds ago. A new round re-reads the prior verdicts
and does not re-argue a finding it already declined with a reason the reviewer accepted.

## Do not paste the automation markers

The `adversarial-review` and `pr-response` skills open the reviews and replies they post with an
HTML-comment marker (named, not written out here: `waffle-adversarial-review` and
`waffle-pr-response`). They are how a **human** tells a bot post from a human one at a glance, and
how each skill recognizes its **own** prior posts — a `pr-response` run reads them to recover the
verdict history it has already given, so a marker in someone else's body muddles that record.

So: **write your review body without them.** The skills emit their own markers automatically; a human
review needs none, and the automation handles an unmarked human review just fine — run
`/pr-response` by hand to answer one.

**This is a safety rule, not hygiene.** What changed in #338 is *which half* of the system it
protects, not whether it matters.

- **CI no longer reads bodies.** pr-green's dedup and delivery check key on a
  `waffle/adversarial-review` **commit status**, pr-response's delivery check on a
  `waffle/pr-response` status, and its loop bound on a **label the workflow applies**. All take repo
  push access to write, so a pasted marker can no longer suppress the bot's review or dispatch a paid
  run — which is exactly what it *could* do before (a human comment on PR #207 and a QA review on
  PR #296 each did it by quoting a literal in prose).
- **The skills and `autopilot` still do.** `autopilot` decides which findings have been triaged, and
  then **arms auto-merge**; the skills recognize their own prior posts. A pasted marker still muddles
  that record — and on the merge path a body that reads as *"already triaged"* is how findings get
  merged with nobody having answered them.

So the rule stands, and it is now guarding the more expensive failure, not the cheaper one.
