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
argument-hint: "[git | agents | all]  [--yes]   — omit for a full preview-then-confirm sweep"
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

`--yes` combines with a scope (e.g. `git --yes`).

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
   Never stop a task that is `in_progress` — that would kill live work.
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
   | `/delegate` | `issue-<N>-<agent-type>` | the run's checkpoint — `execution[]` carries each issue's `number` and `agent` |
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
