---
name: github-project-management
description: GitHub project management operations using gh CLI and GraphQL. Covers Projects v2 boards, milestones, issue relationships, labels, status reporting, and sprint planning. Used by the project-manager agent to coordinate work.
user-invocable: false
---

# GitHub Project Management

Operations for managing GitHub Projects v2, milestones, labels, issue relationships, and sprint planning using the `gh` CLI. Projects v2 requires GraphQL via `gh api graphql` since the REST API has limited support.

## Prerequisites

- `gh` CLI authenticated with appropriate scopes (`project`, `repo`)
- Repository owner and name available via `gh repo view --json owner,name`

## Projects v2 Operations

### Discover the project

Find the project ID (required for all subsequent operations):

```bash
# List projects for the repo owner
gh api graphql -f query='
  query($owner: String!) {
    user(login: $owner) {
      projectsV2(first: 20) {
        nodes { id number title }
      }
    }
  }
' -f owner="$(gh repo view --json owner -q .owner.login)"
```

For organization-owned repos, replace `user` with `organization`.

### Get project fields

Retrieve custom field IDs (Status, Priority, Sprint, etc.):

```bash
gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name }
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
            ... on ProjectV2IterationField {
              id name
              configuration {
                iterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
  }
' -f projectId="PROJECT_ID"
```

### Add an issue to the project

```bash
gh api graphql -f query='
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
      item { id }
    }
  }
' -f projectId="PROJECT_ID" -f contentId="ISSUE_NODE_ID"
```

Get the issue's node ID first:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
' -f owner="OWNER" -f repo="REPO" -F number=42
```

### Update item status (single-select field)

```bash
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
' -f projectId="PROJECT_ID" -f itemId="ITEM_ID" -f fieldId="STATUS_FIELD_ID" -f optionId="OPTION_ID"
```

### Update item iteration (sprint)

```bash
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: {iterationId: $iterationId}
    }) {
      projectV2Item { id }
    }
  }
' -f projectId="PROJECT_ID" -f itemId="ITEM_ID" -f fieldId="ITERATION_FIELD_ID" -f iterationId="ITERATION_ID"
```

### Query project items with status

```bash
gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue { number title state }
              ... on PullRequest { number title state }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { name } }
                  name
                }
                ... on ProjectV2ItemFieldIterationValue {
                  field { ... on ProjectV2IterationField { name } }
                  title
                }
              }
            }
          }
        }
      }
    }
  }
' -f projectId="PROJECT_ID"
```

### Remove an item from the project

```bash
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: {projectId: $projectId, itemId: $itemId}) {
      deletedItemId
    }
  }
' -f projectId="PROJECT_ID" -f itemId="ITEM_ID"
```

## Milestones

Milestones use the REST API via `gh api`.

### Create a milestone

```bash
gh api repos/{owner}/{repo}/milestones \
  -f title="v0.2.0" \
  -f description="Audio transcription and elaboration improvements" \
  -f due_on="2026-04-01T00:00:00Z" \
  -f state="open"
```

### List milestones

```bash
gh api repos/{owner}/{repo}/milestones --jq '.[] | {number, title, open_issues, closed_issues, due_on, state}'
```

### Update a milestone

```bash
gh api repos/{owner}/{repo}/milestones/{milestone_number} \
  -X PATCH \
  -f title="v0.2.0 - Revised" \
  -f state="open"
```

### Close a milestone

```bash
gh api repos/{owner}/{repo}/milestones/{milestone_number} \
  -X PATCH \
  -f state="closed"
```

### Assign an issue to a milestone

```bash
gh api repos/{owner}/{repo}/issues/{issue_number} \
  -X PATCH \
  -F milestone={milestone_number}
```

### Get milestone progress

```bash
gh api repos/{owner}/{repo}/milestones/{milestone_number} \
  --jq '{title, open_issues, closed_issues, progress: ((.closed_issues / ((.open_issues + .closed_issues) | if . == 0 then 1 else . end)) * 100 | floor | tostring + "%")}'
```

## Issue Relationships

### Task lists (parent/child)

Create parent-child relationships using task lists in the issue body. Edit an issue body to include tracked tasks:

```bash
gh issue edit {parent_number} --body "$(cat <<'EOF'
## Tasks

- [ ] #{child_1}
- [ ] #{child_2}
- [ ] #{child_3}
EOF
)"
```

GitHub automatically tracks completion of referenced issues in task lists.

### Cross-references (dependencies)

Add dependency notes as comments:

```bash
gh issue comment {issue_number} --body "Blocked by #42. This issue should be worked on after #42 is resolved."
```

### Link related issues

Reference related issues in comments or the issue body:

```bash
gh issue comment {issue_number} --body "Related to #15 and #23."
```

### Query sub-issues of a parent

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        trackedIssues(first: 50) {
          nodes { number title state }
        }
      }
    }
  }
' -f owner="OWNER" -f repo="REPO" -F number=10
```

## Labels

### Create a label

