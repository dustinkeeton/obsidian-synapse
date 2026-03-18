---
name: git-workflow
description: Git branching strategy, commit standards, and PR workflow for the Synapse project. Use when performing any git operations (commits, branches, pushes, PRs).
user_invocable: false
---

# Git Workflow Standards

## Identity

All git operations MUST use the project bot identity:

```bash
git -c user.email=bot@wafflenet.io -c user.name=bot <command>
```

Never use a personal identity or the default git config for this project.

## Branch Strategy

### Main is protected
- **NEVER push directly to `main`.**
- All work happens on feature branches.
- Changes reach `main` only through pull requests.

### Branch naming
- `feat/<short-description>` — new features
- `fix/<short-description>` — bug fixes
- `refactor/<short-description>` — restructuring without behavior change
- `chore/<short-description>` — tooling, config, docs, CI

### Creating a branch
```bash
git checkout main && git pull
git -c user.email=bot@wafflenet.io -c user.name=bot checkout -b feat/my-feature
```

## Commits

### Message format
```
<type>: <concise summary>

<optional body — why, not what>

Co-Authored-By: Claude <bot@wafflenet.io>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `test`, `docs`

### Rules
- Do NOT attribute `https://anthropic.com/claude-code` or `noreply@anthropic.com` in commits.
- Use `Co-Authored-By: Claude <bot@wafflenet.io>` instead.
- Pass commit messages via HEREDOC for proper formatting.
- Never skip hooks (`--no-verify`) or bypass signing unless explicitly asked.
- Prefer new commits over amending.

### Example
```bash
git -c user.email=bot@wafflenet.io -c user.name=bot commit -m "$(cat <<'EOF'
feat: add vault-wide enrichment scan command

Three-phase scan: collect eligible files, confirm with user,
then generate enrichment proposals with cancellation support.

Co-Authored-By: Claude <bot@wafflenet.io>
EOF
)"
```

## Push & Pull Requests

### Pushing
```bash
git -c user.email=bot@wafflenet.io -c user.name=bot push -u origin feat/my-feature
```

### Creating PRs (no human in the loop)
After pushing, create the PR immediately using `gh`:

```bash
gh pr create --title "feat: short title" --body "$(cat <<'EOF'
## Summary
- Bullet points describing changes

## Test plan
- [ ] Tests pass (`npm test`)
- [ ] Build passes (`npx tsc --noEmit --skipLibCheck && node esbuild.config.mjs production`)

Co-Authored-By: Claude <bot@wafflenet.io>
EOF
)"
```

- PR title should be under 70 characters.
- Always target `main` as the base branch.
- Push and PR without waiting for human approval — the user reviews in GitHub.

## Parallel Work (Worktrees + Teams)

When multiple agents work in parallel on files that might conflict:

1. **Use git worktrees** to isolate work:
   ```bash
   git worktree add ../synapse-feat-x feat/feature-x
   ```

2. **Lock files** — if two agents suspect they'll edit the same file, one should finish first. Use `TaskList(team_name: ...)` to check which files other agents are modifying.

3. **Conflict alerting** — if you detect a potential conflict with another agent's work, notify them immediately: `SendMessage(to: "<agent-name>", content: "Conflict: I'm editing <file>")`.

4. **Clean up** worktrees after merging:
   ```bash
   git worktree remove ../synapse-feat-x
   ```

Teams and worktrees are orthogonal — teams provide coordination (task tracking, messaging), worktrees provide isolation (separate working directories). Use both together for parallel agent work.

## Pre-flight Checklist

Before pushing any branch:
1. `npx tsc --noEmit --skipLibCheck` — types pass
2. `npm test` — all tests pass
3. `node esbuild.config.mjs production` — build succeeds
4. `git diff main...HEAD` — review all changes since branching
