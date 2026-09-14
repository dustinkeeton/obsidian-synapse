---
name: clean-up
description: >-
  Tidy up after a finished process: delete local git branches and worktrees
  whose pull request has already merged, prune stale remote-tracking refs, and
  spin down background tasks and agents that have completed their work. Use this
  whenever one or more PRs have just merged, after a /delegate run wraps up, or
  when the user says things like "clean up", "clean up the merged branches",
  "remove stale worktrees", "tidy up my branches", or "we're done, spin down the
  agents". This is git + agent housekeeping — NOT source-code cleanup or
  refactoring.
user-invocable: true
argument-hint: "[git | agents | all]  [--yes]  [--run <checkpoint.json>]   — omit for a full preview-then-confirm sweep"
---

# Clean Up

Housekeeping after work has landed. Two independent domains:

- **Git** — local branches and worktrees whose PR is merged, plus a `git fetch --prune`.
- **Harness** — background tasks and agents that have finished their work.

The guiding principle is that cleanup should only ever remove things whose work is
**already safe elsewhere** — a branch whose PR merged, a task that completed. Anything
still in flight, or holding the only copy of some work, is left alone. Because the
destructive half (force-deleting branches, stopping agents) can't be undone, the default
is to **show the full plan and wait for a yes** before touching anything.

## Arguments

| Arg | Effect |
|---|---|
| _(none)_ | Full sweep — git **and** harness — previewed, then confirmed. |
| `git` / `branches` / `worktrees` | Git scope only. |
| `agents` / `tasks` | Harness scope only. |
| `--yes` / `auto` | Skip the confirmation prompt. Intended for an **agent calling this right after it merges a PR** — not for interactive use unless the user explicitly says "no need to confirm". |
| `--run <path>` | Sweep one `/delegate` run from an explicit checkpoint file instead of globbing the conventional `.claude/worktrees/.delegate/` directory — for a consumer that moved `delegate.checkpointDir`. Harness scope only. |

`--yes` combines with a scope (e.g. `git --yes`). `--run` does not combine with `--yes`: stopping agents
is always confirm-first.

## Post-merge convention

`git --yes` is the built-in path for the **merging agent**: right after it merges a PR, it runs

```
clean-up git --yes
```

to delete the just-merged local branch and worktree and prune stale remote-tracking refs — no
confirmation prompt, because the agent already knows the PR merged. This is step 3 of the
[git-workflow "After a PR merges"](../git-workflow/SKILL.md) flow; its sibling steps (verify the
linked issues closed, reconcile their board Status to **Done**) are a **local-agent** job too,
handled there via the `github-project-management` skill or the `project-manager` agent — none of
it is wired into CI. The one remote-side action that *can* be a CI job — deleting the merged head
branch on the remote — is the optional `waffle-post-merge-hook` workflow; this skill still owns
everything local.

## The workflow

1. **Parse scope** from the argument. Default to the full sweep.
2. **Build the git plan** (if git is in scope) — run the bundled scanner in dry-run mode:
   ```bash
   bash .claude/skills/clean-up/scripts/clean_up.sh
   ```
   It prints which branches and worktrees are stale, which it deliberately skipped, and
   whether it will fast-forward the default branch. It deletes nothing in this mode.
