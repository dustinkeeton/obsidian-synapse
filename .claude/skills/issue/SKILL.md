---
name: issue
description: Create a well-structured GitHub issue from a brief description, or enrich an existing issue in place. Fleshes out title, body, labels, and optional sub-issues. Plans read-only first and confirms before mutating; `--yes` or a non-interactive agent/CI invocation skips the gate. Invokable by users and agents.
user-invocable: true
argument-hint: "<description for a new issue> | <#N, number, or issue URL to enrich> | (omit to enrich all open 'Needs Inference' issues)  [--yes]"
---

# GitHub Issue Creation

When this skill is invoked, you either **create a new GitHub issue** from a brief description or **enrich an existing issue in place** — in either case in **this repository** using the `gh` CLI. Your job is to flesh the input out into a clear, actionable issue.

## Mode detection

**Strip `--yes` from `$ARGUMENTS` first, then apply the mode rules to what remains.** `--yes` is a
flag, not a mode: as a flag it never contributes to the description text. So bare `/issue --yes` is a
straight-through **batch enrich** — *not* a new issue titled `--yes` — and `/issue --yes fix the
login bug` drafts from `fix the login bug`, with the flag never bleeding into the drafted title or
body.

**Strip it only as a flag token** — an unquoted `--yes` in the **first or last** position of
`$ARGUMENTS`. A `--yes` sitting mid-prose or inside backticks is **description text**: it is not
stripped, it reaches the drafted title and body, and **the gate still fires**. So `/issue --yes fix
the login bug` and `/issue fix the login bug --yes` skip the gate, but `/issue the --yes flag in
pr-response is ignored` files an issue *about* `--yes` and gates normally. Eating a *mentioned*
`--yes` would mangle the description **and** skip a gate nobody asked to skip — in a toolkit where
three skills carry that flag, filing an issue about one is an ordinary thing to want.

With the flag removed, inspect what is left to choose a mode (same detection approach as the
`delegate` skill):

| `$ARGUMENTS` (after stripping `--yes`) | Mode | What to do |
|--------------|------|------------|
| `#N`, a bare number, or a GitHub issue URL | **Enrich-in-place** | Flesh out that existing issue and update it — see **Enriching an existing issue (Needs Inference)** below. |
| empty / omitted | **Batch enrich** | Enrich **every** open issue labeled `Needs Inference` — see the batch note in that section. |
| any other text | **Create new** | Treat the text as the description for a brand-new issue and follow the **Workflow** below. |

The flag itself is orthogonal to the mode it modifies:

