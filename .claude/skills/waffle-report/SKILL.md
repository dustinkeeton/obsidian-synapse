---
name: waffle-report
description: File a wafflestack toolkit bug, feature request, or rough idea UPSTREAM — in the toolkit's own tracker, not this repo — with redacted diagnostics attached. Use when a render, upgrade, doctor, or skill behaves wrongly and the fault is the toolkit's; drafts read-only, shows the exact redacted payload, files only on an explicit yes. `--yes` skips the gate.
user-invocable: true
argument-hint: "[bug: | feature:] <what went wrong, in a sentence or two — a one-liner is enough> [--yes]"
---

# Report a toolkit problem upstream

Wraps `wafflestack report` — the read-only subcommand that prints a **redacted** diagnostics block
(lock, config **keys**, doctor summary, environment) — and files the result as an issue in the
**toolkit's** tracker. This is the distinction from `/issue`: `/issue` files into the repo you are
standing in; a broken render, an `upgrade` that moved a pin and went red, or a skill whose prompt
contradicts its docs is a **wafflestack defect**, and it belongs upstream, where the maintainer can
act on it.

Two things make an upstream report useful, and this skill owns both:

- **Diagnostics.** The facts a maintainer needs to triage — toolkit version, source/ref/commit,
  targets, stacks, what `doctor` says, node and platform — are collected by the CLI, not narrated
  from memory.
- **Redaction.** The target repo is **public** and you do not own it. Absolute paths (which carry
  the OS username), remote URLs, emails, config **values**, and above all the gitignored private
  overlay must never leave this machine. The CLI redacts by construction; you finish the job on the
  prose, and the user approves the **post-redaction** bytes.

## Mode and flags

**Strip `--yes` from `$ARGUMENTS` first** — only as an unquoted flag token in the **first or last**
position; a `--yes` mid-prose or in backticks is description text, reaches the draft, and the gate
still fires. What remains is the description. An empty description is not an error: ask one
question ("what went wrong?") and continue with the answer.

Same convention as `/issue`, `/pr-response`, and `/clean-up`: the gate is a `*.confirmGate`
config key — here `waffle.reportConfirmGate` — and `--yes` is its declared `flag:` token,
rendered from the stack. It skips the confirmation gate for one run, beats the config value, and is
for an agent calling this skill or a user who has said "no need to confirm". In interactive use, do
not pass it unless asked. There is no on-token: nothing here needs to force a gate that is on by
default.

**Rendered gate for this repo: `true`** — the value after `.waffle/waffle.local.yaml` →
`.waffle/waffle.yaml` → the stack default (`true`). With no token:

| `waffle.reportConfirmGate` | Human-attended run | Non-interactive caller (CI, a subagent with no human on its turn) |
|---|---|---|
| `true` | Gate: show the redacted payload, wait for a yes. | **Fail** — the key's `nonInteractive: fail`: say that nothing was filed and hand back the draft. |
| `false` | No gate: proceed as if `--yes` were passed. | File. |
| `prompt` | Assume nothing: ask, which for a gate means gating exactly as `true` does. | **Fail** — the same `nonInteractive: fail`. |

This is the one `*.confirmGate` gate in the toolkit with **no** non-interactive skip: the report
lands in a public repo you do not own, so it is never filed silently. A caller with nobody to ask
either passes `--yes` (an explicit consent) or gets nothing filed. A consumer changes the default
in config, never by editing this rendered file.

## Plan first, then act

1. **Plan phase — read-only.** Run the CLI, pick the form, draft, redact, plan attachments. Nothing on GitHub changes.
2. **Act phase — mutating.** Any approved attachment uploads (step 4b), then `gh issue create`. Nothing runs before the gate.

Declining the gate leaves GitHub untouched — nothing filed, nothing uploaded; there is nothing to roll back.

### 1. Collect the diagnostics

```bash
npx --yes github:dustinkeeton/wafflestack#v0.20.0 report
```

It prints a collapsed `<details>` block and exits 0 **even when doctor is red** — a red doctor is
the report's subject, not a reason to stop. It reads the committed config and lock only: the
`.waffle/waffle.local.yaml` overlay and `.waffle/waffle.local.lock.json` are never opened, config
values are withheld (key paths are listed), and `cwd` → `<repo>`, home → `~`, emails and git
remotes → placeholders. Capture the block verbatim; it goes at the end of the body.

If the problem is a failing command, run it once more and keep the **last 30 lines** of its
output for the Context section — after redacting them yourself (step 4). Do not re-run a
**writing** command (`render`, `install`, `upgrade`, `reinstall`, `uninstall`) just to capture
output; use what the user already has, or `doctor`.