3. **Build the harness plan** (if harness is in scope) — see [Harness scope](#harness-scope) below.
4. **Present the combined plan** to the user using the [report format](#report-format).
5. **Gate on confirmation.** Unless `--yes` was passed, ask "Proceed?" and wait. If the
   user vetoes specific items (e.g. "keep the dependabot worktree"), honor that — drop
   them from the plan and proceed with the rest.
6. **Execute** the confirmed plan ([Git scope](#git-scope) + [Harness scope](#harness-scope)).
7. **Report** what was actually removed.

## Git scope

All git logic lives in `scripts/clean_up.sh` so the dry-run is provably read-only and the
execute path is identical every time. **Always go through the script — don't hand-roll
`git branch -D` loops**, because the staleness check is subtle:

> `git branch --merged main` is not a reliable signal for which branches have merged. Depending
> on the merge method, a merged branch's commits may never land on `main` under their original
> SHAs — squash and rebase merges rewrite them — so `git branch --merged main` can report
> **nothing** and miss merged branches. The script instead asks GitHub for merged PR state via
> `gh`, which is the authoritative signal regardless of how the PR was merged.

Run it dry-run to get the plan, then with `--execute` once confirmed:

```bash
bash .claude/skills/clean-up/scripts/clean_up.sh            # dry run → the plan
bash .claude/skills/clean-up/scripts/clean_up.sh --execute  # remove worktrees, delete branches, prune
```

What the script guarantees, so you don't have to re-check it:

- Only branches whose PR is **merged** are in scope (open / closed-without-merge are left alone).
- The **default branch** and the **branch/worktree you're currently on** are never switched
  away from or deleted. On `--execute`, if you're currently *on* the default branch and the
  working tree is clean, it **is fast-forwarded** to the freshly-fetched remote tip
  (fast-forward only — never a merge commit, never a branch switch).
- A merged branch with **un-pushed commits** (ahead of its upstream) is skipped and listed
  under "needs a human look" — force-deleting it could lose those commits.
- Worktrees are removed with plain `git worktree remove` (no `--force`); a **dirty** worktree
  is skipped and reported rather than discarded, and its branch is then left in place too.
- `--execute` runs `git fetch --prune` to drop `origin/*` refs for branches that no
  longer exist on the remote.
- After the prune, `--execute` **fast-forwards the local default branch** to the just-fetched
  `origin/<default>` — but only when you're currently *on* it and the working tree is clean, and
  only as a fast-forward (never a merge commit, never a branch switch). It reports one of:
  `fast-forwarded to <sha>`, `skipped: not on <default>`, or `skipped: diverged or dirty`.

Out of scope by design: **deleting the remote branch** on GitHub (merges usually auto-delete
it, and we don't want to touch the remote), and **closed-but-unmerged** branches (that work
never landed — removing it is a judgment call the user should make deliberately, not a sweep).

## Harness scope

Use the task and agent tools to find work that has wrapped up. The aim mirrors the git side:
stop things that are **done**, never things still running.

There are **no teams to hunt for**: the session has a single implicit team, and `TeamCreate` /
`TeamDelete` no longer exist. What outlives its work is an **agent**, and an agent is stopped by
name.

1. **Enumerate the tasks** with `TaskList` (it takes no arguments and lists every task in the
   session). Note each task's `subject`, `status`, and `owner`.
2. **Finished background tasks** — for any task that is `completed` (or is plainly idle/abandoned
   with no further use), stop it:
   ```
   TaskStop(task_id: "<id>")
   ```
   Never stop a task that is `in_progress` — that would kill live work. The one exception is a
   task the [delegate sweep](#sweeping-delegate-runs-from-their-checkpoints) below has **reconciled**:
   its work is proven landed, so the task is marked `completed` first and then stopped like any other.
3. **Finished agents.** An agent is stopped **by name** — so first you need the names, and this is
   the step's real problem: **the harness has no agent enumeration.** There is no `AgentList`;
   `TaskList` lists *tasks*, not agents, and it will not show you an agent that never held one
   (autopilot's gate agents, for instance, are spawned without a task). A task's `owner` names an
   agent **when something set it** — but nothing in this toolkit's flows does, so it is usually
   empty. **Do not treat an empty `TaskList` as proof that no agent is running.**

   The names therefore come from **the run that spawned them**, not from a discovery call. That is
   exactly why each orchestrator here names its spawns deterministically:

   | Run | Agent names | Where the record is |
   |---|---|---|
   | `/delegate` | `issue-<N>-<agent-type>` | the run's checkpoint — `execution[]` carries each issue's `number` and `agent`; procedure [below](#sweeping-delegate-runs-from-their-checkpoints) |
   | `/audit` | the fixed six-agent chain: `architecture-pass`, `security-pass1`, the compliance agent, `docs-agent`, `docs-human`, `security-final` | the skill's roster |
   | `/autopilot` | `qa-pr<N>`, `respond-qa-pr<N>`, `review-pr<N>`, `respond-rev-pr<N>` | keyed to the PR number |

   So: reconstruct the candidate names from whichever run you are cleaning up after (and ask the
   user if you are cleaning up after something else — an agent nobody recorded is **invisible** to
   this skill). Then, for each agent that has completed its work or is plainly idle and abandoned,
   ask it to wind down and confirm the kill:
   ```
   SendMessage(to: "<agent-name>", message: {type: "shutdown_request", reason: "Cleanup: work complete"})
   TaskStop(task_id: "<agent-name>")
   ```
   `shutdown_request` alone is not reliable — an agent can go idle but stay alive. `TaskStop` is
   what actually terminates it, and it is safe on an agent that has already exited (so a name you
   are unsure about costs nothing to try). Never stop an agent that is still doing live work.

   **Report what you could not see.** If you have no record of what was spawned, say so — *"no run
   record available; agents not swept"* — rather than reporting `Agents stopped: (none)`. The two
   read identically to a user and mean opposite things, and the second one is how a leaked agent
   goes unnoticed.

### Sweeping `/delegate` runs from their checkpoints

A `/delegate` run stands its own agents down in its Phase 5 teardown — **when Phase 5 runs**. A run
interrupted before that (or an agent that crashed before its `TaskUpdate`) leaves its agents alive
and its per-issue tasks `in_progress`, and nothing revisits that state. The checkpoint is the run
record, so sweep from it:

1. **Find the runs.** Checkpoints live one JSON document per run in the conventional
   `.claude/worktrees/.delegate/` directory (delegate's `delegate.checkpointDir` default):
   ```bash
   ls .claude/worktrees/.delegate/*.json
   ```
   `--run <path>` names one checkpoint explicitly instead. No files → there is no run record;
   report it that way (step 5). A `delegate-single-*` run is the single-issue fast path: it spawns
   without a `name:` and creates no task, so its agent is **unsweepable** — list the run as such
   rather than pretending it was cleaned.
2. **Derive the candidates.** For each run, read `execution[]` and reconstruct
   `issue-<number>-<agent>` per entry. One entry per line — name, `status`, `pr`, and whether the
   `report` section exists:
   ```bash
   node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const e of c.execution??[])console.log(`issue-${e.number}-${e.agent}`,e.status,e.pr??"-",c.report?"reported":"unreported")' .claude/worktrees/.delegate/<runId>.json
   ```
   A run interrupted mid-Phase 4 has a `plan` but no `execution` section yet: take `number` and
   `agent` from `plan.groups[].assignments[]` instead, and judge each by its `branch`'s PR
   (`gh pr list --head <branch> --state all --json state -q '.[0].state'`).
3. **Judge each entry by its work, not its task status.** An entry is **safe to stop** when its
   `status` is `done`, `failed`, or `skipped` **and** either it has no `pr`, or
   `gh pr view <pr> --json state -q .state` prints `MERGED` or `CLOSED`, or the run's `report`
   section exists (Phase 5 ran, so the run itself already judged it). An entry with an **open** PR,
   or `status: done` with no `report` section and no PR verdict, is **in flight** — leave it, and say
   why in the report. A run with any in-flight entry is never reported as fully swept.
4. **Reconcile, then stop.** For each safe entry: if its task (`Issue #<N>: …` in `TaskList`) is
   still `in_progress`, mark it `completed` — the orchestrator's bookkeeping the interrupted run
   never did — then run the shutdown-then-stop path above:
   ```
   TaskUpdate(taskId: "<task id>", status: "completed")
   SendMessage(to: "issue-<N>-<agent>", message: {type: "shutdown_request", reason: "Cleanup: delegate run <runId> landed"})
   TaskStop(task_id: "issue-<N>-<agent>")
   ```
   Most of these agents are already gone; `TaskStop` is safe on an exited agent, so the sweep costs
   nothing when the run did clean up after itself. `shutdown_request` and `TaskStop` are
   main-session-only — a spawned seat can build and report the plan, but cannot execute it.
5. **Surface it.** Every run goes in the report's `Delegate runs swept:` block: its id, the entries
   stopped and reconciled, the entries left in flight, and `unsweepable` for a single-issue run. With
   no checkpoints at all, keep the *"no run record available; agents not swept"* line — that is the
   honest answer, not `Agents stopped: (none)`.

**Crons are out of scope.** Scheduled jobs (`CronList`) are almost always intentional recurring
work, not leftover state, so cleanup never deletes them. If you suspect a cron is genuinely
obsolete, surface it to the user as a note — don't remove it.

## Report format

Keep the preview and the final report in the same shape so the user can diff "planned" against
"done" at a glance:

```
clean-up — <scope> (<dry run / executed>)

Branches (PR merged):
  <branch>   -> PR #<n> MERGED
  ...
Worktrees:
  <path>   (<branch>)
Skipped (needs a human look):
  <branch>   <reason>
Default branch: fast-forwarded to <sha>   (or: skipped (not on <default> / diverged / dirty))

Tasks stopped:
  <task id / subject>
Agents stopped:
  <agent-name> — <what it finished>
Delegate runs swept:
  <runId>   stopped: issue-<N>-<agent> (PR #<n> MERGED), …   reconciled: <task ids>
            in flight: issue-<N>-<agent> (PR #<n> OPEN)
  <runId>   unsweepable (single-issue fast path)
  (or: no run record available; agents not swept)

Left untouched: current branch, open/closed-unmerged PRs, crons.
```

In dry-run/preview, end with **"Proceed? (y/N)"**. After executing, end with a one-line summary
(e.g. "Removed 4 branches, 1 worktree; stopped 2 tasks and 1 agent.").

## Edge cases

- **Nothing stale** — say so plainly ("Nothing to clean up — no merged branches, no finished
  agents.") and stop. Don't invent work.
- **`gh` missing or not authenticated** — the script exits non-zero with a clear message. Relay
  it; do **not** fall back to `git branch --merged` (it can miss merged branches depending on the
  merge method) or guess.
- **A worktree the user actively reuses** (e.g. a long-lived dependabot scratch worktree) may be
  flagged because its setup PR merged. That's exactly what the confirm step is for — if the user
  says keep it, drop it from the plan.
- **Detached HEAD** — the script handles it (no current branch to protect); proceed normally.
- **A checkpoint that will not parse** (truncated by the interruption) — report the run id and the
  parse error under `Delegate runs swept:` and leave its agents alone; do not guess names from a
  half-written file.
