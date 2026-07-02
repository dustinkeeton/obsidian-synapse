---
name: clean-up
description: >-
  Tidy up after a finished process: delete local git branches and worktrees
  whose pull request has already merged, prune stale remote-tracking refs, and
  spin down background tasks and teams that have completed their work. Use this
  whenever one or more PRs have just merged, after a /delegate run wraps up, or
  when the user says things like "clean up", "clean up the merged branches",
  "remove stale worktrees", "tidy up my branches", or "we're done, spin down the
  agents". This is git + agent housekeeping — NOT source-code cleanup or
  refactoring.
user-invocable: true
argument-hint: "[git | agents | all]  [--yes]   — omit for a full preview-then-confirm sweep"
---

# Clean Up

Housekeeping after work has landed. Two independent domains:

- **Git** — local branches and worktrees whose PR is merged, plus a `git fetch --prune`.
- **Harness** — background tasks and teams that have finished their work.

The guiding principle is that cleanup should only ever remove things whose work is
**already safe elsewhere** — a branch whose PR merged, a task that completed. Anything
still in flight, or holding the only copy of some work, is left alone. Because the
destructive half (force-deleting branches, deleting teams) can't be undone, the default
is to **show the full plan and wait for a yes** before touching anything.

## Arguments

| Arg | Effect |
|---|---|
| _(none)_ | Full sweep — git **and** harness — previewed, then confirmed. |
| `git` / `branches` / `worktrees` | Git scope only. |
| `agents` / `teams` / `tasks` | Harness scope only. |
| `--yes` / `auto` | Skip the confirmation prompt. Intended for an **agent calling this right after it merges a PR** — not for interactive use unless the user explicitly says "no need to confirm". |

`--yes` combines with a scope (e.g. `git --yes`).

## The workflow

1. **Parse scope** from the argument. Default to the full sweep.
2. **Build the git plan** (if git is in scope) — run the bundled scanner in dry-run mode:
   ```bash
   bash .claude/skills/clean-up/scripts/clean_up.sh
   ```
   It prints which branches and worktrees are stale and which it deliberately skipped.
   It deletes nothing in this mode.
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

> Most GitHub repos (this one included) squash-merge PRs. A squash-merged branch's commits
> never land on `main` under their original SHAs, so `git branch --merged main` reports
> **nothing** — it misses every merged branch. The script instead asks GitHub for merged PR
> state via `gh`, which is the only authoritative signal.

Run it dry-run to get the plan, then with `--execute` once confirmed:

```bash
bash .claude/skills/clean-up/scripts/clean_up.sh            # dry run → the plan
bash .claude/skills/clean-up/scripts/clean_up.sh --execute  # remove worktrees, delete branches, prune
```

What the script guarantees, so you don't have to re-check it:

- Only branches whose PR is **merged** are in scope (open / closed-without-merge are left alone).
- The **default branch** and the **branch/worktree you're currently on** are never touched.
- A merged branch with **un-pushed commits** (ahead of its upstream) is skipped and listed
  under "needs a human look" — force-deleting it could lose those commits.
- Worktrees are removed with plain `git worktree remove` (no `--force`); a **dirty** worktree
  is skipped and reported rather than discarded, and its branch is then left in place too.
- `--execute` finishes with `git fetch --prune` to drop `origin/*` refs for branches that no
  longer exist on the remote.

Out of scope by design: **deleting the remote branch** on GitHub (merges usually auto-delete
it, and we don't want to touch the remote), and **closed-but-unmerged** branches (that work
never landed — removing it is a judgment call the user should make deliberately, not a sweep).

## Harness scope

Use the task/team tools to find work that has wrapped up. The aim mirrors the git side:
stop things that are **done**, never things still running.

1. **Enumerate** with `TaskList`. Note each task's `status` and `owner`, and which `team` it belongs to.
2. **Finished background tasks** — for any task that is `completed` (or is plainly idle/abandoned
   with no further use), stop it:
   ```
   TaskStop(taskId: "<id>")
   ```
   Never stop a task that is `in_progress` — that would kill live work.
3. **Fully-completed teams** — for a team where **every** task is `completed`, shut it down the
   same way `/delegate` does: message each member to wind down, then delete the team.
   ```
   SendMessage(to: "<member-name>", type: "shutdown_request", content: "Cleanup: work complete")
   TeamDelete(team_name: "<team>")
   ```
   If a team has even one open task, leave the whole team alone — it's still working.

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

Tasks stopped:
  <task id / description>
Teams shut down:
  <team> — <n>/<n> tasks done

Left untouched: main, current branch, open/closed-unmerged PRs, crons.
```

In dry-run/preview, end with **"Proceed? (y/N)"**. After executing, end with a one-line summary
(e.g. "Removed 4 branches, 1 worktree; stopped 2 tasks; deleted 1 team.").

## Edge cases

- **Nothing stale** — say so plainly ("Nothing to clean up — no merged branches, no finished
  agents.") and stop. Don't invent work.
- **`gh` missing or not authenticated** — the script exits non-zero with a clear message. Relay
  it; do **not** fall back to `git branch --merged` (it silently misses squash-merges) or guess.
- **A worktree the user actively reuses** (e.g. a long-lived dependabot scratch worktree) may be
  flagged because its setup PR merged. That's exactly what the confirm step is for — if the user
  says keep it, drop it from the plan.
- **Detached HEAD** — the script handles it (no current branch to protect); proceed normally.
