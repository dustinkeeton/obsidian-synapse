---
name: github-project-board
description: Create and standardize a GitHub Projects v2 board to the toolkit's canonical Kanban config (Status/Priority/Size/Start/Target fields; Table/Kanban/Roadmap views). Provisions a board when none exists and reconciles missing fields/options on an existing one — always asking before it creates or mutates. Used to bootstrap the board the issue, delegate, and github-project-management skills then consume.
user-invocable: true
argument-hint: "(omit to target the board matching the project name) | <project number or title to standardize>"
---

# GitHub Project Board — provision & standardize

The other board-touching skills only **consume** an existing Projects v2 board — `delegate`
syncs Kanban status, `issue` files new items to "Backlog", and `github-project-management`
holds the read/update GraphQL catalog. None of them **create** or **standardize** a board.
This skill fills that gap: it provisions a board to the toolkit's **standard spec** when none
exists, and reconciles a partial board up to it — **never silently**. It always asks before it
creates a board or mutates an existing one.

Use it once, at setup, to bootstrap the board the consumer skills then rely on. For the full
read/update-item query catalog (statuses, dates, milestones, sprint planning) see the
`github-project-management` skill — this skill covers only the board *structure*.

## Prerequisites

- `gh` CLI authenticated **with the `project` scope** — board creation and field mutations
  need it beyond the usual `repo` scope. If a call fails with a message about the `project`
  scope, grant it and retry:
  ```bash
  gh auth refresh -s project
  ```
- Repo owner / name / node ID:
  ```bash
  OWNER=$(gh repo view --json owner -q .owner.login)
  REPO=$(gh repo view --json name -q .name)
  REPO_ID=$(gh repo view --json id -q .id)   # GraphQL node ID (R_…), used to link the board
  ```
- Owner node ID (works for a user- or org-owned repo):
  ```bash
  OWNER_ID=$(gh api graphql -f query='
    query($owner: String!) { repositoryOwner(login: $owner) { id } }
  ' -f owner="$OWNER" --jq '.data.repositoryOwner.id')
  ```

## The standard board spec

Encoded here as the canonical target (modeled on the "Obsidian Synapse" reference board that
`github-project-management`'s date heuristics already assume). "Standardizing" a board means
reconciling it toward this:

| Field | Type | Options / notes |
|-------|------|-----------------|
| **Status** | single-select (Kanban columns) | Backlog · Todo · In Progress · In Review · Done |
| **Priority** | single-select | Critical · High · Medium · Low |
| **Size** | single-select | S · M · L |
| **Start** | date | Roadmap bar start |
| **Target** | date | Roadmap bar end |

**Views:** Table (all items) · Kanban (board layout grouped by Status) · Roadmap (Start→Target).
**Milestones:** used when scoped, from the repo's existing milestone catalog (see
`github-project-management`). **Swimlanes:** none by default (the reference board uses none) —
an optional later refinement.

> **New boards start with only a Status field** (GitHub seeds it with Todo / In Progress /
> Done). Everything else — Backlog & In Review options, Priority, Size, Start, Target — is
> added by this skill.

## Decision flow — ask first, always

1. **Discover** the board matching the project name (below).
2. **A board already exists** → do **not** silently mutate it. Report what it has vs. the
   standard spec (missing fields, missing Status options, missing views) and **ask** the user
   which to add: e.g. "add the standard config as an additional view/board, and/or add the
   missing Priority & Size fields and Backlog/In Review Status options?" Apply only what they
   approve.
3. **No board exists** → **ask** before creating one. On approval: create it, link it to the
   repo, then provision the fields/options and set up the views.

Never create or mutate without an explicit go-ahead.

## Discover the board (case-insensitive, normalized)

An account may own several projects, and the title may differ from `project.name` only by case
(`WaffleStack` vs `wafflestack`). Match on a **normalized, exact** title — downcase both sides —
rather than the substring regex the consumer skills use, so a longer project name can't
false-match:

```bash
PROJECT_ID=$(gh api graphql -f query='
  query($owner: String!) {
    user(login: $owner) {
      projectsV2(first: 50) { nodes { id number title } }
    }
  }
' -f owner="$OWNER" \
  --jq 'first(.data.user.projectsV2.nodes[]
          | select((.title | ascii_downcase) == ("Synapse" | ascii_downcase))
          | .id) // empty')
```

For an organization-owned repo, replace `user(login: $owner)` with `organization(login: $owner)`.
`PROJECT_ID` empty → no matching board (the "no board" path). Non-empty → the "existing board"
path; introspect its fields/options with the **Get project fields** query in
`github-project-management` before deciding what is missing.

## Create a board (no-board path, after approval)

```bash
PROJECT_ID=$(gh api graphql -f query='
  mutation($ownerId: ID!, $title: String!) {
    createProjectV2(input: {ownerId: $ownerId, title: $title}) {
      projectV2 { id number url }
    }
  }
' -f ownerId="$OWNER_ID" -f title="Synapse" \
  --jq '.data.createProjectV2.projectV2.id')
```

Link it to the repo so it appears under the repo's Projects tab and the consumer skills find it:

```bash
gh api graphql -f query='
  mutation($projectId: ID!, $repositoryId: ID!) {
    linkProjectV2ToRepository(input: {projectId: $projectId, repositoryId: $repositoryId}) {
      repository { id }
    }
  }
' -f projectId="$PROJECT_ID" -f repositoryId="$REPO_ID"
```

## Provision fields

`createProjectV2Field` creates a **new** field. Single-select options are inlined in the
mutation body (not passed as variables — `gh api -f` only carries scalar variables); each option
needs **`name`, `color`, `description`** (all required) and `color` is an unquoted enum from
`{GRAY, BLUE, GREEN, YELLOW, ORANGE, RED, PINK, PURPLE}`.

