---
name: delegate
description: Fetch open GitHub issues, assign each to the best specialist agent, and orchestrate execution with parallel worktree isolation and serial dependency chains
user-invocable: true
argument-hint: "[issue number, label filter, or keyword — omit for all open issues]"
---

# Issue Delegation

Fetch open GitHub issues, assign each to the right specialist agent, and orchestrate execution. Handles parallel worktree isolation when safe and serial chaining when necessary.

## Phase 1: Fetch Issues

```bash
gh issue list --state open --json number,title,labels,body --limit 50
```

**Argument handling** — if `$ARGUMENTS` is provided:
- Matches `#N` or a bare number → fetch that single issue: `gh issue view N --json number,title,labels,body`
- Matches a known label (`bug`, `enhancement`, `documentation`, `question`) → filter: `gh issue list --state open --label "$ARGUMENTS" --json number,title,labels,body`
- Otherwise → fetch all open issues, filter client-side by keyword match against title and body

## Phase 2: Classify

For each issue, determine the best specialist agent using content-based matching. Scan the issue title and body for keywords and source paths, then apply the first matching row:

| Keywords / paths in issue | Agent |
|---|---|
| `src/audio/`, `src/video/`, audio, transcription, whisper, deepgram, yt-dlp, youtube, tiktok | `transcription-engineer` |
| `src/elaboration/`, elaborate, proposal, placeholder, detection | `elaboration-designer` |
| `src/enrichment/`, enrich, tags, links, weights | `plugin-architect` |
| `src/summarize/`, summarize, summary, URL fetching | `plugin-architect` |
| `src/tidy/`, `src/views/`, UI, modal, settings-tab, sidebar, tidy, formatting | `plugin-architect` |
| `src/shared/`, validation, ai-client, file-utils | `architect` |
| `src/main.ts`, plugin lifecycle, onload, commands | `plugin-architect` |
| security, injection, secrets, .gitignore | `security` |
| AGENTS.md, machine docs, module registry | `docs-agent` |
| DECISIONS.md, STATUS.md, ARCHITECTURE.md | `docs-human` |
| architecture, structure, naming, dependency, circular | `architect` |

**Label fallback** — if no keyword match:

| Label | Agent |
|---|---|
| `bug` | `plugin-architect` |
| `enhancement` | `plugin-architect` |
| `documentation` | `docs-agent` |
| `question` | `architect` |

After classification, determine the affected `src/` subdirectory for each issue (used for parallelization).

## Phase 3: Plan & Confirm

Build an assignment plan table and determine parallel grouping.

**Parallelization rules** — two issues can run in parallel when ALL of these hold:
- Assigned to **different** agents
- Affect **different** `src/` subdirectories (no module overlap)
- Neither touches root files (`main.ts`, `settings.ts`, `settings-tab.ts`) or `src/shared/`
- No dependency language in the issue body ("depends on #N", "blocked by #N", "after #N")

**Serialization rules** (override parallel):
- `src/shared/` is a bottleneck — any two issues touching it must serialize
- `src/video/` depends on `src/audio/` — serialize audio-first
- Security issues serialize **last**
- Documentation issues serialize **last** (need final code state)

Present the plan to the user:

```
## Delegation Plan

| # | Issue | Agent | Module(s) | Group |
|---|-------|-------|-----------|-------|
| 3 | Fix UI hang when... | plugin-architect | summarize | A |
| 5 | Fix folder picker... | architect | shared | B (serial) |

**Parallel:** Group A runs simultaneously with worktree isolation
**Serial:** Group B runs after A completes (touches shared/)

Proceed?
```

**Confirmation gate:**
- **Always confirm** when: >2 agents would spawn, any assignment is ambiguous, or parallel execution is planned
- **Skip confirmation** for a single obvious assignment (e.g., `/delegate #5` with a clear match)

Wait for the user to approve, modify, or cancel before proceeding.

## Phase 4: Execute

### Branch naming

Each agent gets a branch named per git-workflow conventions:
- Bug fix: `fix/issue-{N}-{short-desc}`
- Enhancement: `feat/issue-{N}-{short-desc}`
- Refactor: `refactor/issue-{N}-{short-desc}`
- Chore/docs: `chore/issue-{N}-{short-desc}`

### Spawning agents

**Parallel groups** — spawn all agents in the group simultaneously using `isolation: "worktree"` on the Agent tool:

```
Agent(
  subagent_type: "plugin-architect",
  isolation: "worktree",
  prompt: <agent prompt>,
  description: "Issue #3: Fix UI hang"
)
```

The `isolation: "worktree"` parameter automatically creates and cleans up a git worktree for the agent. No manual worktree management needed.

**Serial groups** — spawn agents one at a time in the main working directory. Wait for each to complete before spawning the next.

### Agent prompt template

Each spawned agent receives this prompt:

```
You are assigned to GitHub issue #{number}: {title}

## Issue body

{full issue body from GitHub}

## Instructions

1. Read the relevant source files identified in the issue
2. Implement the fix/feature following the project's conventions
3. Follow the git-workflow skill for all git operations:
   - Branch from main: git checkout main && git pull && git -c user.email=bot@wafflenet.io -c user.name=bot checkout -b {branch-name}
   - Commit with bot identity and Co-Authored-By footer
   - Push: git -c user.email=bot@wafflenet.io -c user.name=bot push -u origin {branch-name}
4. Run the pre-flight checklist before pushing:
   - npx tsc --noEmit --skipLibCheck
   - npm test
   - node esbuild.config.mjs production
5. Create a PR: gh pr create --title "{type}: {short description}" --body "..." targeting main
6. Report back with a summary of changes made and the PR URL

Branch name: {branch-name}
```

### Post-agent verification

After each agent completes, verify the build still passes in the main working directory:

```bash
npx tsc --noEmit --skipLibCheck && npm test
```

If verification fails after a parallel agent's worktree merge, stop and report the conflict.

## Phase 5: Report

After all agents complete, present a summary:

```
## Delegation Report

| # | Issue | Agent | Status | PR |
|---|-------|-------|--------|----|
| 3 | Fix UI hang... | plugin-architect | done | #6 |
| 5 | Fix folder picker... | architect | done | #7 |

Build: passing
```

Include any failures or skipped issues with reasons.

## Error Handling

- **Build failure** — stop the chain, report to the user, do not create a PR for the failing agent's work
- **Agent cannot complete** — add a comment to the GitHub issue via `gh issue comment {N} --body "..."` explaining what was attempted and what blocked completion, then move on to the next issue
- **Worktree conflict** — fall back to serial execution in the main working directory, report the conflict
- **All agents failed** — present a summary of all failures and suggest manual intervention
