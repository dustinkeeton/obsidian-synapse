#!/usr/bin/env bash
#
# clean_up.sh — find (and optionally remove) git branches + worktrees whose work
# has already landed on the default branch.
#
# Why this exists: `git branch --merged main` is an unreliable signal for which branches
# have landed. Depending on the merge method, a merged branch's commits may never appear in
# main's history under their original SHAs — squash and rebase merges rewrite them — so
# `git branch --merged main` can report *nothing* as merged and silently miss merged
# branches. The authoritative signal for "this branch is done" is therefore GitHub's PR
# state, which we read with `gh`. A branch is in scope only when its PR is MERGED (not
# open, not closed-without-merge).
#
# Safety: deletion uses `git branch -D` because a branch whose PR was squash- or
# rebase-merged looks "unmerged" to git's safe `-d`. That force-delete is only ever applied to a
# branch we've confirmed merged via gh AND that has no un-pushed local commits,
# so nothing reachable only from that branch is lost. The default branch and the
# branch/worktree you're currently on are never touched.
#
# Usage:
#   clean_up.sh             Dry run. Print the plan. Delete nothing. (default)
#   clean_up.sh --execute   Re-scan, then perform the deletions and `git fetch --prune`.
#
# Exit codes: 0 success · 1 precondition failure (not a git repo, gh missing/unauthed).

set -euo pipefail

MODE="dry-run"
case "${1:-}" in
  --execute) MODE="execute" ;;
  ""|--dry-run) MODE="dry-run" ;;
  *) echo "usage: clean_up.sh [--execute]" >&2; exit 1 ;;
esac

# --- Preconditions -----------------------------------------------------------

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: not inside a git work tree" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is required to determine merged PR state — not found on PATH" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated (run: gh auth login). Refusing to guess merged state." >&2
  exit 1
fi

TOPLEVEL="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || echo "")"  # empty if detached

DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"

# --- Gather merged PR head refs ----------------------------------------------
# Map of branch name -> PR number, for branches whose PR is merged.
declare -A MERGED_PR
while IFS=$'\t' read -r ref num; do
  [ -n "$ref" ] && MERGED_PR["$ref"]="$num"
done < <(gh pr list --state merged --limit 500 --json number,headRefName \
           -q '.[] | "\(.headRefName)\t\(.number)"' 2>/dev/null || true)

# --- Classify local branches -------------------------------------------------
# A branch is stale when: its PR is merged, it is not the default or current
# branch, and it has no un-pushed commits (nothing would be lost by deleting it).
STALE_BRANCHES=()      # "name<TAB>PR#"
SKIPPED_UNPUSHED=()    # "name<TAB>reason"

while IFS= read -r br; do
  [ -z "$br" ] && continue
  [ "$br" = "$DEFAULT_BRANCH" ] && continue
  [ "$br" = "$CURRENT_BRANCH" ] && continue
  pr="${MERGED_PR[$br]:-}"
  [ -z "$pr" ] && continue  # no merged PR for this branch → leave it alone

  # Guard against losing un-pushed work on a name-matched branch.
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name "${br}@{upstream}" 2>/dev/null || true)"
  if [ -z "$upstream" ]; then
    SKIPPED_UNPUSHED+=("${br}"$'\t'"PR #${pr} merged, but branch has no upstream — skipping to be safe")
    continue
  fi
  ahead="$(git rev-list --count "${upstream}..${br}" 2>/dev/null || echo 0)"
  if [ "$ahead" != "0" ]; then
    SKIPPED_UNPUSHED+=("${br}"$'\t'"PR #${pr} merged, but ${ahead} un-pushed commit(s) ahead of ${upstream} — skipping")
    continue
  fi

  STALE_BRANCHES+=("${br}"$'\t'"${pr}")
done < <(git for-each-ref --format='%(refname:short)' refs/heads)

# Quick membership test for "is this branch name stale?"
is_stale_branch() {
  local needle="$1" entry
  for entry in "${STALE_BRANCHES[@]:-}"; do
    [ "${entry%%$'\t'*}" = "$needle" ] && return 0
  done
  return 1
}

