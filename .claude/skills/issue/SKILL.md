---
name: issue
description: Create a well-structured GitHub issue from a brief description. Fleshes out title, body, labels, and optional sub-issues. Invokable by users and agents.
user-invocable: true
argument-hint: "<brief description of the issue>"
---

# GitHub Issue Creation

When this skill is invoked, create a GitHub issue in **this repository** using the `gh` CLI. The user (or calling agent) provides a brief description; your job is to flesh it out into a clear, actionable issue.

## Workflow

### 1. Gather context

If the description is ambiguous, read relevant source files to understand the problem or feature area. Do not ask clarifying questions unless the description is genuinely too vague to act on.

### 2. Classify the issue

Determine the issue type and select **one primary label** from the repo:

| Intent | Label |
|--------|-------|
| Something is broken | `bug` |
| New capability | `enhancement` |
| Questions or discussion | `question` |
| Docs improvements | `documentation` |

Add additional labels only if clearly warranted (e.g., `help wanted`).

### 3. Draft the issue

Compose a title (under 70 characters) and a body using this template:

```markdown
## Problem / Motivation
<Why this issue exists — what's broken, missing, or unclear>

## Proposed Solution
<Concrete approach or acceptance criteria>

## Sub-issues
- [ ] <discrete task 1>
- [ ] <discrete task 2>
- [ ] ...

## Context
<Links to related code, issues, or docs — only if useful>
```

Rules:
- **Title** should be imperative: "Add ...", "Fix ...", "Update ..."
- **Problem** section explains *why*, not just *what*
- **Proposed Solution** should be specific enough to act on
- **Sub-issues** — break the work into discrete, independently-completable tasks when the issue involves more than one logical step. Omit this section for simple, single-task issues.
- **Context** — omit if nothing useful to link

### 4. Create the issue

```bash
gh issue create \
  --title "<title>" \
  --label "<label>" \
  --body "$(cat <<'EOF'
<body content>
EOF
)"
```

### 5. Report back

Output the issue URL so the user (or calling agent) can reference it.

## Examples

### Simple bug
```
/issue audio transcription fails silently when API key is expired
```
Creates an issue titled "Fix silent failure when audio transcription API key is expired" with `bug` label, a body explaining the problem, proposed error-handling fix, and no sub-issues.

### Multi-step feature
```
/issue add support for Instagram video transcription
```
Creates an issue titled "Add Instagram video transcription support" with `enhancement` label, a body explaining the motivation, proposed approach, and sub-issues for URL detection, extraction, pipeline integration, and tests.

## When called by agents

Agents may invoke this skill to create tracking issues for discovered bugs, missing features, or tech debt. The same workflow applies — the agent's prompt serves as the brief description.