### 2. Resolve the target repo

The toolkit this repo runs is `github:dustinkeeton/wafflestack#v0.20.0`. Take the `OWNER/REPO` inside a
`github:OWNER/REPO[#ref]` spec — that is where the report goes, so a fork's consumer reports to
the fork. If the spec is not `github:`-shaped (a local checkout path), use the lock's
`toolkit.source` from the diagnostics block (`source github:OWNER/REPO`); if that is null too, fall
back to `dustinkeeton/wafflestack`. State the resolved target at the gate.

### 3. Pick the form and draft

Match the upstream issue forms exactly. Pick the form by **structure, never by wording**: a `bug:` /
`feature:` prefix wins outright, else the first row whose fields match:

| The description | Upstream form | Label to apply | Body sections |
|---|---|---|---|
| starts with `bug:`, or has an `Expected:` or `Actual:` line | `bug.yml` | `bug` | Problem / Motivation (Expected / Actual / Repro), Proposed Solution (optional), Context |
| starts with `feature:`, or has a `Proposed Solution:` line or heading | `feature.yml` | `enhancement` | Problem / Motivation, Proposed Solution, Sub-issues (optional), Context |
| anything else | `rough-idea.yml` | `waffle:needs-inference` | The idea (the user's words, **verbatim**), Context |

Drop a `bug:` / `feature:` prefix from the draft. **Invent nothing**, in any form: omit a field the
user did not give. A rough idea gets no Problem, Expected / Actual / Repro, or Proposed Solution.

Apply the form's own label **plus two fixed labels** on every filing:

- `waffle:reassess` — the hold. A consumer report has not been reproduced by the maintainer, so it
  enters the tracker held out of `delegate`, `autopilot`, and the `label-hook` implement path. This
  skill is the hold's **entry point**: it applies it at filing time and never removes it — only the
  upstream human clears it.
- `waffle:consumer-report` — provenance: this issue arrived via `/waffle-report` from a consuming repo.

Both names are literal, not config: the report lands in the **upstream** tracker, whose labels are
fixed, so a consumer's own `issue.reassessLabel` does not apply here. Never apply a `priority: *`
label (that is the maintainer's triage call), never touch the upstream project board or
milestones, and never guess at labels beyond the form label and these two.

Draft with `##` headings matching the form field labels, a title under 70 characters, and the
diagnostics block appended under the last section. A bug or feature:

```markdown
## Problem / Motivation
Expected: …
Actual: …
Repro: the exact command, and the last lines of its output

## Proposed Solution
(omit if none)

## Context
<the collapsed <details> block from step 1, verbatim>
```

A rough idea — two sections, nothing invented:

```markdown
## The idea
<the user's words, verbatim — step-4 redaction is the only change>

## Context
<the collapsed <details> block from step 1, verbatim>
```

### 4. Redact — the named deny-list

The CLI already scrubbed its own output. Apply the same deny-list to **everything else** in the
draft — the user's prose, pasted command output, file names:

- **Never read** `.waffle/waffle.local.yaml` or `.waffle/waffle.local.lock.json`. Not to "check
  what is in there", not to explain a value. Their purpose is to not propagate.
- **Absolute paths**, anywhere in the draft — **including each line of pasted command output** —
  → `<repo>/…` when under the repo, else `~/…` when under home. `/Users/<name>/…` and
  `/home/<name>/…` carry the OS username: `/Users/<name>/dev/<repo-dir>/.claude/x` becomes
  `<repo>/.claude/x`.
- **Git remotes, org/repo names, and remote URLs** of *this* repo → `<git-remote>` /
  `<org>/<repo>`. That includes the bare `owner/repo` inside an SSH or HTTPS remote: the pair never
  appears on its own either. The toolkit's own `github:OWNER/REPO` spec is the report's destination
  and stays.
- **Email addresses** (authors, bots) → `<email>`.
- **Config values** → dropped. Keep the **key** (`git.botEmail is set` is the diagnostic
  signal; the value is the consumer's). Tokens, hostnames, and anything that looks like a
  credential are values.
- **Never echo a redacted value anywhere in your reply** — not in a "what I redacted" list, not as
  `X → Y`, not in prose around the gate. Describe removals by category only ("a home path, the
  remote, an email, and an overlay value were removed"). The original strings must not appear once
  in your output — **except the consuming repo in §4b's hosted attachment links and the gate's
  hosting line**, which the user approves explicitly.

Re-read the whole draft once after redacting — and the **whole reply** around it: search it for
`/Users/`, `/home/`, `@`, and this repo's org/repo (outside that attachment carve-out) before
showing the gate. What you show at the gate is what gets published.

### 4b. Attachments

Files the user uploaded with the description — a dragged-in screenshot or log, a pasted image —
go in the report. Same convention as `/issue`'s Attachments section; `gh issue create` has no
upload flag, so each file needs a stable URL first:

1. **Detect.** An absolute or `~/` path in the invocation that resolves to an existing regular file
   (a drag-in; unescape `\ `, strip quotes) is uploadable — and the path itself is redaction
   material, so drop it from the prose. A pasted image that arrived only as an image content block
   has no bytes on disk: **fallback**.
2. **Host in the consuming repo, never upstream.** The reporter usually cannot push to the toolkit
   repo, so files go on the *consuming* repo's orphan `issue-assets` branch, folder
   `waffle-report-<YYYY-MM-DD>-<slug>/`, renamed `attachment-<n>.<ext>` (original filenames carry
   names and paths), and are linked cross-repo:
   `https://github.com/<consumer>/blob/issue-assets/<folder>/<file>?raw=true`. Read
   `gh repo view --json nameWithOwner,isPrivate,viewerPermission` first. A **private** consuming
   repo's raw URL is a dead link upstream, and no push access (`WRITE`/`MAINTAIN`/`ADMIN`) means
   nothing to host on — both take the fallback; never publish a link that will not render. After
   the gate, with `C` the consuming `OWNER/REPO`:

   ```bash
   gh api repos/$C/branches/issue-assets --silent 2>/dev/null || {
     TREE=$(gh api repos/$C/git/trees -f 'tree[][path]=README.md' -f 'tree[][mode]=100644' \
       -f 'tree[][type]=blob' -f 'tree[][content]=Issue attachments. Never merged.' --jq .sha)
     ROOT=$(gh api repos/$C/git/commits -f message='chore: start issue-assets' -f tree="$TREE" --jq .sha)
     gh api repos/$C/git/refs -f ref=refs/heads/issue-assets -f sha="$ROOT" --silent
   }
   base64 < "$FILE" | tr -d '\n' > "${TMPDIR:-/tmp}/asset.b64"
   jq -n --rawfile c "${TMPDIR:-/tmp}/asset.b64" --arg m "chore: attach $NAME" '{message: $m, branch: "issue-assets", content: $c}' > "${TMPDIR:-/tmp}/asset.json"
   gh api -X PUT "repos/$C/contents/$FOLDER/$NAME" --input "${TMPDIR:-/tmp}/asset.json" --silent
   ```
3. **Reference.** An `## Attachments` section after Context, omitted when there are no uploads:
   `![attachment-1.png](<raw url>)` for images, `[attachment-2.log](<raw url>)` otherwise.
4. **Fallback** — inline-only image, private or unpushable consuming repo, or a failed upload: the
   line is `` - [ ] drop `<neutral description>` here ``, the report still files, and the final
   report tells the user to attach that file by hand.

**Redaction applies to attachments.** Open each image and log before the gate: a screenshot can
show config values, the local overlay, a username in a path, or an email exactly as prose can, and
you cannot blur pixels — recommend dropping a file that shows any of them. A log is text: redact it
like step 4. A hosted link **names the consuming repo** (`<org>/<repo>`, which step 4 otherwise
scrubs) on a public branch; the user is approving that disclosure too.

### 5. Confirm — the gate

Present, and gate on an explicit yes:

- **Target**: `OWNER/REPO` (and how it was resolved)
- **Form / labels**: the form label plus the two fixed ones — `rough-idea.yml` →
  `waffle:needs-inference` + `waffle:reassess` + `waffle:consumer-report`, etc.
- **Title**
- **The full body, post-redaction** — the exact bytes, not a summary or a promise about them. Any
  note on what was redacted names categories, never values (step 4)
- **Attachments** — each file (new name, size), where it will be hosted (`<consumer>` on the public
  `issue-assets` branch — which publishes the consuming repo's name) or why it falls back to a
  placeholder. The user approves the exact set of files that leaves this machine and may drop any.

On a decline, stop. Skipped by `--yes` or a rendered gate of `false` — never by being non-interactive.

### 6. File it

Write the approved body to a file (never an inline `--body` and never a heredoc), then:

```bash
gh issue create --repo OWNER/REPO --title "<title>" --body-file "${TMPDIR:-/tmp}/waffle-report-<slug>.md" --label "<form label>"
```

Upload the approved attachments first (step 4b), so the body's links resolve when the issue
lands. Gate on the **exit status** of `gh issue create`, not the output. Then add the two fixed
labels to the URL it printed, **each in its own call**:

```bash
gh issue edit <issue url> --repo OWNER/REPO --add-label "waffle:reassess"        || echo "warn: waffle:reassess not applied"
gh issue edit <issue url> --repo OWNER/REPO --add-label "waffle:consumer-report" || echo "warn: waffle:consumer-report not applied"
```

Then **read the labels back** — the `warn:` lines cannot see a label GitHub dropped silently:

```bash
gh issue view <issue url> --repo OWNER/REPO --json labels -q '.labels[].name'
```

Build the not-applied list from that output, never from which `echo` fired.

A fixed label that fails to apply is a **warning, never a failed
filing**: the issue already exists. Expect it for most filers. Adding a label takes **triage or
write access** on the toolkit repo, and a typical consumer has neither. GitHub may also silently
drop the form label from `gh issue create`.

The canonical toolkit tracker, `dustinkeeton/wafflestack`,
**applies both fixed labels server-side**: a workflow on that repo adds them with the repo's own token when an opened issue's body carries the diagnostics block's
`<summary>` line. So keep the step-1 `<details>` block, `<summary>` line included, **verbatim** in
the body. That workflow usually lands within a minute, so the read-back above may run ahead of
it. A fork's tracker may have no such workflow, or lack the labels. So the client-side
**hold is best-effort**: an issue without `waffle:reassess` is **not on hold**, and the
maintainer's automation will treat it as ordinary scope.

On success, report the issue URL, each hosted attachment, and one line per placeholder asking the
user to attach that file by hand. For each label missing from the read-back (fixed or form), say so
plainly. For a fixed label on the canonical tracker (`dustinkeeton/wafflestack`), say the server-side hold
should add it within a minute, wait about 60 seconds, then re-run the read-back once before going
further. On any other tracker, check for a copy of that hold workflow with
`gh api repos/OWNER/REPO/contents/.github/workflows/consumer-report-hold.yml --silent`: if it
succeeds, wait the same way; if it fails, skip the wait. If it is still missing, give the likely cause (no triage
rights on `OWNER/REPO`, or a tracker without the hold workflow) and tell the user to comment on the issue asking the maintainer to add it. Name `waffle:reassess` first. Without it
the report is not held.

**If `gh issue create` fails** — no `gh` auth, no access to the toolkit repo, or the form label does not exist there —
**say plainly that nothing was submitted**, then hand the user the one-paste path:

1. Print the finished title and body.
2. Print a prefilled new-issue URL that selects the form and fills its fields by their ids —
   issue *forms* ignore a `body=` parameter, so prefill the field ids instead: `problem`,
   `solution`, `context` for `bug.yml` / `feature.yml`; `idea`, `context` for `rough-idea.yml`;
   plus `title`, and `labels=` with the two fixed labels. URL-encode each value
   (`:` → `%3A`, `,` → `%2C`):

   ```text
   https://github.com/OWNER/REPO/issues/new?template=bug.yml&labels=waffle%3Areassess%2Cwaffle%3Aconsumer-report&title=<title>&problem=<…>&context=<…>
   ```

   GitHub drops `labels=` for a user without triage rights; the form still applies its own label.
   On the canonical tracker (`dustinkeeton/wafflestack`) the server-side hold adds `waffle:reassess` and
   `waffle:consumer-report` as long as the pasted Context keeps the `<details>` block verbatim;
   on any other tracker, tell the user the maintainer may need to add them.

   Browsers and GitHub cap URL length around 8 KB; if the body would exceed that, give the
   `template` + `title` URL and tell the user to paste the printed sections in.

Do not retry with a different account, a different repo, or by dropping the redaction.

## Examples

### A bug with a screenshot, from a public consuming repo
```
/waffle-report bug: doctor flags drift right after a clean render ~/Desktop/Screenshot\ 2026-10-07.png
```
Collects redacted diagnostics, drafts a `bug.yml` report from the text minus the path, and opens the
screenshot to check it for leaked values. The gate shows the body plus `attachment-1.png` (380 KB) →
`<consumer>`'s public `issue-assets` branch, flagging that the link names the consuming repo. On a
yes: uploads it, then files upstream with the image rendering inline under `## Attachments`.

### The same from a private repo, or with a pasted image
Nothing can be hosted where the maintainer can see it, so the gate says "fallback: placeholder",
the body carries `` - [ ] drop `screenshot of the doctor output` here ``, and the final report asks
the user to drag the file into the filed issue by hand. On a decline, nothing is uploaded or filed.