# --- Classify worktrees ------------------------------------------------------
# Remove a worktree when the branch checked out in it is stale. Never the primary
# worktree (first record) and never the one we're running from.
STALE_WORKTREES=()  # "path<TAB>branch"
primary=1
wt_path=""
wt_branch=""
flush_wt() {
  [ -z "$wt_path" ] && return
  if [ "$primary" = "1" ]; then primary=0; wt_path=""; wt_branch=""; return; fi
  if [ "$wt_path" = "$TOPLEVEL" ]; then wt_path=""; wt_branch=""; return; fi
  if [ -n "$wt_branch" ] && is_stale_branch "$wt_branch"; then
    STALE_WORKTREES+=("${wt_path}"$'\t'"${wt_branch}")
  fi
  wt_path=""; wt_branch=""
}
while IFS= read -r line; do
  case "$line" in
    worktree\ *) flush_wt; wt_path="${line#worktree }" ;;
    branch\ refs/heads/*) wt_branch="${line#branch refs/heads/}" ;;
    "") : ;;  # record separator; next "worktree " triggers flush
  esac
done < <(git worktree list --porcelain)
flush_wt

# --- Render the plan ---------------------------------------------------------
echo "clean-up — git scope (default branch: ${DEFAULT_BRANCH}, current: ${CURRENT_BRANCH:-<detached>})"
if [ "$MODE" = "dry-run" ]; then echo "MODE: DRY RUN — nothing will be deleted"; else echo "MODE: EXECUTE"; fi
echo

echo "Stale branches (PR merged):"
if [ "${#STALE_BRANCHES[@]}" -eq 0 ]; then
  echo "  (none)"
else
  for entry in "${STALE_BRANCHES[@]}"; do
    printf '  %-52s -> PR #%s MERGED\n' "${entry%%$'\t'*}" "${entry##*$'\t'}"
  done
fi
echo

echo "Worktrees to remove (branch merged):"
if [ "${#STALE_WORKTREES[@]}" -eq 0 ]; then
  echo "  (none)"
else
  for entry in "${STALE_WORKTREES[@]}"; do
    printf '  %-52s (%s)\n' "${entry%%$'\t'*}" "${entry##*$'\t'}"
  done
fi
echo

if [ "${#SKIPPED_UNPUSHED[@]}" -gt 0 ]; then
  echo "Skipped (needs a human look):"
  for entry in "${SKIPPED_UNPUSHED[@]}"; do
    printf '  %-52s %s\n' "${entry%%$'\t'*}" "${entry##*$'\t'}"
  done
  echo
fi

echo "Default-branch refresh (${DEFAULT_BRANCH}):"
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
  if git diff --quiet && git diff --cached --quiet; then
    echo "  will fast-forward to origin/${DEFAULT_BRANCH} after prune (if it's a fast-forward)"
  else
    echo "  will skip: working tree dirty"
  fi
else
  echo "  will skip: not on ${DEFAULT_BRANCH} (on ${CURRENT_BRANCH:-<detached>})"
fi
echo

if [ "$MODE" = "dry-run" ]; then
  echo "Dry run complete. Re-run with --execute to apply."
  exit 0
fi

# --- Execute -----------------------------------------------------------------
# Remove worktrees first so their branches are no longer checked out, then the
# branches, then prune. `git worktree remove` (no --force) refuses on a dirty
# tree — we let it, report, and skip the matching branch rather than nuke edits.
echo "Removing worktrees..."
declare -A WT_FAILED
for entry in "${STALE_WORKTREES[@]:-}"; do
  [ -z "$entry" ] && continue
  path="${entry%%$'\t'*}"; branch="${entry##*$'\t'}"
  if git worktree remove "$path" 2>/dev/null; then
    echo "  removed worktree $path"
  else
    echo "  WARN could not remove $path (dirty or locked) — leaving it and its branch '$branch' for you to inspect"
    WT_FAILED["$branch"]=1
  fi
done
git worktree prune

echo "Deleting branches..."
for entry in "${STALE_BRANCHES[@]:-}"; do
  [ -z "$entry" ] && continue
  branch="${entry%%$'\t'*}"
  if [ -n "${WT_FAILED[$branch]:-}" ]; then
    echo "  skip '$branch' — its worktree could not be removed"
    continue
  fi
  if git branch -D "$branch" >/dev/null 2>&1; then
    echo "  deleted branch $branch"
  else
    echo "  WARN could not delete '$branch' (still checked out elsewhere?)"
  fi
done

echo "Pruning stale remote-tracking refs..."
git fetch --prune

# Fast-forward the local default branch to the freshly-fetched remote tip — only when
# we're already on it and the tree is clean. Never switch branches, never merge-commit.
echo "Refreshing default branch..."
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
  if git diff --quiet && git diff --cached --quiet; then
    if git merge --ff-only "origin/${DEFAULT_BRANCH}" >/dev/null 2>&1; then
      echo "  ${DEFAULT_BRANCH}: fast-forwarded to $(git rev-parse --short HEAD)"
    else
      echo "  ${DEFAULT_BRANCH}: skipped (diverged — not a fast-forward)"
    fi
  else
    echo "  ${DEFAULT_BRANCH}: skipped (working tree dirty)"
  fi
else
  echo "  ${DEFAULT_BRANCH}: skipped (not on ${DEFAULT_BRANCH})"
fi

echo "Done."