```bash
gh label create "sprint:current" --description "Items in the current sprint" --color "0E8A16"
gh label create "priority:high" --description "High priority item" --color "D93F0B"
gh label create "priority:medium" --description "Medium priority item" --color "FBCA04"
gh label create "priority:low" --description "Low priority item" --color "0075CA"
```

### List labels

```bash
gh label list
```

### Apply labels to an issue

```bash
gh issue edit {issue_number} --add-label "priority:high,sprint:current"
```

### Remove labels from an issue

```bash
gh issue edit {issue_number} --remove-label "sprint:current"
```

### Query issues by label

```bash
gh issue list --label "priority:high" --state open --json number,title,labels
```

### Query issues by multiple labels

```bash
gh issue list --label "priority:high" --label "sprint:current" --state open --json number,title
```

## Status Reporting

### Sprint progress report

Generate a summary of all open issues grouped by status:

```bash
# Get all open issues with labels and milestone
gh issue list --state open --json number,title,labels,milestone,assignees --limit 100 | \
  jq -r 'group_by(.milestone.title // "No Milestone") | .[] |
    "## \(.[0].milestone.title // "No Milestone")\n" +
    (map("- #\(.number) \(.title) [\(.labels | map(.name) | join(", "))]") | join("\n")) + "\n"'
```

### Milestone burndown summary

```bash
gh api repos/{owner}/{repo}/milestones --jq '
  .[] | select(.state == "open") |
  "### \(.title)\n" +
  "  Open: \(.open_issues) | Closed: \(.closed_issues) | " +
  "Progress: \((.closed_issues / ((.open_issues + .closed_issues) | if . == 0 then 1 else . end)) * 100 | floor)%\n" +
  "  Due: \(.due_on // "No due date")\n"'
```

### Closed issues since last report

```bash
gh issue list --state closed --json number,title,closedAt,labels --limit 50 | \
  jq --arg since "2026-03-10T00:00:00Z" '
    [.[] | select(.closedAt > $since)] |
    map("- #\(.number) \(.title)") | join("\n")'
```

### PR merge activity

```bash
gh pr list --state merged --json number,title,mergedAt --limit 20 | \
  jq -r '.[] | "- PR #\(.number) \(.title) (merged \(.mergedAt | split("T")[0]))"'
```

## Sprint Planning

### Move items into a sprint

Assign the current iteration to a batch of issues. First, get the iteration field and current iteration IDs (see "Get project fields" above), then loop:

```bash
# For each issue number in the sprint
for ISSUE in 10 12 15 18; do
  # Get issue node ID
  ISSUE_ID=$(gh api graphql -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) { id }
      }
    }
  ' -f owner="OWNER" -f repo="REPO" -F number=$ISSUE --jq '.data.repository.issue.id')

  # Add to project if not already there
  ITEM_ID=$(gh api graphql -f query='
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  ' -f projectId="PROJECT_ID" -f contentId="$ISSUE_ID" --jq '.data.addProjectV2ItemById.item.id')

  # Set iteration
  gh api graphql -f query='
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: {iterationId: $iterationId}
      }) {
        projectV2Item { id }
      }
    }
  ' -f projectId="PROJECT_ID" -f itemId="$ITEM_ID" -f fieldId="ITERATION_FIELD_ID" -f iterationId="CURRENT_ITERATION_ID"
done
```

### Prioritization

Apply priority labels and sort within the project:

```bash
# Set priority labels on issues
gh issue edit 10 --add-label "priority:high"
gh issue edit 12 --add-label "priority:medium"
gh issue edit 15 --add-label "priority:low"
```

### Capacity check

Count issues assigned per sprint to avoid overloading:

```bash
gh issue list --label "sprint:current" --state open --json number,title,assignees | \
  jq 'length as $total | "Sprint items: \($total)"'
```

### Sprint review checklist

Generate a checklist of done/not-done items for sprint review:

```bash
gh issue list --label "sprint:current" --state all --json number,title,state | \
  jq -r '.[] |
    (if .state == "CLOSED" then "- [x]" else "- [ ]" end) +
    " #\(.number) \(.title)"'
```

## Practical Patterns

### Full workflow: create milestone, label issues, add to project

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)

# 1. Create milestone
gh api repos/$OWNER/$REPO/milestones -f title="v0.3.0" -f due_on="2026-05-01T00:00:00Z"

# 2. Get milestone number
MILESTONE=$(gh api repos/$OWNER/$REPO/milestones --jq '.[] | select(.title=="v0.3.0") | .number')

# 3. Assign issues and label them
for ISSUE in 20 21 22; do
  gh api repos/$OWNER/$REPO/issues/$ISSUE -X PATCH -F milestone=$MILESTONE
  gh issue edit $ISSUE --add-label "priority:medium"
done
```

### Error handling

Always check for errors in GraphQL responses:

```bash
RESULT=$(gh api graphql -f query='...' 2>&1)
if echo "$RESULT" | jq -e '.errors' > /dev/null 2>&1; then
  echo "GraphQL error: $(echo "$RESULT" | jq -r '.errors[0].message')"
fi
```
