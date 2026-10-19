---
name: waffle-report
description: File a wafflestack toolkit bug, feature request, or rough idea UPSTREAM — in the toolkit's own tracker, not this repo — with redacted diagnostics attached. Use when a render, upgrade, doctor, or skill behaves wrongly and the fault is the toolkit's; drafts read-only, shows the exact redacted payload, files only on an explicit yes. `--yes` skips the gate.
user-invocable: true
argument-hint: "<what went wrong, in a sentence or two — a one-liner is enough> [--yes]"
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

1. **Plan phase — read-only.** Run the CLI, classify, draft, redact, plan attachments. Nothing on GitHub changes.
2. **Act phase — mutating.** Any approved attachment uploads (step 4b), then `gh issue create`. Nothing runs before the gate.

Declining the gate leaves GitHub untouched — nothing filed, nothing uploaded; there is nothing to roll back.

### 1. Collect the diagnostics

```bash
npx --yes github:dustinkeeton/wafflestack#v0.17.2 report
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

The toolkit this repo runs is `github:dustinkeeton/wafflestack#v0.17.2`. Take the `OWNER/REPO` inside a
`github:OWNER/REPO[#ref]` spec — that is where the report goes, so a fork's consumer reports to
the fork. If the spec is not `github:`-shaped (a local checkout path), use the lock's
`toolkit.source` from the diagnostics block (`source github:OWNER/REPO`); if that is null too, fall
back to `dustinkeeton/wafflestack`. State the resolved target at the gate.

### 3. Classify and draft

Match the upstream issue forms exactly — a skill-filed report and a hand-filed one must converge on
one shape, so the maintainer's enrichment pass can pick either straight off the queue:

| Report is | Upstream form | Label to apply | Body sections |
|---|---|---|---|
| a defect, regression, or behavior that contradicts the docs | `bug.yml` | `bug` | Problem / Motivation (Expected / Actual / Repro), Proposed Solution (optional), Context |
| a missing capability or a change to how something works | `feature.yml` | `enhancement` | Problem / Motivation, Proposed Solution, Sub-issues (optional), Context |
| a half-formed one-liner — the user could not or did not say more | `rough-idea.yml` | `waffle:needs-inference` | The idea (the user's words, **verbatim**), Context |

Route honestly: a one-liner is a **rough idea**, not a bug you invent details for. The
`waffle:needs-inference` label is the enrichment queue — filing there is the low-friction path, and
padding a one-liner into a fake bug report defeats it.

Apply **only the form's own label**. Never apply a `priority: *` label (that is the maintainer's
triage call), never touch the upstream project board or milestones, and never guess at labels
beyond the three above.

Draft with `##` headings matching the form field labels, a title under 70 characters, and the
diagnostics block appended under the last section:

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

### 4. Redact — the named deny-list

The CLI already scrubbed its own output. Apply the same deny-list to **everything else** in the
draft — the user's prose, pasted command output, file names:

- **Never read** `.waffle/waffle.local.yaml` or `.waffle/waffle.local.lock.json`. Not to "check
  what is in there", not to explain a value. Their purpose is to not propagate.
- **Absolute paths** → repo-relative, or `~/…` when outside the repo. `/Users/<name>/…` and
  `/home/<name>/…` carry the OS username.
- **Git remotes, org/repo names, and remote URLs** of *this* repo → `<git-remote>` /
  `<org>/<repo>`. The toolkit's own `github:OWNER/REPO` spec is the report's destination and stays.
- **Email addresses** (authors, bots) → `<email>`.
- **Config values** → dropped. Keep the **key** (`git.botEmail is set` is the diagnostic
  signal; the value is the consumer's). Tokens, hostnames, and anything that looks like a
  credential are values.

Re-read the whole draft once after redacting. What you show at the gate is what gets published.

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
- **Form / label**: `bug.yml` → `bug`, etc.
- **Title**
- **The full body, post-redaction** — the exact bytes, not a summary or a promise about them
- **Attachments** — each file (new name, size), where it will be hosted (`<consumer>` on the public
  `issue-assets` branch — which publishes the consuming repo's name) or why it falls back to a
  placeholder. The user approves the exact set of files that leaves this machine and may drop any.

On a decline, stop. Skipped by `--yes` or a rendered gate of `false` — never by being non-interactive.

### 6. File it

Write the approved body to a file (never an inline `--body` and never a heredoc), then:

```bash
gh issue create --repo OWNER/REPO --title "<title>" --body-file "${TMPDIR:-/tmp}/waffle-report-<slug>.md" --label "<label>"
```

Upload the approved attachments first (step 4b), so the body's links resolve when the issue
lands. Gate on the **exit status**, not the output. On success, report the issue URL, each hosted
attachment, and one line per placeholder asking the user to attach that file by hand.

**If it fails** — no `gh` auth, no access to the toolkit repo, or the label does not exist there —
**say plainly that nothing was submitted**, then hand the user the one-paste path:

1. Print the finished title and body.
2. Print a prefilled new-issue URL that selects the form and fills its fields by their ids —
   issue *forms* ignore a `body=` parameter, so prefill the field ids instead: `problem`,
   `solution`, `context` for `bug.yml` / `feature.yml`; `idea`, `context` for `rough-idea.yml`;
   plus `title`. URL-encode each value:

   ```text
   https://github.com/OWNER/REPO/issues/new?template=bug.yml&title=<title>&problem=<…>&context=<…>
   ```

   Browsers and GitHub cap URL length around 8 KB; if the body would exceed that, give the
   `template` + `title` URL and tell the user to paste the printed sections in.

Do not retry with a different account, a different repo, or by dropping the redaction.

## Examples

### A bug with a screenshot, from a public consuming repo
```
/waffle-report doctor flags drift right after a clean render ~/Desktop/Screenshot\ 2026-10-07.png
```
Collects redacted diagnostics, drafts a `bug.yml` report from the text minus the path, and opens the
screenshot to check it for leaked values. The gate shows the body plus `attachment-1.png` (380 KB) →
`<consumer>`'s public `issue-assets` branch, flagging that the link names the consuming repo. On a
yes: uploads it, then files upstream with the image rendering inline under `## Attachments`.

### The same from a private repo, or with a pasted image
Nothing can be hosted where the maintainer can see it, so the gate says "fallback: placeholder",
the body carries `` - [ ] drop `screenshot of the doctor output` here ``, and the final report asks
the user to drag the file into the filed issue by hand. On a decline, nothing is uploaded or filed.
