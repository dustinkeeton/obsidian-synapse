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

### 5. Classify priority

Infer a priority label from the issue context using signal matching:

| Signal in issue content | Label |
|------------------------|-------|
| crash, data loss, security, blocks all users | `priority: critical` |
| broken workflow, regression, significant UX issue | `priority: high` |
| new feature, improvement, moderate bug, unclear | `priority: medium` |
| cosmetic, nice-to-have, minor, tech debt | `priority: low` |

Default to `priority: medium` when signals are ambiguous.

Apply the priority label:

```bash
gh issue edit {number} --add-label "priority: medium"
```

Note: Labels use a space after the colon (e.g., `priority: medium`, not `priority:medium`).

### 6. Project integration

Add the newly created issue to the project board with "Backlog" status.

**6a. Resolve repo owner/name:**

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)
```

**6b. Get issue node ID** from the issue number returned by `gh issue create`:

```bash
ISSUE_NODE_ID=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F number=$ISSUE_NUMBER --jq '.data.repository.issue.id')
```

**6c. Discover project and field IDs:**

```bash
# Get project ID — select the board by title (an account may own several
# projects, so don't assume the first result is the right one).
PROJECT_ID=$(gh api graphql -f query='
  query($owner: String!) {
    user(login: $owner) {
      projectsV2(first: 20) {
        nodes { id number title }
      }
    }
  }
' -f owner="$OWNER" --jq 'first(.data.user.projectsV2.nodes[] | select(.title | test("Synapse"; "i")) | .id) // empty')

# Get Status field ID and Backlog option ID
gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
          }
        }
      }
    }
  }
' -f projectId="$PROJECT_ID"
```

Look for the "Status" field and extract the option ID for "Backlog". If "Backlog" is not found, try "Todo" or "New" as fallbacks.

**6d. Add to board and set status:**

```bash
# Add issue to project
ITEM_ID=$(gh api graphql -f query='
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
      item { id }
    }
  }
' -f projectId="$PROJECT_ID" -f contentId="$ISSUE_NODE_ID" --jq '.data.addProjectV2ItemById.item.id')

# Set status to Backlog
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: {singleSelectOptionId: $optionId}
    }) {
      projectV2Item { id }
    }
  }
' -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" -f fieldId="$STATUS_FIELD_ID" -f optionId="$BACKLOG_OPTION_ID"
```

**6e. Optionally assign milestone:**

```bash
# List open milestones
gh api repos/$OWNER/$REPO/milestones --jq '.[] | select(.state == "open") | {number, title, due_on}'
```

Match by scope: bugs → assign to earliest milestone, features → match by milestone title/scope. If no match → skip milestone assignment.

**Error handling:** Each substep fails independently. No project → skip with warning. No "Backlog" option → try "Todo"/"New" fallbacks. GraphQL error → report but don't fail the issue creation.

See the `github-project-management` skill for the full GraphQL query catalog.

### 7. Report back

Output the issue URL so the user (or calling agent) can reference it. Include:
- Priority label applied (or skipped with reason)
- Board status set (or skipped with reason)
- Milestone assigned (or skipped with reason)

## Examples

### Simple bug
```
/issue audio transcription fails silently when API key is expired
```
Creates an issue titled "Fix silent failure when audio transcription API key is expired" with `bug` label, a body explaining the problem, proposed error-handling fix, and no sub-issues. Applies `priority: high` label and adds to project board as "Backlog".

### Multi-step feature
```
/issue add support for Instagram video transcription
```
Creates an issue titled "Add Instagram video transcription support" with `enhancement` label, a body explaining the motivation, proposed approach, and sub-issues for URL detection, extraction, pipeline integration, and tests. Applies `priority: medium` label, adds to project board as "Backlog", and assigns to the matching milestone if one exists.

## When called by agents

Agents may invoke this skill to create tracking issues for discovered bugs, missing features, or tech debt. The same workflow applies — the agent's prompt serves as the brief description. Post-creation steps (priority classification, project board placement, milestone assignment) run automatically.
