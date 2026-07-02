---
name: issue
description: Create a well-structured GitHub issue from a brief description, or enrich an existing issue in place. Fleshes out title, body, labels, and optional sub-issues. Invokable by users and agents.
user-invocable: true
argument-hint: "<description for a new issue> | <#N, number, or issue URL to enrich> | (omit to enrich all open 'Needs Inference' issues)"
---

# GitHub Issue Creation

When this skill is invoked, you either **create a new GitHub issue** from a brief description or **enrich an existing issue in place** — in either case in **this repository** using the `gh` CLI. Your job is to flesh the input out into a clear, actionable issue.

## Mode detection

Inspect `$ARGUMENTS` to choose a mode (same detection approach as the `delegate` skill):

| `$ARGUMENTS` | Mode | What to do |
|--------------|------|------------|
| `#N`, a bare number, or a GitHub issue URL | **Enrich-in-place** | Flesh out that existing issue and update it — see **Enriching an existing issue (Needs Inference)** below. |
| empty / omitted | **Batch enrich** | Enrich **every** open issue labeled `Needs Inference` — see the batch note in that section. |
| any other text | **Create new** | Treat the text as the description for a brand-new issue and follow the **Workflow** below. |

`Needs Inference` is the lifecycle label: it marks an issue as awaiting AI fleshing-out, and is **removed** once the issue has been enriched.

## Workflow

> Steps below cover **Create new** mode. Enrich-in-place reuses the context (1), classification (2), priority (5), and project-integration (6) steps — see **Enriching an existing issue (Needs Inference)**.

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

Add additional labels only if clearly warranted by the repo's taxonomy (run `gh label list` when unsure — never apply a label that doesn't exist in the repo).

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

**Native sub-issues** — the checkbox list in the body is enough for small work. When the sub-tasks deserve their own issues, create each child with `gh issue create`, then link it to the parent as a native GitHub sub-issue (this is what makes the parent show `n of m` progress). The mutation is feature-flagged, so pass the `GraphQL-Features` header:

```bash
# Node IDs for parent and child (repeat the query per issue number)
ISSUE_ID=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F number=$N --jq '.data.repository.issue.id')

gh api graphql -H "GraphQL-Features: sub_issues" -f query='
  mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { number }
    }
  }
' -f parentId="$PARENT_ID" -f childId="$CHILD_ID"
```

Note: parent (epic) issues do **not** auto-close when their sub-issues close — close them explicitly once all children are done.

### 5. Classify priority

Infer a priority label from the issue context using signal matching:

| Signal in issue content | Label |
|------------------------|-------|
| crash, data loss, security, blocks all users | `priority: critical` |
| broken workflow, regression, significant UX issue | `priority: high` |
| new feature, improvement, moderate bug, unclear | `priority: medium` |
| cosmetic, nice-to-have, minor, tech debt | `priority: low` |

Default to `priority: medium` when signals are ambiguous. Labels use a space after the colon (e.g., `priority: medium`, not `priority:medium`).

Apply the priority label:

```bash
gh issue edit {number} --add-label "<priority label>"
```

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

**Error handling:** Each substep fails independently. No project → skip with warning. No "Backlog" option → try "Todo"/"New" fallbacks. GraphQL error → report but don't fail the issue creation. If the repo has no Projects board at all, skip step 6 entirely — issue creation still succeeds.

See the `github-project-management` skill for the full GraphQL query catalog.

### 7. Report back

Output the issue URL so the user (or calling agent) can reference it. Include:
- Priority label applied (or skipped with reason)
- Board status set (or skipped with reason)
- Milestone assigned (or skipped with reason)

## Enriching an existing issue (Needs Inference)

Use this when `$ARGUMENTS` is an issue reference (`#N`, a bare number, or an issue URL), or for each issue in **Batch enrich** mode. Instead of creating a new issue, you flesh out the existing one and update it in place.

1. **Fetch the issue:**
   ```bash
   gh issue view <N> --json number,title,body,labels,milestone,state
   ```
   This mode is intended for issues carrying the `Needs Inference` label. If the issue lacks it but was explicitly referenced, proceed anyway and note that it wasn't labeled.

2. **Gather context** — read the relevant source files to understand the problem/feature area (same as Workflow step 1). The issue's existing body is your brief.

3. **Re-draft title + body** using the same template (Problem / Proposed Solution / Sub-issues / Context) and the title/priority rules above. **Incorporate the issue's current content**, and **preserve the reporter's original text verbatim** at the end so nothing is lost:

   ```markdown
   <enriched body>

   <details><summary>Original report</summary>

   > <original issue body, quoted>
   </details>
   ```

4. **Update the issue in place** (use `--body-file` to avoid shell-escaping problems with backticks/`$`/`&`):
   ```bash
   gh issue edit <N> --title "<new title>" --body-file <path-to-body>
   ```

5. **Labels** — add the type label (step 2) and priority label (step 5), and **remove the lifecycle label**:
   ```bash
   gh issue edit <N> --add-label "<type label>" --add-label "<priority label>" --remove-label "Needs Inference"
   ```

6. **Project board + milestone** — ensure the issue is on the board with a Status (Backlog if open) and has a milestone, reusing **step 6** (project integration). Skip whichever is already set.

7. **Report back** — issue URL, a one-line summary of what changed, and confirmation that `Needs Inference` was removed and the board/milestone were applied.

### Batch enrich (no argument)

When `$ARGUMENTS` is empty, process the whole queue:

```bash
gh issue list --state open --label "Needs Inference" --json number,title,body,labels
```

Run steps 1–7 above for each issue, then print a summary of every issue enriched (number, new title, labels, milestone).

## Examples

### Simple bug
```
/issue data export fails silently when the API key is expired
```
Creates an issue titled "Fix silent failure when the data-export API key is expired" with the bug-type label, a body explaining the problem, proposed error-handling fix, and no sub-issues. Applies the high-priority label and adds to project board as "Backlog".

### Multi-step feature
```
/issue add CSV import support
```
Creates an issue titled "Add CSV import support" with the enhancement-type label, a body explaining the motivation, proposed approach, and sub-issues for file parsing, validation, pipeline integration, and tests. Applies the default priority label, adds to project board as "Backlog", and assigns to the matching milestone if one exists.

### Enrich an existing issue
```
/issue 360
```
Fetches issue #360 (labeled `Needs Inference`), reads the relevant code, and rewrites its title and body into the full template — preserving the original report in a collapsed block. Applies the type + priority labels, removes `Needs Inference`, ensures it's on the board as "Backlog", and assigns a milestone.

### Enrich the whole queue
```
/issue
```
With no argument, enriches every open issue labeled `Needs Inference` in one pass, then summarizes the results.

## When called by agents

Agents may invoke this skill to create tracking issues for discovered bugs, missing features, or tech debt. The same workflow applies — the agent's prompt serves as the brief description. Post-creation steps (priority classification, project board placement, milestone assignment) run automatically. Agents can also pass an issue reference (`#N`/number/URL) to enrich an existing issue in place — e.g., after a user files a rough issue tagged `Needs Inference`.