| Flag | Effect | What to do |
|------|--------|------------|
| `--yes` (with or without any mode above) | **Gate skip** | Combines with any mode: skip the confirmation gate and go straight through — see [The `--yes` convention](#the---yes-convention). |

`Needs Inference` is the lifecycle label: it marks an issue as awaiting AI fleshing-out, and is **removed** once the issue has been enriched.

## Plan first, then act

Every mode runs in two phases:

1. **Plan phase — read-only.** Gather context, classify, and draft. Only reads: `gh issue view`, `gh issue list`, `gh label list`, the milestone list (`gh api repos/$OWNER/$REPO/milestones`), the project-board GraphQL **queries** that resolve the project, Status field, and Backlog option (Workflow step 7c, with 7a's `gh repo view` env resolve as its prerequisite), and source files. Nothing on GitHub changes. Not 7b — it reads the node ID of an issue that does not exist yet in create mode.
2. **Act phase — mutating.** Runs *only* after the confirmation gate. The mutations are: `gh issue create`, `gh issue edit` (title, body, or labels), any label add/remove, `addSubIssue`, and every project-board and milestone GraphQL mutation.

The gate covers **mutating**, not reading — the plan-phase steps are always safe to run. That cuts both ways: a placement the gate *shows* must be one the plan phase actually **looked up**, never a guess. Read whatever it takes to make the plan true; just don't apply any of it.

Declining the gate leaves GitHub state untouched: nothing was created, edited, labeled, or moved, so there is nothing to roll back.

Two callers skip the gate: an explicit `--yes` (see [The `--yes` convention](#the---yes-convention)), and a **non-interactive** agent or CI invocation (see [When called by agents](#when-called-by-agents)).

## Workflow

> Steps below cover **Create new** mode. Enrich-in-place reuses the context (1), classification (2), drafting incl. priority inference (3), confirmation (4), priority-label (6), and project-integration (7) steps — see **Enriching an existing issue (Needs Inference)**.

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

Then finish the plan — **infer, do not apply**. Both of the following are decided here and carried out later, in the act phase.

**Priority label** — infer one from the issue context using signal matching:

| Signal in issue content | Label |
|------------------------|-------|
| crash, data loss, security, blocks all users | `priority: critical` |
| broken workflow, regression, significant UX issue | `priority: high` |
| new feature, improvement, moderate bug, unclear | `priority: medium` |
| cosmetic, nice-to-have, minor, tech debt | `priority: low` |

Default to `priority: medium` when signals are ambiguous. Labels use a space after the colon (e.g., `priority: medium`, not `priority:medium`).

**Board placement** — the issue goes on the project board as "Backlog", plus the milestone whose title/scope matches (bugs → earliest milestone, features → match by scope; no match → no milestone). **Query the board and the milestone list to settle this — just don't mutate them yet.** Those are reads (Workflow step 7c, after 7a's env resolve, and 7e's `gh api .../milestones`), so they belong in the plan phase: naming a milestone you never listed means the gate shows a placement it never verified, and the act phase silently takes the `no match → skip` branch on a milestone the user already approved. State the placement you resolved, by title.

### 4. Confirm the plan

Present the drafted plan **before** anything mutates, and gate on an explicit yes. Show:

- the proposed **title**;
- the full drafted **body**;
- the **labels** — the type label (step 2) and the inferred priority label (step 3);
- the **board placement** — "Backlog" plus the milestone you intend to match (or that none matches);
- any **native sub-issues** you intend to create as separate child issues.

Proceed only on an explicit yes. On a decline, **stop**: nothing has been created, edited, or labeled. If the user asks for changes, revise the draft and re-present it — revising is still plan phase.

Skip this gate when `--yes` was passed, or when the caller is a **non-interactive** agent or CI job — no human in the loop to protect (see [When called by agents](#when-called-by-agents)). An agent working a live user's turn is **not** that caller: it gates like anyone else.

#### The `--yes` convention

`--yes` skips the confirmation gate. It exists for an **agent calling this skill** — a hook enriching a freshly filed issue, an orchestrator filing a follow-up — and for interactive use when the user has said "no need to confirm". Same convention as the `pr-response` and `clean-up` skills' `--yes`. In interactive use, do not pass it unless the user asks for it.

The gate covers **mutating**, not reading. Steps 1–3 are read-only and always safe to run.

### 5. Create the issue

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

### 6. Apply the priority label

Apply the priority label inferred in step 3 — as confirmed, don't re-litigate it here:

```bash
gh issue edit {number} --add-label "<priority label>"
```

### 7. Project integration

Add the newly created issue to the project board with "Backlog" status.

**7a. Resolve repo owner/name:**

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)
```

**7b. Get issue node ID** from the issue number returned by `gh issue create`:

```bash
ISSUE_NODE_ID=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F number=$ISSUE_NUMBER --jq '.data.repository.issue.id')
```

**7c. Discover project and field IDs:**

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

**7d. Add to board and set status:**

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

**7e. Optionally assign milestone:**

```bash
# List open milestones
gh api repos/$OWNER/$REPO/milestones --jq '.[] | select(.state == "open") | {number, title, due_on}'
```

Match by scope: bugs → assign to earliest milestone, features → match by milestone title/scope. If no match → skip milestone assignment.

You already ran this list in the plan phase (step 3) and the user approved the milestone it resolved — so **apply the confirmed one, don't re-decide it here**. If it has since vanished, say so in the step-8 report rather than silently taking the `no match → skip` branch: what was approved and what was applied must never diverge in silence.

**Error handling:** Each substep fails independently. No project → skip with warning (the `github-project-board` skill can provision a standard board if the user wants one — don't create it inline). No "Backlog" option → try "Todo"/"New" fallbacks. GraphQL error → report but don't fail the issue creation. If the repo has no Projects board at all, skip step 7 entirely — issue creation still succeeds.

See the `github-project-management` skill for the full GraphQL query catalog, and the `github-project-board` skill to create or standardize the board itself.

### 8. Report back

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

   Also settle the rest of the plan, without applying it: the type label (Workflow step 2), the inferred priority label (Workflow step 3), the removal of the `Needs Inference` lifecycle label, and the intended board/milestone placement.

4. **Confirm the plan** — the gate. Steps 1–3 read and draft; everything below mutates the issue. Present, and gate on an explicit yes:
   - the **current → proposed title**;
   - the full **proposed body** (an in-place rewrite replaces what's there — show it before it lands);
   - the **label changes** — type + priority added, `Needs Inference` removed;
   - the intended **board placement + milestone**.

   On a decline, **stop** — the issue is untouched. Skipped by `--yes` and by non-interactive agent/CI callers, exactly as in the create-mode gate ([The `--yes` convention](#the---yes-convention), [When called by agents](#when-called-by-agents)).

5. **Update the issue in place** (use `--body-file` to avoid shell-escaping problems with backticks/`$`/`&`):
   ```bash
   gh issue edit <N> --title "<new title>" --body-file <path-to-body>
   ```

6. **Labels** — add the type label and priority label from the confirmed plan, and **remove the lifecycle label**:
   ```bash
   gh issue edit <N> --add-label "<type label>" --add-label "<priority label>" --remove-label "Needs Inference"
   ```

7. **Project board + milestone** — ensure the issue is on the board with a Status (Backlog if open) and has a milestone, reusing **Workflow step 7** (project integration). Skip whichever is already set.

8. **Report back** — issue URL, a one-line summary of what changed, and confirmation that `Needs Inference` was removed and the board/milestone were applied.

### Batch enrich (no argument)

When `$ARGUMENTS` is empty, process the whole queue:

```bash
gh issue list --state open --label "Needs Inference" --json number,title,body,labels
```

Batch mode plans the **whole queue** before it touches any of it — a bad inference rewriting a dozen issues in one unreviewed pass is exactly what the gate exists to prevent.

1. **Plan every issue first.** Run steps 1–3 (fetch, gather context, re-draft) for *each* queued issue. This whole pass is read-only.
2. **Present one combined review** — a single gate for the entire batch, not one prompt per issue:

   | # | Current title | Proposed title | Type | Priority | Lifecycle label |
   |---|---------------|----------------|------|----------|-----------------|
   | 41 | fix the thing | Fix silent retry on expired tokens | bug | high | `Needs Inference` removed |

   Offer the full drafted bodies alongside the table, or on request if the batch is large — but never apply a body the user hasn't been offered a look at.
3. **Apply only what was approved.** The user may approve the batch, or a **subset** ("all but #41", "just 39 and 40") — enrich exactly the approved issues and leave the rest untouched, still labeled `Needs Inference` for a later pass. A decline enriches nothing.
4. **Then act** — run **enrich steps 5–8** (update in place, labels, board + milestone, report) for each approved issue, and print a summary of every issue enriched (number, new title, labels, milestone). Enrich steps, not Workflow steps: Workflow step 5 *creates* an issue, enrich step 5 rewrites one in place.

`--yes` and non-interactive agent/CI callers skip the combined review and enrich the whole queue straight through.

## Examples

### Simple bug
```
/issue data export fails silently when the API key is expired
```
Drafts an issue titled "Fix silent failure when the data-export API key is expired" with the bug-type label, a body explaining the problem, a proposed error-handling fix, and no sub-issues; names the high-priority label and "Backlog" placement. **Shows the draft and waits for a yes**, then creates it and applies the label and board status.

### Multi-step feature
```
/issue add CSV import support
```
Drafts "Add CSV import support" with the enhancement-type label, a body explaining the motivation and approach, and sub-issues for file parsing, validation, pipeline integration, and tests. **Pauses on the draft**; on a yes, creates the issue, applies the default priority label, adds it to the board as "Backlog", and assigns the matching milestone if one exists.

### Skip the gate
```
/issue --yes data export fails silently when the API key is expired
```
Same as the first example with no pause — drafts and creates straight through. Use when the user has said "no need to confirm".

### Enrich an existing issue
```
/issue 360
```
Fetches issue #360 (labeled `Needs Inference`), reads the relevant code, and re-drafts its title and body into the full template — preserving the original report in a collapsed block. **Shows the current → proposed title, the new body, and the label changes, and waits for a yes** before editing anything. On approval: applies the type + priority labels, removes `Needs Inference`, puts it on the board as "Backlog", and assigns a milestone. On a decline, #360 is exactly as it was.

### Enrich the whole queue
```
/issue
```
With no argument, drafts an enrichment for *every* open issue labeled `Needs Inference`, presents them in **one combined review**, and enriches only the ones approved (the whole batch, or a subset) — then summarizes the results.

## When called by agents

"Agent caller" is **not** the test — *non-interactive* is. Being an agent is a fact about the caller's
implementation; having nobody to ask is a fact about the run. Only the second one justifies skipping a
gate that exists to protect a human, so sort callers by whether a human is waiting on this turn.

**Non-interactive callers — skip the gate.** The label-hook harness dispatching enrich mode from a
GitHub Actions job; autopilot and delegate-spawned workers filing issues mid-run; `pr-response` filing
its Defer follow-ups. The agent's prompt serves as the brief description; such a caller may equally
pass an issue reference (`#N`/number/URL) to enrich an existing issue in place.

**Do not pause at the confirmation gate.** For these callers, the **agent invocation is itself the explicit signal that stands in for the confirmation** — the same precedent as the `delegate` skill's batch mode, where explicit scope stands in for the human accepting the plan (`confirmedVia: "batch-scope"`). Proceed as if `--yes` were passed. Two reasons this is not a shortcut:

- **A CI caller can never answer a prompt.** The label-hook workflow runs headless; pausing for a yes
  would hang the run until it times out. The gate protects a human from an unreviewed mutation — there
  is no human in that loop to protect. Distinguish this from **a skill filing a follow-up mid-run** —
  `pr-response` is `user-invocable`, so an interactive `/pr-response` files its Defer follow-ups with a
  human very much present. Auto-skipping there is a *deliberate choice*, not a necessity: that human
  already accepted the triage plan, and interrupting the run to re-confirm each follow-up issue would be
  the worse prompt.
- **The audit trail replaces the pause.** Before applying anything, **log** the drafted plan — title,
  body, labels, board placement — in the transcript, so the run stays reviewable after the fact rather
  than un-reviewable in the moment. That is what the gate would have shown; it just isn't blocking on it.

**Interactive agent callers — the gate still binds.** A subagent serving a live user's turn is the most
natural route to filing an issue in this toolkit, and neither reason above reaches it: a subagent is
**not** CI (there *is* a human to protect), and no plan was pre-accepted the way `pr-response`'s triage
was — the drafted issue is fresh work the user has never seen. The audit trail is weakest here too: a
subagent's log stays in its own transcript, and only its **final message** reaches the human. These
callers are in scope today:

- **`product-manager`** — files the issue once a user story is finalized.
- **`task-planner`** — files each child issue when breaking a feature down.
- **`project-manager`** — files gap issues found while reviewing the backlog.

A subagent cannot prompt the user itself, so it does not *hold* the gate — it **hands it up**:

1. Run the plan phase as normal, and **stop before the first mutation**.
2. Return the drafted plan — title, body, labels, board placement, any sub-issues — as your **final
   message** to the caller, which is what actually reaches the human. Create nothing.
3. The caller confirms with the user and re-invokes with `--yes` to file it straight through. A caller
   that already carries the user's explicit yes may pass `--yes` on the first invocation and skip
   step 1's pause entirely.

The user's approval of an upstream artifact — a product doc, a task breakdown — is **not** approval of
the issue drafted from it. Only `--yes` or a human yes on *this* draft opens the act phase.

Everything else is unchanged: the plan phase always runs (context, classification, drafting), and for a
gate-skipping caller the post-creation steps (priority label, project board placement, milestone
assignment) run automatically.