**Priority** (single-select):

```bash
gh api graphql -f query='
  mutation($projectId: ID!) {
    createProjectV2Field(input: {
      projectId: $projectId
      dataType: SINGLE_SELECT
      name: "Priority"
      singleSelectOptions: [
        {name: "Critical", color: RED,    description: "Crash, data loss, security, blocks all users"}
        {name: "High",     color: ORANGE, description: "Broken workflow, regression, significant UX issue"}
        {name: "Medium",   color: YELLOW, description: "New feature, improvement, moderate bug"}
        {name: "Low",      color: BLUE,   description: "Cosmetic, nice-to-have, minor, tech debt"}
      ]
    }) {
      projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } }
    }
  }
' -f projectId="$PROJECT_ID"
```

**Size** (single-select) — same shape, `name: "Size"` and options
`{name: "S", color: GREEN, …} {name: "M", color: YELLOW, …} {name: "L", color: ORANGE, …}`.

**Start** and **Target** (date fields — one call each):

```bash
gh api graphql -f query='
  mutation($projectId: ID!) {
    createProjectV2Field(input: {projectId: $projectId, dataType: DATE, name: "Start"}) {
      projectV2Field { ... on ProjectV2Field { id name } }
    }
  }
' -f projectId="$PROJECT_ID"
# repeat with name: "Target"
```

Valid `dataType` values: `TEXT`, `SINGLE_SELECT`, `NUMBER`, `DATE`, `ITERATION`.

## Reconcile the Status field (the tricky one)

The auto-created Status field usually has **Todo / In Progress / Done**; the standard spec adds
**Backlog** and **In Review**. Options are edited with `updateProjectV2Field`, which is a
**full replace** — you must resend **every existing option plus the additions** in one array, or
the options you omit are deleted. First read the current options (the **Get project fields** query
in `github-project-management`, capturing the `Status` field's `id` and each option's `name`),
then:

```bash
gh api graphql -f query='
  mutation($fieldId: ID!) {
    updateProjectV2Field(input: {
      fieldId: $fieldId
      singleSelectOptions: [
        {name: "Backlog",     color: GRAY,   description: "Not yet scheduled"}
        {name: "Todo",        color: BLUE,   description: "Scheduled, not started"}
        {name: "In Progress", color: YELLOW, description: "Actively being worked"}
        {name: "In Review",   color: ORANGE, description: "In a PR / awaiting review"}
        {name: "Done",        color: GREEN,  description: "Merged / closed"}
      ]
    }) {
      projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
  }
' -f fieldId="$STATUS_FIELD_ID"
```

**Honest caveats — verify before you run this on a live board:**

- **Full replace regenerates option IDs.** Items already assigned to an option can be
  **orphaned** (their Status clears) when the option set is rewritten. This is harmless on a
  **fresh** board (no items yet) — the common case for this skill — but on a **populated** board
  it can wipe assignments. There, prefer editing the Status options **in the GitHub UI**, or
  proceed only with the user's explicit understanding of the risk.
- **The built-in Status field is the most restricted** — some accounts still reject
  add/delete/rename of its options via the API. If the mutation errors, fall back to the manual
  UI steps below rather than fighting it.
- **Same read-first, full-array pattern** applies to adding a missing option to *any* existing
  single-select field (e.g. a Priority someone hand-created without "Critical").

## Views — not creatable via the public API

Projects v2 **views cannot be created via the public GraphQL API** (no `createProjectV2View`
mutation exists). Two ways to get the Table / Kanban / Roadmap views:

**A. Copy a template board (recommended when you keep one).** `copyProjectV2` clones a source
project's **fields, options, *and* views** in one call — so if you maintain a canonical template
board, copy it instead of building field-by-field, then link the copy to the repo:

```bash
gh api graphql -f query='
  mutation($ownerId: ID!, $projectId: ID!, $title: String!) {
    copyProjectV2(input: {
      ownerId: $ownerId, projectId: $projectId, title: $title, includeDraftIssues: false
    }) {
      projectV2 { id number url }
    }
  }
' -f ownerId="$OWNER_ID" -f projectId="$TEMPLATE_PROJECT_ID" -f title="Synapse"
```

**B. Guided manual steps (no template).** Print these for the user to click through on the
board's web UI (`…/projects/<number>`):

1. **Table** — the default view; rename it "Table" and show all items.
2. **Kanban** — New view → **Board** layout → group by **Status**. Columns follow the Status
   options (Backlog → Todo → In Progress → In Review → Done).
3. **Roadmap** — New view → **Roadmap** layout → set the date fields to **Start** and **Target**.

## Verify

Re-run the **Get project fields** query (`github-project-management`) and confirm Status,
Priority, Size, Start, and Target are present with the expected options; open the board and
confirm the three views. Report field/option/view coverage vs. the standard spec, and note
anything left to the manual UI (views without a template, or Status options the API refused).

## Error handling

- **Missing `project` scope** → `gh auth refresh -s project`, then retry (never widen scopes
  without the user's go-ahead).
- **GraphQL errors** — check the response for `.errors` (see the `github-project-management`
  error-handling pattern) and surface the message; don't assume success from a `0` exit.
- **Ambiguous discovery** (several projects match after normalization) → list them (number +
  title) and ask which to standardize rather than guessing.
- Board provisioning is a deliberate, user-approved action — unlike the consumer skills'
  best-effort board sync, do **not** silently skip on failure; report what succeeded and what
  still needs a manual step.
